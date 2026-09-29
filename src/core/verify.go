package core

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"

	"dogfood/src/judging"
	"dogfood/src/store"
)

// ---------------------------------------------------------------------------
// Tie-breaker assignment: spend the next reviews where they can change a prize.

type TiebreakReport struct {
	Candidates []TiebreakCandidate   `json:"candidates"`
	Assign     *judging.AssignReport `json:"assign"`
}

type TiebreakCandidate struct {
	ProjectID string  `json:"project_id"`
	Title     string  `json:"title"`
	ProbTopK  float64 `json:"prob_top_k"`
	Reviews   int     `json:"reviews"`
}

// RunTiebreak adds one reviewer to each of up to max projects whose top-k
// membership is still uncertain (P(top k) strictly between 5% and 95%).
func (s *Service) RunTiebreak(ctx context.Context, a Actor, eventID string, max int) (*TiebreakReport, error) {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleOrganizer); err != nil {
		return nil, err
	}
	if !e.JudgingOpen(s.now()) {
		return nil, &Error{KindConflict, "judging_closed", "tie-breaker reviews need judging to be open"}
	}
	if max < 1 || max > 50 {
		max = 5
	}
	res, err := s.Results(ctx, a, e.ID, 300)
	if err != nil {
		return nil, err
	}
	picked := judging.Tiebreak(res.Report, max, 0.05, 0.95)
	out := &TiebreakReport{}
	if len(picked) == 0 {
		out.Assign = &judging.AssignReport{}
		return out, nil
	}
	titles := map[string]string{}
	for _, r := range res.Rows {
		titles[r.Project.ID] = r.Project.Title
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		in, err := s.assignInput(ctx, tx, e)
		if err != nil {
			return err
		}
		have := map[string]int{}
		for _, p := range in.Existing {
			have[p.Project]++
		}
		want := map[string]bool{}
		in.Targets, in.Reasons = map[string]int{}, map[string]string{}
		for _, p := range picked {
			want[p.Project] = true
			in.Targets[p.Project] = have[p.Project] + 1
			in.Reasons[p.Project] = fmt.Sprintf("tie-breaker: P(top %d) = %.0f%%", res.Report.TopK, 100*p.ProbTopK)
			out.Candidates = append(out.Candidates, TiebreakCandidate{p.Project, titles[p.Project], p.ProbTopK, p.Reviews})
		}
		var projects []judging.ProjectInfo
		for _, p := range in.Projects {
			if want[p.ID] {
				projects = append(projects, p)
			}
		}
		in.Projects = projects
		out.Assign = judging.Assign(in)
		for _, n := range out.Assign.New {
			if _, err := tx.ExecContext(ctx, `INSERT INTO assignments (event_id, judge_id, project_id, status, reason, assigned_at)
				VALUES (?, ?, ?, 'pending', ?, ?)`, e.ID, n.Judge, n.Project, n.Reason, s.nowS()); err != nil {
				return err
			}
		}
		return s.audit(ctx, tx, a, e.ID, "assignment.tiebreak", e.ID, map[string]any{
			"candidates": len(out.Candidates), "new": len(out.Assign.New)})
	})
	return out, err
}

// ---------------------------------------------------------------------------
// Verifiable results.
//
// A published event exposes a bundle: the anonymized inputs (every review's
// criterion values, judges replaced by keyed pseudonyms), the rubric weights,
// and a manifest signed with the instance's Ed25519 key that commits to a
// SHA-256 of those inputs, the audit-chain hash of the publication, and the
// ranking the engine computed from exactly those inputs. `dogfood
// verify-results` re-runs the same engine offline and must arrive at the same
// ranking; nobody has to trust the organizer's screen.

type BundleCriterion struct {
	Key    string  `json:"key"`
	Weight float64 `json:"weight"`
}

type BundleReview struct {
	Judge   string         `json:"judge"` // pseudonym, stable within the event
	Project string         `json:"project"`
	Values  map[string]int `json:"values"`
}

type BundleInputs struct {
	EventID           string            `json:"event_id"`
	ReviewsPerProject int               `json:"reviews_per_project"`
	Criteria          []BundleCriterion `json:"criteria"` // in rubric order
	Reviews           []BundleReview    `json:"reviews"`  // sorted by project, then judge
	Excluded          []string          `json:"excluded"` // duplicates and disqualified projects
}

type ManifestEntry struct {
	Rank     int     `json:"rank"`
	Project  string  `json:"project"`
	Title    string  `json:"title"`
	Adjusted float64 `json:"adjusted"`
}

// ManifestV1 and ManifestV2 name the manifest formats. v2 adds ReviewRoot;
// bundles signed as v1 still verify.
const (
	ManifestV1 = "dogfood.results/v1"
	ManifestV2 = "dogfood.results/v2"
)

