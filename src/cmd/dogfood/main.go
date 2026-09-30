// Command dogfood runs the portal and its offline tools.
//
//	dogfood serve                      start the portal (default)
//	dogfood normalize [fixtures.json]  print the normalization proof report
//	dogfood simulate [fixtures.json]   Monte Carlo validation of every method
//	dogfood verify-record FILE --key B64
//	dogfood verify-results BUNDLE --key B64  reproduce a published ranking offline
//	dogfood verify-audit RECEIPT        check a saved audit receipt or checkpoint against DOGFOOD_DB
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
	case "verify-results":
		err = verifyResults(args)
	case "verify-review":
		err = verifyReview(args)
	case "verify-audit":
		err = verifyAudit(args)
	case "export":
		err = export(args)
	case "import":
		err = importDoc(args)
	case "set-password":
		err = setPassword(args)
	case "backup":
		err = backup(args)
	case "help", "-h", "--help":
		fmt.Println("usage: dogfood [serve|normalize|simulate|verify-record|verify-results|verify-review|verify-audit|export|import|set-password|backup]")
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
	oauth := core.OAuthProviders(os.Getenv)
	if len(oauth) > 0 {
		base := os.Getenv("DOGFOOD_PUBLIC_URL")
		if base == "" {
			log.Warn("sign-in providers are enabled but DOGFOOD_PUBLIC_URL is not set; redirect URIs will follow the request host")
			base = "http://localhost:8080"
		}
		for i, u := range web.OAuthCallbackPaths(base, oauth) {
			log.Info("sign-in provider enabled", "provider", oauth[i].Name, "redirect_uri", u)
		}
	}
	srv, err := web.New(svc, web.Config{
		SecureCookies: envBool("DOGFOOD_SECURE_COOKIES", false),
		TrustProxy:    envBool("DOGFOOD_TRUST_PROXY", false),
		PublicURL:     os.Getenv("DOGFOOD_PUBLIC_URL"),
		FrontendURL:   os.Getenv("DOGFOOD_FRONTEND_URL"),
		OAuth:         oauth,
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
	fmt.Fprintf(w, "## Pairwise mode: adaptive vs random pair selection\n\n40 projects, 30 judges, Bradley-Terry ground truth (strength SD 1.2). *Adaptive* is the live rule (outcome uncertainty p(1-p), damped by comparison counts; a judge's previous projects are kept out of their next pair). *Variance* picks the pair with the largest expected drop in SE_a² + SE_b². It ships only if it matches or beats adaptive at every budget.\n\n| Comparisons | Adaptive tau | Variance tau | Random tau | Adaptive top-5 | Variance top-5 | Random top-5 |\n|---:|---:|---:|---:|---:|---:|---:|\n")
	ships := true
	for _, r := range judging.SimulatePairwise(40, 30, []int{80, 160, 320, 640}, max(*trials/10, 20), 11) {
		fmt.Fprintf(w, "| %d | %.3f | %.3f | %.3f | %.1f%% | %.1f%% | %.1f%% |\n", r.Budget, r.AdaptiveTau, r.InfoTau, r.RandomTau, 100*r.AdaptiveTopK, 100*r.InfoTopK, 100*r.RandomTopK)
		if r.InfoTau < r.AdaptiveTau || r.InfoTopK < r.AdaptiveTopK {
			ships = false
		}
	}
	if ships {
		fmt.Fprintf(w, "\nVariance-based selection matches or beats the live rule at every budget.\n")
	} else {
		fmt.Fprintf(w, "\nVariance-based selection does not match the live rule at every budget, so the live rule stays the default.\n")
	}
	fmt.Fprintf(w, "\n## Pairwise ties: half a win vs the Davidson model vs Elo\n\n20 projects, random pairs, Davidson ground truth with nu = 0.8 (evenly matched projects tie 29%% of the time). *Half-win* is the live ranking; *Davidson* models ties; *Elo* (K = %.0f) is averaged over random orders of the same verdicts. The last column is how often Davidson's 90%% interval for nu covers the truth.\n\n| Comparisons | Ties | Half-win tau | Davidson tau | Elo tau | Mean nu | nu covered |\n|---:|---:|---:|---:|---:|---:|---:|\n", judging.EloK)
	for _, r := range judging.SimulatePairModels(20, 0.8, []int{60, 120, 240, 480}, max(*trials/5, 40), 29) {
		fmt.Fprintf(w, "| %d | %.0f%% | %.3f | %.3f | %.3f | %.2f | %.0f%% |\n", r.Budget, 100*r.TieShare, r.BTTau, r.DavidsonTau, r.EloTau, r.NuMean, 100*r.NuCover)
	}
	fmt.Fprintf(w, "\n## Judge fatigue: drift check\n\n40 projects, 12 judges writing their reviews in random order. In every world one judge gives a constant score for their second half (flattening) and one triples their noise for it (erratic); the rest never change. Each check is a permutation test at %.1f%% per tail.\n\n| Reviews per judge | Honest judges | False flags | Flattening caught | Erratic caught |\n|---:|---:|---:|---:|---:|\n", 100*judging.DriftAlpha)
	for _, n := range []int{8, 10, 16, 24} {
		r := judging.SimulateDrift(n, max(*trials/5, 40), 23)
		fmt.Fprintf(w, "| %d | %d | %.1f%% | %.0f%% | %.0f%% |\n", n, r.Judges, 100*r.FalseFlagRate, 100*r.FlattenCaught, 100*r.ErraticCaught)
	}
	return nil
}

// verifyAudit holds a saved receipt or checkpoint up against a database copy.
func verifyAudit(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: DOGFOOD_DB=path dogfood verify-audit receipt.json")
	}
	b, err := os.ReadFile(args[0])
	if err != nil {
		return err
	}
	var rec core.SignedRecord
	json.Unmarshal(b, &rec)
	if rec.Payload == "" { // the API response shape {"record": {...}}
		var wrapped struct{ Record core.SignedRecord }
		json.Unmarshal(b, &wrapped)
		rec = wrapped.Record
	}
	if rec.Payload == "" {
		return errors.New("file is not a signed audit receipt or checkpoint")
	}
	ctx := context.Background()
	svc, err := openService(ctx)
	if err != nil {
		return err
	}
	res, err := svc.CheckAuditProof(ctx, rec)
	if err != nil {
		return err
	}
	if !res.Valid {
		for _, m := range res.Mismatches {
			fmt.Printf("entry %d: signed hash %s, database has %q\n", m.Seq, m.Want, m.Got)
		}
		return fmt.Errorf("FAILED: %s", res.Reason)
	}
	fmt.Printf("VERIFIED: %d pinned entries match, chain intact (%d entries)\n", res.Checked, res.Chain.Entries)
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

// verifyResults re-runs the scoring engine on a published results bundle.
func verifyResults(args []string) error {
	fs := flag.NewFlagSet("verify-results", flag.ExitOnError)
	key := fs.String("key", "", "base64 Ed25519 public key (from /.well-known/dogfood-signing-key)")
	// Allow the key flag after the file name, as the docs show it.
	var files []string
	for len(args) > 0 {
		fs.Parse(args)
		if fs.NArg() == 0 {
			break
		}
		files = append(files, fs.Arg(0))
		args = fs.Args()[1:]
	}
	if len(files) != 1 || *key == "" {
		return errors.New("usage: dogfood verify-results bundle.json --key BASE64")
	}
	pub, err := base64.StdEncoding.DecodeString(*key)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("--key is not a base64 Ed25519 public key")
	}
	b, err := os.ReadFile(files[0])
	if err != nil {
		return err
	}
	var bundle core.ResultsBundle
	if err := json.Unmarshal(b, &bundle); err != nil {
		return fmt.Errorf("not a results bundle: %w", err)
	}
	v := core.VerifyBundle(ed25519.PublicKey(pub), bundle)
	mark := func(ok bool) string {
		if ok {
			return "OK  "
		}
		return "FAIL"
	}
	fmt.Printf("%s signature (key %s)\n", mark(v.Signature), core.KeyID(pub))
	fmt.Printf("%s input fingerprint %s\n", mark(v.Digest), core.InputDigest(bundle.Inputs))
	fmt.Printf("%s ranking re-computed from %d reviews (max score difference %.2g)\n", mark(v.Reproduced), len(bundle.Inputs.Reviews), v.MaxDelta)
	for _, p := range v.Problems {
		fmt.Println("     -", p)
	}
	if v.Manifest != nil && len(v.Manifest.Ranking) > 0 {
		when := "unpublished preview"
		if v.Manifest.PublishedAt != "" {
			when = "published " + v.Manifest.PublishedAt
		}
		fmt.Printf("\n%s (%s, engine %s)\n", v.Manifest.EventName, when, v.Manifest.Engine)
		for i, e := range v.Manifest.Ranking {
			if i == 5 {
				break
			}
			fmt.Printf("  %d. %s (%s) %.3f\n", e.Rank, e.Title, e.Project, e.Adjusted)
		}
	}
	if !v.Signature || !v.Digest || !v.Reproduced {
		return errors.New("results NOT verified")
	}
	fmt.Println("\nVERIFIED: the published ranking follows from the published inputs.")
	return nil
}

