package judging

import (
	"math"
	"testing"
)

func TestDavidsonRecoversTiePropensity(t *testing.T) {
	// 400 comparisons per budget over 20 projects gives nu enough data to pin down.
	rs := SimulatePairModels(20, 0.8, []int{400}, 40, 3)
	r := rs[0]
	if math.Abs(r.NuMean-0.8) > 0.15 {
		t.Fatalf("mean nu estimate %.3f, want about 0.8", r.NuMean)
	}
	if r.NuCover < 0.8 {
		t.Fatalf("90%% interval for nu covers the truth in %.0f%% of trials", 100*r.NuCover)
	}
	if r.DavidsonTau < r.BTTau-0.02 {
		t.Fatalf("Davidson tau %.3f is worse than half-win BT %.3f", r.DavidsonTau, r.BTTau)
	}
}

func TestDavidsonWithoutTiesMatchesBT(t *testing.T) {
	cs := []Comparison{
		{A: "a", B: "b", Outcome: 1}, {A: "a", B: "c", Outcome: 1}, {A: "b", B: "c", Outcome: 1},
		{A: "b", B: "a", Outcome: 0}, {A: "c", B: "d", Outcome: 1}, {A: "a", B: "d", Outcome: 1},
	}
	d := FitDavidson(cs, []string{"a", "b", "c", "d"})
	if !d.Converged {
		t.Fatal("did not converge")
	}
	if d.Ties != 0 || d.EvenTieProb() > 0.4 {
		t.Fatalf("no ties observed but P(tie | even) = %.2f", d.EvenTieProb())
	}
	bt := FitBT(cs, []string{"a", "b", "c", "d"})
	if KendallTau(d.Strength, bt.Strength) < 0.99 {
		t.Fatalf("orders differ: %v vs %v", d.Strength, bt.Strength)
	}
	for _, it := range []string{"a", "b", "c", "d"} {
		if d.SE[it] <= 0 || math.IsNaN(d.SE[it]) {
			t.Fatalf("SE[%s] = %v", it, d.SE[it])
		}
	}
}

func TestDavidsonProbabilitiesSumToOne(t *testing.T) {
	cs := []Comparison{{A: "a", B: "b", Outcome: 0.5}, {A: "a", B: "b", Outcome: 1}, {A: "b", B: "c", Outcome: 0.5}}
	d := FitDavidson(cs, nil)
	w, l, tie := d.Probs("a", "c")
	if math.Abs(w+l+tie-1) > 1e-12 || w <= l {
		t.Fatalf("P = %.3f / %.3f / %.3f", w, l, tie)
	}
}

func TestDavidsonEmptyAndAllTies(t *testing.T) {
	d := FitDavidson(nil, []string{"a", "b"})
	if d.Strength["a"] != 0 || math.IsNaN(d.Nu) {
		t.Fatalf("empty fit: %+v", d)
	}
	var cs []Comparison
	for range 10 {
		cs = append(cs, Comparison{A: "a", B: "b", Outcome: 0.5})
	}
	d = FitDavidson(cs, nil)
	if math.IsInf(d.Nu, 0) || math.IsNaN(d.Nu) || d.EvenTieProb() < 0.7 {
		t.Fatalf("all ties: nu = %v", d.Nu)
	}
}

func TestEloIsOrderIndependentAndAgreesWithBT(t *testing.T) {
	cs := []Comparison{
		{A: "a", B: "b", Outcome: 1}, {A: "b", B: "c", Outcome: 1}, {A: "a", B: "c", Outcome: 1},
		{A: "c", B: "d", Outcome: 0.5}, {A: "b", B: "d", Outcome: 1}, {A: "a", B: "d", Outcome: 1},
	}
	rev := make([]Comparison, len(cs))
	for i := range cs {
		rev[len(cs)-1-i] = cs[i]
	}
	e1 := FitElo(cs, nil, EloOrderings, 7)
	e2 := FitElo(rev, nil, EloOrderings, 7)
	for it, v := range e1.Rating {
		if math.Abs(v-e2.Rating[it]) > 1e-9 {
			t.Fatalf("rating of %s depends on input order: %.2f vs %.2f", it, v, e2.Rating[it])
		}
	}
	sum := 0.0
	for _, v := range e1.Rating {
		sum += v
	}
	if math.Abs(sum/4-EloBase) > 1e-9 {
		t.Fatalf("Elo is zero-sum, mean rating %.3f", sum/4)
	}
	if KendallTau(e1.Rating, FitBT(cs, nil).Strength) < 0.99 {
		t.Fatalf("Elo order %v disagrees with BT", e1.Rating)
	}
}