type Manifest struct {
	Type        string          `json:"type"` // ManifestV1 or ManifestV2
	EventID     string          `json:"event_id"`
	EventName   string          `json:"event_name"`
	PublishedAt string          `json:"published_at"`
	Engine      string          `json:"engine"`
	InputDigest string          `json:"input_digest"`
	AuditAnchor string          `json:"audit_anchor"` // hash of the results.publish audit entry
	Ranking     []ManifestEntry `json:"ranking"`
	KeyID       string          `json:"key_id"`
	// ReviewRoot (v2) is the Merkle root over every review leaf, in bundle order.
	ReviewRoot  string `json:"review_root,omitempty"`
	ReviewCount int    `json:"review_count,omitempty"`
}

type ResultsBundle struct {
	Manifest SignedRecord `json:"manifest"`
	Inputs   BundleInputs `json:"inputs"`
}

// EngineVersion names the scoring method and its fixed priors. Changing the
// maths must change this string so old bundles stay honestly labelled.
const EngineVersion = "biasscale/v1 tau_s=0.30 tau_q=1.00"

// InputDigest hashes the canonical JSON of the inputs.
func InputDigest(in BundleInputs) string {
	b, _ := json.Marshal(in)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// RankInputs computes the published ranking from bundle inputs. The portal
// and the offline verifier both call exactly this function.
func RankInputs(in BundleInputs) []ManifestEntry {
	var total float64
	for _, c := range in.Criteria {
		total += c.Weight
	}
	var reviews []judging.Review
	for _, r := range in.Reviews {
		acc := 0.0
		for _, c := range in.Criteria {
			acc += c.Weight * float64(r.Values[c.Key])
		}
		if total > 0 {
			reviews = append(reviews, judging.Review{Judge: r.Judge, Project: r.Project, Score: acc / total})
		}
	}
	f := judging.FitModel(reviews, true, judging.Options{})
	adj := map[string]float64{}
	for p := range f.Quality {
		adj[p] = f.Adjusted(p)
	}
	ranks := judging.RankOf(adj)
	out := make([]ManifestEntry, 0, len(adj))
	for p, r := range ranks {
		out = append(out, ManifestEntry{Rank: r, Project: p, Adjusted: math.Round(adj[p]*1e9) / 1e9})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rank < out[j].Rank })
	return out
}

func (s *Service) pseudonym(eventID, judgeID string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte("judge-pseudonym:" + eventID + ":" + judgeID))
	return "J-" + hex.EncodeToString(m.Sum(nil))[:10]
}

// Bundle returns the verifiable results bundle: public once results are
// published, organizers may preview it before.
func (s *Service) Bundle(ctx context.Context, a Actor, eventID string) (*ResultsBundle, error) {
	e, err := s.Event(ctx, a, eventID)
	if err != nil {
		return nil, err
	}
	roles, err := s.Roles(ctx, a, e.ID)
	if err != nil {
		return nil, err
	}
	if !e.Published() && !roles[RoleOrganizer] {
		return nil, errForbidden("results are not published yet")
	}
	in, titles, err := s.bundleInputs(ctx, e)
	if err != nil {
		return nil, err
	}
	m := Manifest{Type: ManifestV2, EventID: e.ID, EventName: e.Name, Engine: EngineVersion,
		InputDigest: InputDigest(in), Ranking: RankInputs(in), KeyID: s.signer.KeyID,
		ReviewRoot: ReviewRoot(in), ReviewCount: len(in.Reviews)}
	for i := range m.Ranking {
		m.Ranking[i].Title = titles[m.Ranking[i].Project]
	}
	if e.ResultsPublishedAt != nil {
		m.PublishedAt = store.FormatTime(*e.ResultsPublishedAt)
		s.DB.QueryRowContext(ctx, `SELECT hash FROM audit_log WHERE event_id = ? AND action = 'results.publish' ORDER BY seq DESC LIMIT 1`,
			e.ID).Scan(&m.AuditAnchor)
	}
	body, _ := json.Marshal(m)
	return &ResultsBundle{
		Manifest: SignedRecord{Payload: base64.StdEncoding.EncodeToString(body),
			Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(s.signer.priv, body)), KeyID: s.signer.KeyID},
		Inputs: in,
	}, nil
}