// verifyReview proves that every review in a judge's signed record is in a
// published results bundle, unchanged, under the manifest's review root.
func verifyReview(args []string) error {
	fs := flag.NewFlagSet("verify-review", flag.ExitOnError)
	bundlePath := fs.String("bundle", "", "results bundle JSON (GET /api/v1/events/{event}/results/bundle)")
	recordPath := fs.String("record", "", "the judge's signed record JSON (GET /api/v1/events/{event}/records/judge)")
	key := fs.String("key", "", "base64 Ed25519 public key (from /.well-known/dogfood-signing-key)")
	fs.Parse(args)
	if *bundlePath == "" || *recordPath == "" || *key == "" {
		return errors.New("usage: dogfood verify-review --bundle bundle.json --record record.json --key BASE64")
	}
	pub, err := base64.StdEncoding.DecodeString(*key)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("--key is not a base64 Ed25519 public key")
	}
	b, err := os.ReadFile(*bundlePath)
	if err != nil {
		return err
	}
	var bundle core.ResultsBundle
	if err := json.Unmarshal(b, &bundle); err != nil {
		return fmt.Errorf("not a results bundle: %w", err)
	}
	r, err := os.ReadFile(*recordPath)
	if err != nil {
		return err
	}
	var rec core.SignedRecord
	json.Unmarshal(r, &rec)
	if rec.Payload == "" {
		var wrapped struct{ Record core.SignedRecord }
		json.Unmarshal(r, &wrapped)
		rec = wrapped.Record
	}
	payload, err := core.VerifyRecord(ed25519.PublicKey(pub), rec)
	if err != nil {
		return fmt.Errorf("record INVALID: %w", err)
	}
	v := core.VerifyBundle(ed25519.PublicKey(pub), bundle)
	if !v.Signature || v.Manifest == nil {
		return errors.New("bundle manifest signature is INVALID for this key")
	}
	m := v.Manifest
	switch {
	case m.Type != core.ManifestV2:
		return fmt.Errorf("manifest is %s, which has no review root; per-review proofs need %s", m.Type, core.ManifestV2)
	case v.ReviewRoot == nil || !*v.ReviewRoot:
		return errors.New("the bundle's reviews do not hash to the signed review root")
	case payload.EventID != m.EventID:
		return fmt.Errorf("record is for event %s, bundle for %s", payload.EventID, m.EventID)
	case len(payload.ReviewLeaves) == 0:
		return errors.New("the record carries no review leaves (issued before per-review proofs, or no reviews)")
	}
	fmt.Printf("OK   record signed by key %s for %s (%s)\n", core.KeyID(pub), payload.Name, payload.Pseudonym)
	fmt.Printf("OK   manifest signed; %d reviews committed under root %s\n", m.ReviewCount, m.ReviewRoot)
	failed := 0
	for _, c := range core.VerifyReviews(bundle, m, payload.ReviewLeaves) {
		if c.OK {
			fmt.Printf("OK   review of %s is leaf %d (%d-hash path)\n", c.Project, c.Index, len(c.Path))
			continue
		}
		failed++
		fmt.Printf("FAIL leaf %s…: %s\n", c.Leaf[:min(12, len(c.Leaf))], c.Problem)
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d reviews NOT found unchanged in the published results", failed, len(payload.ReviewLeaves))
	}
	fmt.Printf("\nVERIFIED: all %d of your reviews are in the published results, unchanged.\n", len(payload.ReviewLeaves))
	fmt.Println("This proves inclusion and integrity after publication, not that any judge scored honestly.")
	return nil
}

// backup writes a consistent copy of the live database with VACUUM INTO,
// which SQLite runs inside a read transaction: the server keeps serving.
func backup(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: dogfood backup PATH (PATH must not exist yet)")
	}
	if _, err := os.Stat(args[0]); err == nil {
		return fmt.Errorf("%s already exists; choose a new file name", args[0])
	}
	db, err := store.Open(env("DOGFOOD_DB", "data/dogfood.db"))
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err := db.ExecContext(context.Background(), `VACUUM INTO ?`, args[0]); err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}
	fmt.Fprintln(os.Stderr, "backup written to", args[0])
	return nil
}
