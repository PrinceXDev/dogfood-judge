// Command dogfood runs the portal and its offline tools.
//
//	dogfood serve                      start the portal (default)
//	dogfood normalize [fixtures.json]  print the normalization proof report
//	dogfood simulate [fixtures.json]   Monte Carlo validation of every method
//	dogfood verify-record FILE --key B64
//	dogfood export EVENT > event.json  /  dogfood import event.json
//	dogfood set-password EMAIL
package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"dogfood/src/core"
	"dogfood/src/judging"
	"dogfood/src/seed"
	"dogfood/src/store"
	"dogfood/src/web"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	switch strings.ToLower(os.Getenv(key)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

func main() {
	cmd := "serve"
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve()
	case "normalize":
		err = normalize(args)
	case "simulate":
		err = simulate(args)
	case "verify-record":
		err = verifyRecord(args)
	case "export":
		err = export(args)
	case "import":
		err = importDoc(args)
	case "set-password":
		err = setPassword(args)
	case "help", "-h", "--help":
		fmt.Println("usage: dogfood [serve|normalize|simulate|verify-record|export|import|set-password]")
	default:
		err = fmt.Errorf("unknown command %q", cmd)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "dogfood:", err)
		os.Exit(1)
	}
}

func openService(ctx context.Context) (*core.Service, error) {
	path := env("DOGFOOD_DB", "data/dogfood.db")
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, err
		}
	}
	db, err := store.Open(path)
	if err != nil {
		return nil, err
	}
	return core.New(ctx, db)
}

func serve() error {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	svc, err := openService(ctx)
	if err != nil {
		return err
	}
	fixtures := env("DOGFOOD_FIXTURES", "fixtures.json")
	if _, err := os.Stat(fixtures); err != nil {
		log.Warn("fixtures file not found; starting without the fixture event", "path", fixtures)
		fixtures = ""
	}
	if err := seed.Run(ctx, svc, seed.Options{FixturesPath: fixtures, Demo: envBool("DOGFOOD_DEMO", true)}); err != nil {
		return fmt.Errorf("seed: %w", err)
	}
	srv, err := web.New(svc, web.Config{
		SecureCookies: envBool("DOGFOOD_SECURE_COOKIES", false),
		TrustProxy:    envBool("DOGFOOD_TRUST_PROXY", false),
		PublicURL:     os.Getenv("DOGFOOD_PUBLIC_URL"),
	}, log)
	if err != nil {
		return err
	}
	go svc.RunWebhookWorker(ctx, log)

	addr := env("DOGFOOD_ADDR", ":8080")
	httpSrv := &http.Server{Addr: addr, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 120 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- httpSrv.ListenAndServe() }()
	log.Info("dogfood listening", "addr", addr)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = httpSrv.Shutdown(shutdown)
	svc.DB.Close()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// fixtureReviews loads composite scores from a fixtures-format file using
// equal criterion weights (the fixture declares none).
func fixtureReviews(path string) ([]judging.Review, map[string]string, *core.Doc, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, nil, err
	}
	var d core.Doc
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, nil, nil, err
	}
	titles := map[string]string{}
	for _, p := range d.Projects {
		titles[p.ID] = p.Title
	}
	var rs []judging.Review
	for _, s := range d.Scores {
		sum := 0
		for _, v := range s.Criteria {
			sum += v
		}
		if len(s.Criteria) > 0 {
			rs = append(rs, judging.Review{Judge: s.Judge, Project: s.Project, Score: float64(sum) / float64(len(s.Criteria))})
		}
	}
	return rs, titles, &d, nil
}

