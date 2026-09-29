package judging

import (
	"math"
	"math/rand/v2"
	"sort"
)

// Elo defaults. EloK = 32 is the classic chess value; with a handful of
// comparisons per project a smaller K would barely move anyone off 1500.
const (
	EloBase      = 1500.0
	EloK         = 32.0
	EloScale     = 400.0 // rating points per factor-of-10 in odds
	EloOrderings = 200
)

// EloPerTheta converts a Bradley-Terry strength gap to Elo points: both use a
// logistic win curve, Elo in base 10 with scale 400.
var EloPerTheta = EloScale / math.Ln10

// EloFit is Elo averaged over random orderings of the same comparisons.
type EloFit struct {
	Rating map[string]float64 // mean rating over orderings
	SD     map[string]float64 // spread across orderings: how much the order alone moves a rating
}

// FitElo runs Elo over the comparisons in orderings random orders and
// averages. Plain Elo depends on the order the verdicts arrived in, which is
// an accident of who judged when; averaging removes that and the SD reports
// how large the effect was. Ties score 0.5. Deterministic for a given seed.
func FitElo(cs []Comparison, items []string, orderings int, seed uint64) *EloFit {
	f := &EloFit{Rating: map[string]float64{}, SD: map[string]float64{}}
	for _, it := range items {
		f.Rating[it] = EloBase
	}
	for _, c := range cs {
		f.Rating[c.A], f.Rating[c.B] = EloBase, EloBase
	}
	if len(cs) == 0 || orderings <= 0 {
		return f
	}
	// Canonical order first, so the result depends only on the multiset of
	// comparisons and the seed, not on how they were stored.
	cs = append([]Comparison(nil), cs...)
	sort.Slice(cs, func(i, j int) bool {
		a, b := cs[i], cs[j]
		if a.A != b.A {
			return a.A < b.A
		}
		if a.B != b.B {
			return a.B < b.B
		}
		if a.Judge != b.Judge {
			return a.Judge < b.Judge
		}
		return a.Outcome < b.Outcome
	})
	rng := rand.New(rand.NewPCG(seed, 0x9e3779b97f4a7c15))
	sum, sq := map[string]float64{}, map[string]float64{}
	r := map[string]float64{}
	order := make([]int, len(cs))
	for o := 0; o < orderings; o++ {
		for it := range f.Rating {
			r[it] = EloBase
		}
		for i := range order {
			order[i] = i
		}
		rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
		for _, i := range order {
			c := cs[i]
			exp := 1 / (1 + math.Pow(10, (r[c.B]-r[c.A])/EloScale))
			d := EloK * (c.Outcome - exp)
			r[c.A] += d
			r[c.B] -= d
		}
		for it, v := range r {
			sum[it] += v
			sq[it] += v * v
		}
	}
	n := float64(orderings)
	for it := range f.Rating {
		m := sum[it] / n
		f.Rating[it] = m
		f.SD[it] = math.Sqrt(math.Max(sq[it]/n-m*m, 0))
	}
	return f
}
