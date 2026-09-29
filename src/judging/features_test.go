package judging

import (
	"math"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
)

// Each leave-one-judge-out refit reports its own top k, and those refits
// agree with the existing top_k_flips list.
func TestRefitTopKMatchesFlips(t *testing.T) {
	rep := Analyze(loadFixtureReviews(t), 3, Options{Bootstrap: 50})
	rb := rep.Robustness
	if len(rb.RefitTopK) != rb.Refits {
		t.Fatalf("refit_top_k has %d entries, want one per refit (%d)", len(rb.RefitTopK), rb.Refits)
	}
	var flips []string
	for j, top := range rb.RefitTopK {
		if len(top) != len(rb.TopK) {
			t.Fatalf("%s: refit top has %d projects, want %d", j, len(top), len(rb.TopK))
		}
		a, b := slices.Clone(top), slices.Clone(rb.TopK)
		slices.Sort(a)
		slices.Sort(b)
		if !slices.Equal(a, b) {
			flips = append(flips, j)
		}
	}
	slices.Sort(flips)
	want := slices.Clone(rb.TopKFlips)
	slices.Sort(want)
	if !slices.Equal(flips, want) {
		t.Fatalf("judges whose refit top-k differs = %v, top_k_flips = %v", flips, want)
	}
}

// The rank distribution is a complete histogram of the bootstrap, and
// P(top k) read from it is the reported prob_top_k.
func TestRankDistAgreesWithProbTopK(t *testing.T) {
	const b = 80
	rep := Analyze(loadFixtureReviews(t), 3, Options{Bootstrap: b})
	for _, p := range rep.Projects {
		if len(p.RankDist) != len(rep.Projects) {
			t.Fatalf("%s: rank_dist has %d bins, want %d", p.Project, len(p.RankDist), len(rep.Projects))
		}
		sum, top := 0, 0
		for r, c := range p.RankDist {
			sum += c
			if r < rep.TopK {
				top += c
			}
		}
		if sum != b {
			t.Fatalf("%s: rank_dist sums to %d, want %d", p.Project, sum, b)
		}
		if got := float64(top) / b; math.Abs(got-p.ProbTopK) > 1e-12 {
			t.Fatalf("%s: P(top %d) from rank_dist = %.4f, prob_top_k = %.4f", p.Project, rep.TopK, got, p.ProbTopK)
		}
	}
}

// Honest judges are flagged near the permutation test's nominal 5%, and a
// judge who stops using the scale is caught most of the time.
func TestDriftFalseFlagRateAndPower(t *testing.T) {
	r := SimulateDrift(10, 60, 5)
	t.Logf("drift, 10 reviews/judge: %d honest judges, false flags %.1f%%, flattening caught %.0f%%, erratic caught %.0f%%",
		r.Judges, 100*r.FalseFlagRate, 100*r.FlattenCaught, 100*r.ErraticCaught)
	if r.FalseFlagRate > 0.08 {
		t.Fatalf("false-flag rate %.3f, want <= 0.08", r.FalseFlagRate)
	}
	if r.FlattenCaught < 0.5 {
		t.Fatalf("flattening caught in %.2f of trials, want >= 0.5", r.FlattenCaught)
	}
}

func TestDriftNeedsOrderAndEnoughReviews(t *testing.T) {
	var rs []Review
	for p := range 6 {
		rs = append(rs, Review{Judge: "a", Project: string(rune('A' + p)), Score: float64(1 + p%5), Seq: p + 1})
	}
	for _, j := range judgeDiagnosticsWithDrift(rs) {
		if j.Drift != nil {
			t.Fatalf("drift computed from %d reviews, minimum is %d", j.Reviews, DriftMinReviews)
		}
	}
	for i := range rs {
		rs[i].Seq = 0
	}
	for p := 6; p < 10; p++ {
		rs = append(rs, Review{Judge: "a", Project: string(rune('A' + p)), Score: float64(1 + p%5)})
	}
	for _, j := range judgeDiagnosticsWithDrift(rs) {
		if j.Drift != nil {
			t.Fatal("drift computed without a writing order")
		}
	}
}

func judgeDiagnosticsWithDrift(rs []Review) []*JudgeResult {
	f := FitModel(rs, true, Options{Bootstrap: -1})
	js := judgeDiagnostics(rs, f)
	drift(js, rs, f, 1)
	return js
}

func TestSelectPairAvoidsPreviousProjects(t *testing.T) {
	ids := []string{"a", "b", "c", "d", "e"}
	f := FitBT(nil, ids)
	rng := rand.New(rand.NewPCG(3, 4))
	avoid := map[string]bool{"a": true, "b": true}
	for range 50 {
		x, y, ok := SelectPair(f, ids, map[[2]string]bool{}, map[[2]string]int{}, rng, PairPolicy{Avoid: avoid})
		if !ok || avoid[x] || avoid[y] {
			t.Fatalf("got %s-%s, want a pair without a or b", x, y)
		}
	}
	// With only avoided projects left, it still offers a pair.
	if _, _, ok := SelectPair(f, []string{"a", "b"}, map[[2]string]bool{}, map[[2]string]int{}, rng, PairPolicy{Avoid: avoid}); !ok {
		t.Fatal("no pair offered when every candidate is avoided")
	}
}

func TestPairReasonDoesNotRevealTheFavourite(t *testing.T) {
	cs := []Comparison{{A: "a", B: "c", Outcome: 1}, {A: "b", B: "c", Outcome: 1}, {A: "a", B: "b", Outcome: 0.5}}
	f := FitBT(cs, []string{"a", "b", "c", "d"})
	if got := PairReason(f, "d", "c"); !strings.Contains(got, "hasn't been compared") {
		t.Fatalf("reason for an uncompared project = %q", got)
	}
	ab, ba := PairReason(f, "a", "b"), PairReason(f, "b", "a")
	if ab != ba {
		t.Fatalf("reason depends on order, which would reveal the favourite: %q vs %q", ab, ba)
	}
}

func TestBTRankDistSumsToReplicates(t *testing.T) {
	cs := []Comparison{{A: "a", B: "b", Outcome: 1}, {A: "b", B: "c", Outcome: 1}, {A: "a", B: "c", Outcome: 1}}
	d := BTRankDist(cs, []string{"a", "b", "c"}, 40, 9)
	for it, counts := range d {
		sum := 0
		for _, c := range counts {
			sum += c
		}
		if sum != 40 {
			t.Fatalf("%s: rank counts sum to %d, want 40", it, sum)
		}
	}
	if d["a"][0] <= d["c"][0] {
		t.Fatalf("a beat everyone but is first in %d replicates vs c's %d", d["a"][0], d["c"][0])
	}
}
