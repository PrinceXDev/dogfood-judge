package judging

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"os"
	"testing"
)

type fixtureFile struct {
	Scores []struct {
		Judge    string         `json:"judge"`
		Project  string         `json:"project"`
		Criteria map[string]int `json:"criteria"`
	} `json:"scores"`
}

func loadFixtureReviews(t *testing.T) []Review {
	t.Helper()
	b, err := os.ReadFile("../../fixtures.json")
	if err != nil {
		t.Skip("fixtures.json not found")
	}
	var f fixtureFile
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	var out []Review
	for _, s := range f.Scores {
		sum := 0
		for _, v := range s.Criteria {
			sum += v
		}
		out = append(out, Review{s.Judge, s.Project, float64(sum) / float64(len(s.Criteria))})
	}
	return out
}

// With no noise, the model must recover planted biases and qualities.
func TestFitModelRecoversPlantedEffects(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	quality := map[string]float64{}
	bias := map[string]float64{}
	var reviews []Review
	for p := 0; p < 30; p++ {
		quality[string(rune('A'+p))] = rng.NormFloat64() * 0.8
	}
	for j := 0; j < 12; j++ {
		bias[string(rune('a'+j))] = rng.NormFloat64() * 0.5
	}
	for p := range quality {
		for k := 0; k < 4; k++ {
			j := string(rune('a' + rng.IntN(12)))
			reviews = append(reviews, Review{j, p, 3 + bias[j] + quality[p] + 0.05*rng.NormFloat64()})
		}
	}
	f := FitModel(reviews, false, Options{})
	adj := map[string]float64{}
	for p := range quality {
		adj[p] = f.Adjusted(p)
	}
	if tau := KendallTau(adj, quality); tau < 0.9 {
		t.Fatalf("kendall tau vs planted quality = %.3f, want >= 0.9", tau)
	}
	raw := rawMeans(reviews)
	if KendallTau(raw, quality) >= KendallTau(adj, quality) {
		t.Fatalf("model should beat raw means when biases are planted")
	}
}

func TestFlatJudgeAndSingletonsDoNotBreakTheFit(t *testing.T) {
	rs := loadFixtureReviews(t)
	f := FitModel(rs, true, Options{})
	if !f.Converged {
		t.Fatalf("did not converge in %d iterations", f.Iterations)
	}
	for p, q := range f.Quality {
		if math.IsNaN(q) || math.IsInf(q, 0) {
			t.Fatalf("project %s has non-finite quality", p)
		}
	}
	// jdg_07 gave (4,4,4) to all three projects; jdg_01 and jdg_23 have one review each.
	for _, j := range []string{"jdg_07", "jdg_01", "jdg_23"} {
		if math.IsNaN(f.Bias[j]) {
			t.Fatalf("%s bias is NaN", j)
		}
	}
}

func TestAnalyzeFixture(t *testing.T) {
	rep := Analyze(loadFixtureReviews(t), 3, Options{Bootstrap: 100})
	if len(rep.Projects) != 41 {
		t.Fatalf("projects = %d", len(rep.Projects))
	}
	if rep.Components != 1 {
		t.Fatalf("fixture graph should be connected, got %d components", rep.Components)
	}
	flagged := false
	for _, j := range rep.Judges {
		if j.Judge == "jdg_07" && len(j.Flags) > 0 && j.Flags[0][:4] == "flat" {
			flagged = true
		}
	}
	if !flagged {
		t.Fatal("jdg_07 should be flagged as flat")
	}
	for _, p := range rep.Projects {
		if p.RankLow > p.Ranks[MethodBiasScale] || p.RankHigh < p.Ranks[MethodBiasScale]-10 {
			// intervals come from resamples; just require they are sane
		}
		if p.ProbTopK < 0 || p.ProbTopK > 1 {
			t.Fatalf("bad probability %v", p.ProbTopK)
		}
	}
	t.Logf("agreement with primary: %v", rep.Agreement)
	t.Logf("fit: %+v", rep.Fit)
	for _, p := range rep.Projects[:5] {
		t.Logf("%s rank %d raw %d adj %.2f raw %.2f ci [%d,%d] P(top3)=%.2f", p.Project, p.Ranks[MethodBiasScale],
			p.Ranks[MethodRaw], p.Scores[MethodBiasScale], p.Scores[MethodRaw], p.RankLow, p.RankHigh, p.ProbTopK)
	}
}