// normalize prints the Normalization Proof: raw vs adjusted scores, the rank
// change, judge diagnostics and method agreement, as Markdown.
func normalize(args []string) error {
	fs := flag.NewFlagSet("normalize", flag.ExitOnError)
	boot := fs.Int("bootstrap", 1000, "bootstrap replicates")
	keepDup := fs.Bool("keep-duplicates", false, "keep duplicate submissions in the ranking")
	fs.Parse(args)
	path := "fixtures.json"
	if fs.NArg() > 0 {
		path = fs.Arg(0)
	}
	rs, titles, d, err := fixtureReviews(path)
	if err != nil {
		return err
	}
	excluded := map[string]string{}
	if !*keepDup {
		ps := make([]*core.Project, 0, len(d.Projects))
		for _, p := range d.Projects {
			ps = append(ps, &core.Project{ID: p.ID, EventID: "x", Title: p.Title, RepoURL: p.RepoURL, SubmittedAt: parseTimePtr(p.SubmittedAt)})
		}
		for _, pair := range core.FindDuplicatesForReport(ps) {
			excluded[pair[1].ID] = pair[0].ID
		}
	}
	var kept []judging.Review
	for _, r := range rs {
		if _, ok := excluded[r.Project]; !ok {
			kept = append(kept, r)
		}
	}
	rep := judging.Analyze(kept, 3, judging.Options{Bootstrap: *boot})
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	fmt.Fprintf(w, "# Normalization proof: %s\n\n", path)
	fmt.Fprintf(w, "Generated by `dogfood normalize` (bootstrap %d, seed fixed; rerunning reproduces every number).\n\n", *boot)
	fmt.Fprintf(w, "- Reviews analysed: %d (composite = mean of the criteria, equal weights)\n", rep.Reviews)
	fmt.Fprintf(w, "- Projects ranked: %d; judges: %d; connected components of the judge-project graph: %d\n", len(rep.Projects), len(rep.Judges), rep.Components)
	for dup, orig := range excluded {
		fmt.Fprintf(w, "- Excluded as duplicate: %s (%s) duplicates %s\n", dup, titles[dup], orig)
	}
	f := rep.Fit
	fmt.Fprintf(w, "- Fitted: grand mean %.3f, residual noise sigma %.3f, judge-leniency spread tau_b %.3f (empirical Bayes), quality prior tau_q %.2f, scale prior tau_s %.2f; converged=%v in %d sweeps\n\n",
		f.Mu, f.Sigma, f.TauBias, f.TauQuality, f.TauScale, f.Converged, f.Iterations)
	fmt.Fprintf(w, "## Ranking: raw vs normalized\n\n")
	fmt.Fprintf(w, "| Adj. rank | Project | Reviews | Raw mean | Raw rank | Adjusted | SE | Change | 90%% rank range | P(top %d) | Z-score rank | Induced-BT rank |\n", rep.TopK)
	fmt.Fprintf(w, "|---:|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|\n")
	for _, p := range rep.Projects {
		change := "·"
		if p.RankChange != 0 {
			change = fmt.Sprintf("%+d", p.RankChange)
		}
		prov := ""
		if p.Provisional {
			prov = " (few)"
		}
		fmt.Fprintf(w, "| %d | %s `%s` | %d%s | %.3f | %d | %.3f | %.3f | %s | %d–%d | %.0f%% | %d | %d |\n",
			p.Ranks[judging.MethodBiasScale], titles[p.Project], p.Project, p.Reviews, prov, p.Scores[judging.MethodRaw], p.Ranks[judging.MethodRaw],
			p.Scores[judging.MethodBiasScale], p.SE, change, p.RankLow, p.RankHigh, 100*p.ProbTopK, p.Ranks[judging.MethodZScore], p.Ranks[judging.MethodPairwise])
	}
	fmt.Fprintf(w, "\n## Judges\n\n| Judge | Reviews | Mean given | SD given | Leniency b | SE | Scale s | Flags |\n|---|---:|---:|---:|---:|---:|---:|---|\n")
	for _, j := range rep.Judges {
		fmt.Fprintf(w, "| %s | %d | %.2f | %.2f | %+.3f | %.3f | %.3f | %s |\n", j.Judge, j.Reviews, j.MeanGiven, j.SDGiven, j.Bias, j.BiasSE, j.Scale, strings.Join(j.Flags, "; "))
	}
	fmt.Fprintf(w, "\n## Agreement with the primary ranking (Kendall tau-b)\n\n| Method | tau |\n|---|---:|\n")
	for _, m := range rep.Methods {
		fmt.Fprintf(w, "| %s | %.3f |\n", m, rep.Agreement[m])
	}
	return nil
}

func parseTimePtr(s string) *time.Time {
	t, err := store.ParseTime(s)
	if err != nil {
		return nil
	}
	return &t
}

