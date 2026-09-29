package judging

import (
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"sort"
)

// Judge fatigue signals. The schema records when a review was written, not
// when the judge opened the project, so time-per-review can't be measured.
// What can be measured is whether a judge's scoring changes between the first
// and second half of their reviews, in the order they wrote them.
//
// Both checks are permutation tests: if nothing changed over time, every
// ordering of the judge's reviews is equally likely, so the observed statistic
// is compared with the same statistic over random reorderings. Each tail is
// tested at DriftAlpha, which keeps the false-flag rate near 2*DriftAlpha per
// judge by construction; SimulateDrift measures it through the whole pipeline.

const (
	DriftMinReviews = 8     // below this, halves of 4 carry too little to compare
	DriftAlpha      = 0.025 // one-sided level for each of the two checks
	driftPerms      = 2000
	driftCap        = 99 // JSON can't encode +Inf; a first half with no spread reads as 99x
)

type JudgeDrift struct {
	Reviews int `json:"reviews"`
	// SpreadRatio is SD(scores, second half) / SD(scores, first half); well
	// below 1 means the judge stopped using the scale.
	SpreadRatio float64 `json:"spread_ratio"`
	SpreadP     float64 `json:"spread_p"` // P(ratio this low | no change)
	// NoiseRatio is the same ratio for residuals from the fitted model; well
	// above 1 means scores stopped tracking what other judges saw.
	NoiseRatio float64 `json:"noise_ratio"`
	NoiseP     float64 `json:"noise_p"` // P(ratio this high | no change)
}

func drift(judges []*JudgeResult, reviews []Review, f *Fit, seed uint64) {
	byJudge := map[string][]Review{}
	for _, r := range reviews {
		if r.Seq > 0 {
			byJudge[r.Judge] = append(byJudge[r.Judge], r)
		}
	}
	for _, jr := range judges {
		rs := byJudge[jr.Judge]
		if len(rs) < DriftMinReviews || len(rs) != jr.Reviews {
			continue
		}
		sort.Slice(rs, func(a, b int) bool { return rs[a].Seq < rs[b].Seq })
		scores := make([]float64, len(rs))
		resid := make([]float64, len(rs))
		for i, r := range rs {
			scores[i] = r.Score
			resid[i] = r.Score - (f.Mu + f.Bias[r.Judge] + f.Scale[r.Judge]*f.Quality[r.Project])
		}
		if _, sd := meanSD(scores); sd < 1e-9 {
			continue // flat judges are already flagged; there is no spread to compare
		}
		h := fnv.New64a()
		h.Write([]byte(jr.Judge))
		rng := rand.New(rand.NewPCG(seed, h.Sum64()))
		d := &JudgeDrift{Reviews: len(rs)}
		d.SpreadRatio, d.SpreadP = halvesTest(scores, rng, false)
		d.NoiseRatio, d.NoiseP = halvesTest(resid, rng, true)
		jr.Drift = d
		if d.SpreadP < DriftAlpha {
			jr.Flags = append(jr.Flags, fmt.Sprintf("scores flattening: second-half spread is %.0f%% of the first (p=%.3f)", 100*d.SpreadRatio, d.SpreadP))
		}
		if d.NoiseP < DriftAlpha {
			jr.Flags = append(jr.Flags, fmt.Sprintf("scores becoming erratic: second-half disagreement is %.1fx the first (p=%.3f)", d.NoiseRatio, d.NoiseP))
		}
	}
}

// halvesTest returns SD(second half)/SD(first half) and its permutation
// p-value in the requested tail (upper=true: ratios at least this high).
func halvesTest(v []float64, rng *rand.Rand, upper bool) (float64, float64) {
	obs := halvesRatio(v)
	perm := append([]float64(nil), v...)
	hits := 0
	for range driftPerms {
		rng.Shuffle(len(perm), func(i, j int) { perm[i], perm[j] = perm[j], perm[i] })
		r := halvesRatio(perm)
		if (upper && r >= obs-1e-12) || (!upper && r <= obs+1e-12) {
			hits++
		}
	}
	// +1 counts the observed ordering itself, so p is never exactly zero.
	return obs, float64(hits+1) / float64(driftPerms+1)
}

func halvesRatio(v []float64) float64 {
	h := len(v) / 2
	_, a := meanSD(v[:h])
	_, b := meanSD(v[h:])
	switch {
	case a < 1e-9 && b < 1e-9:
		return 1
	case a < 1e-9:
		return driftCap
	}
	return math.Min(b/a, driftCap)
}
