package judging

import (
	"math"
	"math/rand/v2"
	"sort"
)

// SimConfig describes a synthetic world. The review graph (who reviewed what)
// is taken from real data so the simulation has the fixture's sparsity,
// unfinished batches and uneven judge loads, not an idealised design.
type SimConfig struct {
	Graph     []Pair
	Criteria  int // criteria per review, each an integer on [ScaleMin, ScaleMax]
	ScaleMin  int
	ScaleMax  int
	Center    float64 // mean true score
	QualitySD float64 // spread of true project quality
	BiasSD    float64 // spread of judge leniency
	ScaleSD   float64 // log-normal spread of judge scale use
	FlatShare float64 // fraction of judges who give every project the same score
	NoiseSD   float64 // per-criterion noise
	Trials    int
	Seed      uint64
	TopK      int
}

func DefaultSimConfig(graph []Pair) SimConfig {
	return SimConfig{Graph: graph, Criteria: 3, ScaleMin: 1, ScaleMax: 5, Center: 3.5,
		QualitySD: 0.6, BiasSD: 0.45, ScaleSD: 0.35, FlatShare: 1.0 / 30, NoiseSD: 0.6,
		Trials: 400, Seed: 7, TopK: 5}
}

// SimMetric aggregates one method's accuracy over all trials.
type SimMetric struct {
	Method      string  `json:"method"`
	KendallMean float64 `json:"kendall_mean"`
	KendallSD   float64 `json:"kendall_sd"`
	TopKHit     float64 `json:"top_k_hit"`     // mean share of the true top k recovered
	MeanAbsRank float64 `json:"mean_abs_rank"` // mean |estimated rank - true rank|
	WinRate     float64 `json:"win_rate"`      // share of trials where this beat raw on Kendall tau
}

// Simulate draws Trials worlds, generates scores through the same graph, and
// measures how well each method recovers the true ranking.
func Simulate(cfg SimConfig) []SimMetric {
	rng := rand.New(rand.NewPCG(cfg.Seed, 0xda3e39cb94b95bdb))
	judges, projects := map[string]bool{}, map[string]bool{}
	for _, p := range cfg.Graph {
		judges[p.Judge], projects[p.Project] = true, true
	}
	jids, pids := sortedKeys(judges), sortedKeys(projects)
	methods := []string{MethodRaw, MethodZScore, MethodBias, MethodBiasScale, MethodPairwise}
	taus := map[string][]float64{}
	topHit, absRank, wins := map[string]float64{}, map[string]float64{}, map[string]float64{}
	opt := Options{Bootstrap: -1}

	for t := 0; t < cfg.Trials; t++ {
		truth := map[string]float64{}
		for _, p := range pids {
			truth[p] = cfg.QualitySD * rng.NormFloat64()
		}
		bias, scale, flat := map[string]float64{}, map[string]float64{}, map[string]float64{}
		for _, j := range jids {
			bias[j] = cfg.BiasSD * rng.NormFloat64()
			scale[j] = math.Exp(cfg.ScaleSD * rng.NormFloat64())
			if rng.Float64() < cfg.FlatShare {
				flat[j] = math.Round(cfg.Center + bias[j])
			}
		}
		var reviews []Review
		for _, pr := range cfg.Graph {
			sum := 0.0
			for c := 0; c < cfg.Criteria; c++ {
				var v float64
				if f, ok := flat[pr.Judge]; ok {
					v = f
				} else {
					v = math.Round(cfg.Center + bias[pr.Judge] + scale[pr.Judge]*truth[pr.Project] + cfg.NoiseSD*rng.NormFloat64())
				}
				sum += math.Max(float64(cfg.ScaleMin), math.Min(float64(cfg.ScaleMax), v))
			}
			reviews = append(reviews, Review{pr.Judge, pr.Project, sum / float64(cfg.Criteria)})
		}
		est := map[string]map[string]float64{
			MethodRaw:    rawMeans(reviews),
			MethodZScore: zScores(reviews),
		}
		b := FitModel(reviews, false, opt)
		f := FitModel(reviews, true, opt)
		est[MethodBias], est[MethodBiasScale] = map[string]float64{}, map[string]float64{}
		for _, p := range pids {
			est[MethodBias][p] = b.Adjusted(p)
			est[MethodBiasScale][p] = f.Adjusted(p)
		}
		est[MethodPairwise] = FitBT(InducedComparisons(reviews), pids).Strength

		trueRank := rankOf(truth)
		rawTau := KendallTau(est[MethodRaw], truth)
		for _, m := range methods {
			tau := KendallTau(est[m], truth)
			taus[m] = append(taus[m], tau)
			if tau > rawTau+1e-12 {
				wins[m]++
			}
			r := rankOf(est[m])
			hit, dev := 0, 0.0
			for _, p := range pids {
				if trueRank[p] <= cfg.TopK && r[p] <= cfg.TopK {
					hit++
				}
				dev += math.Abs(float64(r[p] - trueRank[p]))
			}
			topHit[m] += float64(hit) / float64(cfg.TopK)
			absRank[m] += dev / float64(len(pids))
		}
	}
	var out []SimMetric
	n := float64(cfg.Trials)
	for _, m := range methods {
		mean, sd := meanSD(taus[m])
		out = append(out, SimMetric{Method: m, KendallMean: mean, KendallSD: sd,
			TopKHit: topHit[m] / n, MeanAbsRank: absRank[m] / n, WinRate: wins[m] / n})
	}
	return out
}