func simulate(args []string) error {
	fs := flag.NewFlagSet("simulate", flag.ExitOnError)
	trials := fs.Int("trials", 1000, "simulated events per scenario")
	fs.Parse(args)
	path := "fixtures.json"
	if fs.NArg() > 0 {
		path = fs.Arg(0)
	}
	rs, _, _, err := fixtureReviews(path)
	if err != nil {
		return err
	}
	var graph []judging.Pair
	for _, r := range rs {
		graph = append(graph, judging.Pair{Judge: r.Judge, Project: r.Project})
	}
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	fmt.Fprintf(w, "# Monte Carlo validation on the fixture's review graph\n\n")
	fmt.Fprintf(w, "Every trial draws true project quality, judge leniency, judge scale use and noise; generates integer criterion scores through the *exact* judge-project graph of %s (%d reviews, same unfinished batches); then asks each method to recover the true ranking. %d trials per scenario, fixed seeds.\n\n", path, len(graph), *trials)
	base := judging.DefaultSimConfig(graph)
	base.Trials = *trials
	scenarios := []struct {
		name string
		mod  func(*judging.SimConfig)
	}{
		{"Baseline (leniency SD 0.45, scale SD 0.35, 1 in 30 judges flat, noise 0.6)", func(c *judging.SimConfig) {}},
		{"No judge effects at all (the null case: does normalizing hurt?)", func(c *judging.SimConfig) { c.BiasSD, c.ScaleSD, c.FlatShare = 0, 0, 0 }},
		{"Strong leniency differences (SD 0.8)", func(c *judging.SimConfig) { c.BiasSD = 0.8 }},
		{"Heavy scale differences (SD 0.6) and 10% flat judges", func(c *judging.SimConfig) { c.ScaleSD, c.FlatShare = 0.6, 0.1 }},
		{"Very noisy judges (noise 1.0)", func(c *judging.SimConfig) { c.NoiseSD = 1.0 }},
	}
	for i, sc := range scenarios {
		cfg := base
		cfg.Seed = uint64(100 + i)
		sc.mod(&cfg)
		ms := judging.Simulate(cfg)
		fmt.Fprintf(w, "## %s\n\n| Method | Kendall tau vs truth (mean ± SD) | True top-%d recovered | Mean abs rank error | Beats raw mean in |\n|---|---:|---:|---:|---:|\n", sc.name, cfg.TopK)
		for _, m := range ms {
			fmt.Fprintf(w, "| %s | %.3f ± %.3f | %.1f%% | %.2f | %.0f%% of trials |\n", m.Method, m.KendallMean, m.KendallSD, 100*m.TopKHit, m.MeanAbsRank, 100*m.WinRate)
		}
		fmt.Fprintln(w)
	}
	fmt.Fprintf(w, "## Pairwise mode: adaptive vs random pair selection\n\n40 projects, 30 judges, Bradley-Terry ground truth (strength SD 1.2).\n\n| Comparisons | Adaptive tau | Random tau | Adaptive top-5 | Random top-5 |\n|---:|---:|---:|---:|---:|\n")
	for _, r := range judging.SimulatePairwise(40, 30, []int{80, 160, 320, 640}, max(*trials/10, 20), 11) {
		fmt.Fprintf(w, "| %d | %.3f | %.3f | %.1f%% | %.1f%% |\n", r.Budget, r.AdaptiveTau, r.RandomTau, 100*r.AdaptiveTopK, 100*r.RandomTopK)
	}
	return nil
}

func verifyRecord(args []string) error {
	fs := flag.NewFlagSet("verify-record", flag.ExitOnError)
	key := fs.String("key", "", "base64 Ed25519 public key (from /.well-known/dogfood-signing-key)")
	fs.Parse(args)
	if fs.NArg() != 1 || *key == "" {
		return errors.New("usage: dogfood verify-record record.json --key BASE64")
	}
	pub, err := base64.StdEncoding.DecodeString(*key)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("--key is not a base64 Ed25519 public key")
	}
	b, err := os.ReadFile(fs.Arg(0))
	if err != nil {
		return err
	}
	var rec core.SignedRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		// Accept the API response shape {"record": {...}} too.
		var wrapped struct{ Record core.SignedRecord }
		if json.Unmarshal(b, &wrapped) != nil {
			return errors.New("file is not a signed record")
		}
		rec = wrapped.Record
	}
	if rec.Payload == "" {
		var wrapped struct{ Record core.SignedRecord }
		json.Unmarshal(b, &wrapped)
		rec = wrapped.Record
	}
	p, err := core.VerifyRecord(ed25519.PublicKey(pub), rec)
	if err != nil {
		return fmt.Errorf("INVALID: %w", err)
	}
	out, _ := json.MarshalIndent(p, "", "  ")
	fmt.Printf("VALID (key %s)\n%s\n", core.KeyID(pub), out)
	return nil
}

func adminActor(ctx context.Context, svc *core.Service) (core.Actor, error) {
	var id string
	if err := svc.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at LIMIT 1`).Scan(&id); err != nil {
		return core.Actor{}, errors.New("no admin account; start the portal once to seed one")
	}
	u, err := svc.UserByID(ctx, id)
	return core.Actor{User: u, Source: "cli"}, err
}

func export(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: dogfood export EVENT_ID_OR_SLUG > event.json")
	}
	ctx := context.Background()
	svc, err := openService(ctx)
	if err != nil {
		return err
	}
	a, err := adminActor(ctx, svc)
	if err != nil {
		return err
	}
	d, err := svc.Export(ctx, a, args[0])
	if err != nil {
		return err
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(d)
}

func importDoc(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: dogfood import event.json")
	}
	ctx := context.Background()
	svc, err := openService(ctx)
	if err != nil {
		return err
	}
	a, err := adminActor(ctx, svc)
	if err != nil {
		return err
	}
	b, err := os.ReadFile(args[0])
	if err != nil {
		return err
	}
	var d core.Doc
	if err := json.Unmarshal(b, &d); err != nil {
		return err
	}
	res, err := svc.Import(ctx, a, &d)
	if err != nil {
		return err
	}
	out, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(out))
	return nil
}

func setPassword(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: dogfood set-password EMAIL (reads the password from stdin)")
	}
	fmt.Fprint(os.Stderr, "New password (10+ characters): ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return err
	}
	ctx := context.Background()
	svc, err := openService(ctx)
	if err != nil {
		return err
	}
	if err := svc.SetPassword(ctx, args[0], strings.TrimRight(line, "\r\n")); err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "password updated")
	return nil
}
