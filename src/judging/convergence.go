package judging

import (
	"fmt"
	"math"
	"math/rand/v2"
	"sort"
)

// Convergence answers the organizer's question "do we have enough reviews?"
// with a learning curve. For each fraction f, every project keeps a random f
// of its reviews (at least one), the model is refitted, and the top of the
// ranking is compared with the full-data ranking. If throwing away a fifth of
// the reviews barely moves the top, adding a fifth more is unlikely to move it
// either: extra reviews shrink the error by less than removing them grows it.
//
// It needs no timestamps, so it also works on imported scores, where every
// review has the same write time and "how the ranking evolved" is unknowable.
// When the write order is known, ArrivalCurve adds the real trajectory.

const (
	ConvergenceTopN       = 10  // the part of the ranking that matters for prizes
	ConvergenceSubsamples = 40  // refits per fraction
	SettledFraction       = 0.8 // the curve point the verdict reads
	SettledTau            = 0.9 // top-N order agreement needed at that point
	SettledTopK           = 0.8 // share of subsamples that keep the same top-k set
)

// ConvergenceFractions are the curve's x positions, as shares of each
// project's reviews. 1.0 is the full data and anchors the curve at tau = 1.
var ConvergenceFractions = []float64{0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1}

type ConvergencePoint struct {
	Fraction   float64 `json:"fraction"`
	Reviews    float64 `json:"reviews"`     // mean reviews kept across subsamples
	PerProject float64 `json:"per_project"` // mean reviews per project kept
	TauMean    float64 `json:"tau_mean"`    // Kendall tau of the full top N, subsample fit vs full fit
	TauLow     float64 `json:"tau_low"`     // 10th percentile across subsamples
	TauHigh    float64 `json:"tau_high"`    // 90th percentile
	TopKSame   float64 `json:"top_k_same"`  // share of subsamples with the same top-k set
	WinnerSame float64 `json:"winner_same"` // share of subsamples with the same winner
}

type ArrivalPoint struct {
	Reviews  int     `json:"reviews"`    // reviews written so far, in write order
	Tau      float64 `json:"tau"`        // the final top N, ordered by the fit at this point vs the final fit
	TopKSame bool    `json:"top_k_same"` // the top-k set at this point equals the final one
}

type Convergence struct {
	TopN       int                `json:"top_n"`
	TopK       int                `json:"top_k"`
	Subsamples int                `json:"subsamples"`
	Curve      []ConvergencePoint `json:"curve"`
	// Arrival is the real trajectory in write order; set by the caller only
	// when write times are distinct enough to order the reviews.
	Arrival []ArrivalPoint `json:"arrival,omitempty"`
	Settled bool           `json:"settled"`
	Verdict string         `json:"verdict"`
}

func convergence(rep *Report, reviews []Review, full *Fit, opt Options) {
	if len(rep.Projects) < 3 || opt.Bootstrap == 0 {
		return
	}
	n := min(ConvergenceTopN, len(rep.Projects))
	k := min(opt.TopK, len(rep.Projects)-1)
	var top []string
	for _, p := range rep.Projects[:n] {
		top = append(top, p.Project)
	}
	fullAdj := map[string]float64{}
	for _, p := range top {
		fullAdj[p] = full.Adjusted(p)
	}
	byProject := map[string][]Review{}
	for _, r := range reviews {
		byProject[r.Project] = append(byProject[r.Project], r)
	}
	projects := sortedKeys(byProject)
	quick := opt
	quick.Bootstrap = -1
	quick.init, quick.maxSweeps, quick.tol = full, 300, 1e-6
	rng := rand.New(rand.NewPCG(opt.Seed, 0xc0ffee))

	c := &Convergence{TopN: n, TopK: k, Subsamples: ConvergenceSubsamples}
	for _, frac := range ConvergenceFractions {
		pt := ConvergencePoint{Fraction: frac}
		reps := ConvergenceSubsamples
		if frac >= 1 {
			reps = 1 // the full data is one deterministic "subsample"
		}
		taus := make([]float64, 0, reps)
		var kept, same, win int
		for range reps {
			sample := make([]Review, 0, len(reviews))
			for _, p := range projects {
				rs := byProject[p]
				m := keepCount(len(rs), frac, rng)
				for _, i := range rng.Perm(len(rs))[:m] {
					sample = append(sample, rs[i])
				}
			}
			kept += len(sample)
			f := full
			if frac < 1 {
				f = FitModel(sample, true, quick)
			}
			adj := map[string]float64{}
			for _, p := range projects {
				adj[p] = f.Adjusted(p)
			}
			sub := map[string]float64{}
			for _, p := range top {
				sub[p] = adj[p]
			}
			taus = append(taus, KendallTau(sub, fullAdj))
			ranks := rankOf(adj)
			if sameSet(ranks, top[:k], k) {
				same++
			}
			if ranks[top[0]] == 1 {
				win++
			}
		}
		sort.Float64s(taus)
		pt.TauMean, _ = meanSD(taus)
		pt.TauLow, pt.TauHigh = taus[int(0.1*float64(len(taus)))], taus[int(0.9*float64(len(taus)-1)+0.5)]
		pt.Reviews = float64(kept) / float64(reps)
		pt.PerProject = pt.Reviews / float64(len(projects))
		pt.TopKSame = float64(same) / float64(reps)
		pt.WinnerSame = float64(win) / float64(reps)
		c.Curve = append(c.Curve, pt)
	}
	c.Settled, c.Verdict = settle(c)
	rep.Convergence = c
}