// bundleInputs gathers the anonymized inputs of an event's results, plus
// project titles. Judge records use it too, so their leaves match the bundle's.
func (s *Service) bundleInputs(ctx context.Context, e *Event) (BundleInputs, map[string]string, error) {
	titles := map[string]string{}
	live := map[string]bool{}
	in := BundleInputs{EventID: e.ID, ReviewsPerProject: e.ReviewsPerProject, Excluded: []string{}}
	rows, err := s.DB.QueryContext(ctx, `SELECT id, title, duplicate_of IS NOT NULL OR disqualified_reason IS NOT NULL
		FROM projects WHERE event_id = ? AND status = 'submitted' ORDER BY id`, e.ID)
	if err != nil {
		return in, nil, err
	}
	for rows.Next() {
		var id, title string
		var excluded bool
		rows.Scan(&id, &title, &excluded)
		titles[id] = title
		if excluded {
			in.Excluded = append(in.Excluded, id)
		} else {
			live[id] = true
		}
	}
	rows.Close()
	for _, c := range e.Criteria {
		in.Criteria = append(in.Criteria, BundleCriterion{Key: c.Key, Weight: c.Weight})
	}
	rs, err := s.reviews(ctx, s.DB, "rv.event_id = ?", e.ID)
	if err != nil {
		return in, nil, err
	}
	for _, r := range rs {
		if live[r.ProjectID] {
			in.Reviews = append(in.Reviews, BundleReview{Judge: s.pseudonym(e.ID, r.JudgeID), Project: r.ProjectID, Values: r.Scores})
		}
	}
	sort.Slice(in.Reviews, func(i, j int) bool {
		if in.Reviews[i].Project != in.Reviews[j].Project {
			return in.Reviews[i].Project < in.Reviews[j].Project
		}
		return in.Reviews[i].Judge < in.Reviews[j].Judge
	})
	return in, titles, nil
}

// BundleVerification is what the offline verifier reports.
type BundleVerification struct {
	Manifest   *Manifest `json:"manifest"`
	Signature  bool      `json:"signature_valid"`
	Digest     bool      `json:"digest_matches"`
	Reproduced bool      `json:"ranking_reproduced"`
	// ReviewRoot is nil for v1 manifests, which carry no root to check.
	ReviewRoot *bool    `json:"review_root_matches,omitempty"`
	MaxDelta   float64  `json:"max_score_delta"`
	Problems   []string `json:"problems"`
}

// VerifyBundle checks the signature, recomputes the input digest, and re-runs
// the engine on the inputs. Scores must agree to 1e-6 (floating-point
// summation can differ in the last bits across CPU architectures) and every
// rank difference must be explained by such a near-exact tie.
func VerifyBundle(pub ed25519.PublicKey, b ResultsBundle) BundleVerification {
	v := BundleVerification{Problems: []string{}}
	body, err := base64.StdEncoding.DecodeString(b.Manifest.Payload)
	sig, err2 := base64.StdEncoding.DecodeString(b.Manifest.Signature)
	if err != nil || err2 != nil {
		v.Problems = append(v.Problems, "manifest is not base64")
		return v
	}
	v.Signature = ed25519.Verify(pub, body, sig)
	if !v.Signature {
		v.Problems = append(v.Problems, "signature does not match this key: the manifest was altered or signed elsewhere")
	}
	var m Manifest
	if err := json.Unmarshal(body, &m); err != nil {
		v.Problems = append(v.Problems, "manifest is not JSON")
		return v
	}
	v.Manifest = &m
	v.Digest = InputDigest(b.Inputs) == m.InputDigest
	if !v.Digest {
		v.Problems = append(v.Problems, "inputs do not match the digest in the signed manifest: reviews were added, removed or changed")
	}
	if m.Type == ManifestV2 {
		ok := ReviewRoot(b.Inputs) == m.ReviewRoot && m.ReviewCount == len(b.Inputs.Reviews)
		v.ReviewRoot = &ok
		if !ok {
			v.Problems = append(v.Problems, "reviews do not hash to the review root in the signed manifest")
		}
	}
	got := RankInputs(b.Inputs)
	want := map[string]ManifestEntry{}
	for _, e := range m.Ranking {
		want[e.Project] = e
	}
	v.Reproduced = len(got) == len(m.Ranking)
	if !v.Reproduced {
		v.Problems = append(v.Problems, fmt.Sprintf("engine ranked %d projects, manifest lists %d", len(got), len(m.Ranking)))
	}
	byRank := map[int]ManifestEntry{}
	for _, e := range got {
		byRank[e.Rank] = e
		w, ok := want[e.Project]
		if !ok {
			v.Reproduced = false
			v.Problems = append(v.Problems, e.Project+" is ranked by the engine but missing from the manifest")
			continue
		}
		d := math.Abs(w.Adjusted - e.Adjusted)
		v.MaxDelta = math.Max(v.MaxDelta, d)
		if d > 1e-6 {
			v.Reproduced = false
			v.Problems = append(v.Problems, fmt.Sprintf("%s: engine %.6f, manifest %.6f", e.Project, e.Adjusted, w.Adjusted))
		}
	}
	for _, e := range got {
		w := want[e.Project]
		if w.Rank != e.Rank {
			other := byRank[w.Rank]
			if math.Abs(other.Adjusted-e.Adjusted) > 1e-6 {
				v.Reproduced = false
				v.Problems = append(v.Problems, fmt.Sprintf("%s: engine rank %d, manifest rank %d", e.Project, e.Rank, w.Rank))
			}
		}
	}
	return v
}