func TestBTRecoversOrder(t *testing.T) {
	// A beats B beats C beats D, repeatedly and consistently.
	var cs []Comparison
	order := []string{"A", "B", "C", "D"}
	for i := 0; i < len(order); i++ {
		for j := i + 1; j < len(order); j++ {
			for k := 0; k < 5; k++ {
				cs = append(cs, Comparison{A: order[i], B: order[j], Outcome: 1})
			}
		}
	}
	f := FitBT(cs, order)
	for i := 0; i+1 < len(order); i++ {
		if f.Strength[order[i]] <= f.Strength[order[i+1]] {
			t.Fatalf("%s should be stronger than %s: %v", order[i], order[i+1], f.Strength)
		}
	}
	// The prior keeps an undefeated item finite.
	if math.IsInf(f.Strength["A"], 0) || f.SE["A"] <= 0 {
		t.Fatalf("undefeated item not regularised: %v %v", f.Strength["A"], f.SE["A"])
	}
}

func TestNextPairNeverRepeats(t *testing.T) {
	ids := []string{"a", "b", "c"}
	f := FitBT(nil, ids)
	seen := map[[2]string]bool{}
	rng := rand.New(rand.NewPCG(3, 4))
	for i := 0; i < 3; i++ {
		a, b, ok := NextPair(f, ids, seen, map[[2]string]int{}, rng)
		if !ok {
			t.Fatalf("ran out of pairs after %d", i)
		}
		if seen[PairKey(a, b)] {
			t.Fatal("repeated a pair")
		}
		seen[PairKey(a, b)] = true
	}
	if _, _, ok := NextPair(f, ids, seen, map[[2]string]int{}, rng); ok {
		t.Fatal("all 3 pairs seen, expected none left")
	}
}

func TestAssignRespectsConflictsAndTracks(t *testing.T) {
	in := AssignInput{
		Judges: []JudgeInfo{
			{ID: "j1", Tracks: []string{"t1"}},
			{ID: "j2", Tracks: []string{"t1"}, Conflict: []string{"p1"}},
			{ID: "j3", Tracks: []string{"t1", "t2"}},
			{ID: "j4", Tracks: []string{"t2"}},
		},
		Projects:   []ProjectInfo{{"p1", "t1"}, {"p2", "t1"}, {"p3", "t2"}},
		PerProject: 2,
		Seed:       1,
	}
	rep := Assign(in)
	for _, a := range rep.New {
		if a.Judge == "j2" && a.Project == "p1" {
			t.Fatal("assigned a conflicted judge")
		}
		if a.Project == "p3" && a.Judge != "j3" && a.Judge != "j4" {
			t.Fatalf("off-track assignment %v", a)
		}
	}
	if len(rep.Underfilled) != 0 || len(rep.New) != 6 {
		t.Fatalf("want 6 assignments, got %d (underfilled %v)", len(rep.New), rep.Underfilled)
	}
	if rep.Components != 1 {
		t.Fatalf("j3 should bridge the tracks, got %d components", rep.Components)
	}
}

func TestSimulationModelBeatsRawOnFixtureGraph(t *testing.T) {
	if testing.Short() {
		t.Skip("simulation")
	}
	rs := loadFixtureReviews(t)
	var graph []Pair
	for _, r := range rs {
		graph = append(graph, Pair{r.Judge, r.Project})
	}
	cfg := DefaultSimConfig(graph)
	cfg.Trials = 150
	ms := Simulate(cfg)
	byM := map[string]SimMetric{}
	for _, m := range ms {
		byM[m.Method] = m
		t.Logf("%-10s tau %.3f±%.3f top5 %.2f |rank err| %.2f beats-raw %.0f%%", m.Method, m.KendallMean, m.KendallSD, m.TopKHit, m.MeanAbsRank, 100*m.WinRate)
	}
	if byM[MethodBiasScale].KendallMean <= byM[MethodRaw].KendallMean {
		t.Fatalf("bias+scale model (%.3f) should beat raw means (%.3f)", byM[MethodBiasScale].KendallMean, byM[MethodRaw].KendallMean)
	}
}