// keepCount keeps a fraction frac of m reviews, rounding at random so the
// expected count is exactly frac*m, and never fewer than one.
func keepCount(m int, frac float64, rng *rand.Rand) int {
	x := frac * float64(m)
	keep := int(x)
	if rng.Float64() < x-float64(keep) {
		keep++
	}
	return max(1, min(m, keep))
}

// sameSet reports whether the projects ranked 1..k are exactly want.
func sameSet(ranks map[string]int, want []string, k int) bool {
	for _, p := range want {
		if ranks[p] > k {
			return false
		}
	}
	return true
}

func settle(c *Convergence) (bool, string) {
	var at *ConvergencePoint
	for i := range c.Curve {
		if math.Abs(c.Curve[i].Fraction-SettledFraction) < 1e-9 {
			at = &c.Curve[i]
		}
	}
	if at == nil {
		return false, ""
	}
	drop := int(math.Round(100 * (1 - SettledFraction)))
	if at.TauMean >= SettledTau && at.TopKSame >= SettledTopK {
		return true, fmt.Sprintf("Settled: with %d%% of the reviews removed, the top %d keeps its order (tau %.2f) and the top %d is unchanged in %.0f%% of refits. More reviews are unlikely to change the prizes.",
			drop, c.TopN, at.TauMean, c.TopK, 100*at.TopKSame)
	}
	return false, fmt.Sprintf("Still moving: with %d%% of the reviews removed, the top %d changes in %.0f%% of refits (top-%d order tau %.2f). More reviews on the leading projects would firm it up.",
		drop, c.TopK, 100*(1-at.TopKSame), c.TopN, at.TauMean)
}

// ArrivalCurve refits the model on the first reviews in write order at about
// a dozen checkpoints and compares each fit's order of the final top N with
// the final order. ordered must be sorted by write time.
func ArrivalCurve(ordered []Review, c *Convergence, opt Options) []ArrivalPoint {
	opt = opt.withDefaults()
	if c == nil || len(ordered) < 4 {
		return nil
	}
	full := FitModel(ordered, true, opt)
	adj := map[string]float64{}
	for p := range full.Quality {
		adj[p] = full.Adjusted(p)
	}
	ranks := rankOf(adj)
	top := map[string]float64{}
	var topK []string
	for p, r := range ranks {
		if r <= c.TopN {
			top[p] = adj[p]
		}
		if r <= c.TopK {
			topK = append(topK, p)
		}
	}
	quick := opt
	quick.init, quick.maxSweeps, quick.tol = full, 300, 1e-6
	step := max(1, len(ordered)/12)
	var out []ArrivalPoint
	for end := step; ; end += step {
		end = min(end, len(ordered))
		f := FitModel(ordered[:end], true, quick)
		now, sub := map[string]float64{}, map[string]float64{}
		for p := range f.Quality {
			now[p] = f.Adjusted(p)
			if _, ok := top[p]; ok {
				sub[p] = now[p]
			}
		}
		if len(sub) >= 2 {
			finalSub := map[string]float64{}
			for p := range sub {
				finalSub[p] = top[p]
			}
			out = append(out, ArrivalPoint{Reviews: end, Tau: KendallTau(sub, finalSub),
				TopKSame: sameSet(rankOf(now), topK, c.TopK)})
		}
		if end == len(ordered) {
			return out
		}
	}
}