// PairwiseSimResult compares adaptive and random pair selection at equal budget.
type PairwiseSimResult struct {
	Budget       int     `json:"budget"`
	AdaptiveTau  float64 `json:"adaptive_tau"`
	RandomTau    float64 `json:"random_tau"`
	AdaptiveTopK float64 `json:"adaptive_top_k"`
	RandomTopK   float64 `json:"random_top_k"`
}

// SimulatePairwise draws true strengths for n projects and lets a pool of
// judges answer comparisons under the Bradley-Terry model, choosing pairs
// either with NextPair or uniformly at random.
func SimulatePairwise(nProjects, nJudges int, budgets []int, trials int, seed uint64) []PairwiseSimResult {
	rng := rand.New(rand.NewPCG(seed, 0x2545f4914f6cdd1d))
	ids := make([]string, nProjects)
	for i := range ids {
		ids[i] = "p" + string(rune('A'+i/26)) + string(rune('a'+i%26))
	}
	var out []PairwiseSimResult
	for _, budget := range budgets {
		res := PairwiseSimResult{Budget: budget}
		for t := 0; t < trials; t++ {
			truth := map[string]float64{}
			for _, id := range ids {
				truth[id] = 1.2 * rng.NormFloat64()
			}
			answer := func(a, b string) float64 {
				if rng.Float64() < 1/(1+math.Exp(-(truth[a]-truth[b]))) {
					return 1
				}
				return 0
			}
			// adaptive
			var cs []Comparison
			seen := make([]map[[2]string]bool, nJudges)
			for i := range seen {
				seen[i] = map[[2]string]bool{}
			}
			pairCount := map[[2]string]int{}
			fit := FitBT(nil, ids)
			for k := 0; k < budget; k++ {
				j := k % nJudges
				a, b, ok := NextPair(fit, ids, seen[j], pairCount, rng)
				if !ok {
					continue
				}
				seen[j][PairKey(a, b)] = true
				pairCount[PairKey(a, b)]++
				cs = append(cs, Comparison{A: a, B: b, Outcome: answer(a, b)})
				if k%5 == 4 { // refit periodically, as the live system does per request
					fit = FitBT(cs, ids)
				}
			}
			fit = FitBT(cs, ids)
			res.AdaptiveTau += KendallTau(fit.Strength, truth)
			res.AdaptiveTopK += topKOverlap(fit.Strength, truth, 5)
			// random
			cs = cs[:0]
			for k := 0; k < budget; k++ {
				a := ids[rng.IntN(len(ids))]
				b := ids[rng.IntN(len(ids))]
				for b == a {
					b = ids[rng.IntN(len(ids))]
				}
				cs = append(cs, Comparison{A: a, B: b, Outcome: answer(a, b)})
			}
			rf := FitBT(cs, ids)
			res.RandomTau += KendallTau(rf.Strength, truth)
			res.RandomTopK += topKOverlap(rf.Strength, truth, 5)
		}
		n := float64(trials)
		res.AdaptiveTau /= n
		res.RandomTau /= n
		res.AdaptiveTopK /= n
		res.RandomTopK /= n
		out = append(out, res)
	}
	return out
}

func topKOverlap(est, truth map[string]float64, k int) float64 {
	re, rt := rankOf(est), rankOf(truth)
	hit := 0
	for id, r := range rt {
		if r <= k && re[id] <= k {
			hit++
		}
	}
	return float64(hit) / float64(k)
}

// SortMetrics orders metrics by descending Kendall tau (for display).
func SortMetrics(ms []SimMetric) {
	sort.SliceStable(ms, func(a, b int) bool { return ms[a].KendallMean > ms[b].KendallMean })
}
