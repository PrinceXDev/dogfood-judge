package judging

import (
	"fmt"
	"math/rand/v2"
	"testing"
)

func synthEvent(seed uint64, projects, judges, perProject int, noise float64) []Review {
	rs, _ := synthEventTruth(seed, projects, judges, perProject, noise)
	return rs
}

// synthEventTruth plants quality and leniency and has each project reviewed
// by perProject random judges with the given noise; it returns the reviews
// and the planted quality.
func synthEventTruth(seed uint64, projects, judges, perProject int, noise float64) ([]Review, map[string]float64) {
	rng := rand.New(rand.NewPCG(seed, 7))
	bias := make([]float64, judges)
	for j := range bias {
		bias[j] = 0.4 * rng.NormFloat64()
	}
	var out []Review
	truth := map[string]float64{}
	for p := range projects {
		q := 0.8 * rng.NormFloat64()
		truth[fmt.Sprintf("p%02d", p)] = q
		for _, j := range rng.Perm(judges)[:perProject] {
			out = append(out, Review{Judge: fmt.Sprintf("j%02d", j), Project: fmt.Sprintf("p%02d", p),
				Score: 3 + bias[j] + q + noise*rng.NormFloat64()})
		}
	}
	return out, truth
}

func TestConvergenceCurveShape(t *testing.T) {
	rep := Analyze(loadFixtureReviews(t), 3, Options{Bootstrap: 50})
	c := rep.Convergence
	if c == nil {
		t.Fatal("no convergence curve on the fixture")
	}
	if len(c.Curve) != len(ConvergenceFractions) {
		t.Fatalf("curve has %d points, want %d", len(c.Curve), len(ConvergenceFractions))
	}
	last := c.Curve[len(c.Curve)-1]
	if last.TauMean != 1 || last.TopKSame != 1 || last.WinnerSame != 1 || int(last.Reviews) != rep.Reviews {
		t.Fatalf("the full-data point must agree with itself: %+v", last)
	}
	for i, p := range c.Curve {
		if p.TauLow > p.TauMean+1e-9 || p.TauMean > p.TauHigh+1e-9 {
			t.Fatalf("point %d: band %.3f..%.3f does not contain mean %.3f", i, p.TauLow, p.TauHigh, p.TauMean)
		}
		if i > 0 && p.Reviews < c.Curve[i-1].Reviews {
			t.Fatalf("reviews kept must grow with the fraction")
		}
	}
	if c.Verdict == "" {
		t.Fatal("no verdict")
	}
	t.Logf("fixture: %s", c.Verdict)
}

// The verdict is only worth showing if it is calibrated: across events of
// mixed difficulty, a "settled" top k must match the planted top k far more
// often than an "still moving" one, and be right most of the time.
func TestConvergenceVerdictIsCalibrated(t *testing.T) {
	var settled, settledRight, moving, movingRight int
	seed := uint64(1)
	for _, per := range []int{2, 4, 8} {
		for _, noise := range []float64{0.3, 1.0} {
			for range 8 {
				rs, truth := synthEventTruth(seed, 20, 12, per, noise)
				seed++
				rep := Analyze(rs, per, Options{Bootstrap: 10, Seed: seed})
				right := sameSet(rankOf(truth), rep.Robustness.TopK, rep.TopK)
				if rep.Convergence.Settled {
					settled++
					if right {
						settledRight++
					}
				} else {
					moving++
					if right {
						movingRight++
					}
				}
			}
		}
	}
	pS := float64(settledRight) / float64(max(settled, 1))
	pM := float64(movingRight) / float64(max(moving, 1))
	t.Logf("settled %d events, top k right in %.0f%%; still moving %d, right in %.0f%%", settled, 100*pS, moving, 100*pM)
	if settled < 5 || moving < 5 {
		t.Fatalf("verdict barely varies: %d settled, %d moving", settled, moving)
	}
	if pS < 0.75 || pS < pM+0.3 {
		t.Fatalf("settled top k right %.0f%% vs %.0f%% when moving: not calibrated", 100*pS, 100*pM)
	}
}

func TestArrivalCurveEndsAtTheFinalRanking(t *testing.T) {
	rs := synthEvent(3, 15, 10, 4, 0.5)
	rng := rand.New(rand.NewPCG(4, 4))
	rng.Shuffle(len(rs), func(i, j int) { rs[i], rs[j] = rs[j], rs[i] })
	rep := Analyze(rs, 4, Options{Bootstrap: 20})
	pts := ArrivalCurve(rs, rep.Convergence, Options{})
	if len(pts) < 5 {
		t.Fatalf("got %d arrival points", len(pts))
	}
	end := pts[len(pts)-1]
	if end.Reviews != len(rs) || end.Tau < 0.999 || !end.TopKSame {
		t.Fatalf("the last point is the full data and must match it: %+v", end)
	}
}

func TestCriterionLeniencyFindsPlantedOffset(t *testing.T) {
	rng := rand.New(rand.NewPCG(8, 8))
	crit := []string{"functionality", "innovation", "quality"}
	var scores []CriterionScore
	for p := range 40 {
		q := rng.NormFloat64()
		for _, j := range rng.Perm(10)[:4] {
			for _, c := range crit {
				v := 3 + q + 0.5*rng.NormFloat64()
				if j == 0 && c == "innovation" {
					v -= 1.2 // j00 is harsh on innovation only
				}
				scores = append(scores, CriterionScore{Judge: fmt.Sprintf("j%02d", j), Project: fmt.Sprintf("p%02d", p), Criterion: c, Value: v})
			}
		}
	}
	rep := CriterionLeniency(scores, crit)
	if len(rep.Cells) != 30 || len(rep.Criteria) != 3 {
		t.Fatalf("got %d cells over %d criteria, want 30 over 3", len(rep.Cells), len(rep.Criteria))
	}
	falseFlags := 0
	for _, c := range rep.Cells {
		if c.Low > c.Shrunk || c.Shrunk > c.High || c.Lambda < 0 || c.Lambda > 1 {
			t.Fatalf("malformed cell %+v", c)
		}
		if c.Judge == "j00" && c.Criterion == "innovation" {
			if c.Signal != "harsh" {
				t.Fatalf("planted harshness not found: %+v", c)
			}
			continue
		}
		if c.Signal == "lenient" || c.Signal == "harsh" {
			falseFlags++
		}
	}
	if falseFlags > 3 {
		t.Fatalf("%d of 29 unbiased cells flagged, want at most 3", falseFlags)
	}
}

// With no real differences between judges, tau is estimated near zero and
// shrinkage pulls every offset toward zero, so almost nothing is flagged.
func TestCriterionLeniencyShrinksNoise(t *testing.T) {
	rng := rand.New(rand.NewPCG(9, 9))
	var scores []CriterionScore
	for p := range 30 {
		q := rng.NormFloat64()
		for _, j := range rng.Perm(8)[:3] {
			scores = append(scores, CriterionScore{Judge: fmt.Sprintf("j%d", j), Project: fmt.Sprintf("p%d", p), Criterion: "c", Value: 3 + q + 0.6*rng.NormFloat64()})
		}
	}
	rep := CriterionLeniency(scores, []string{"c"})
	flagged := rep.Criteria[0].Flagged
	if flagged > 1 {
		t.Fatalf("%d of 8 noise-only judges flagged", flagged)
	}
	for _, c := range rep.Cells {
		if abs := c.Shrunk; abs > 0.3 || abs < -0.3 {
			t.Fatalf("noise-only offset not shrunk: %+v", c)
		}
	}
}
