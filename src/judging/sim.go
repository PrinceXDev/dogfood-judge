package judging

import (
	"fmt"
	"math"
	"math/rand/v2"
	"sort"
	"strings"
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
			reviews = append(reviews, Review{Judge: pr.Judge, Project: pr.Project, Score: sum / float64(cfg.Criteria)})
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
	AdaptiveTau  float64 `json:"adaptive_tau"` // PairUncertainty, the live default
	InfoTau      float64 `json:"info_tau"`     // PairInformation
	RandomTau    float64 `json:"random_tau"`
	AdaptiveTopK float64 `json:"adaptive_top_k"`
	InfoTopK     float64 `json:"info_top_k"`
	RandomTopK   float64 `json:"random_top_k"`
}

// SimulatePairwise draws true strengths for n projects and lets a pool of
// judges answer comparisons under the Bradley-Terry model, choosing pairs
// with each PairStrategy (as the live system does, including the rule that
// keeps a judge's previous projects out of their next pair) or uniformly at
// random. Every arm sees the same true strengths in each trial.
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
			adaptive := func(st PairStrategy) *BTFit {
				var cs []Comparison
				seen := make([]map[[2]string]bool, nJudges)
				last := make([]map[string]bool, nJudges)
				for i := range seen {
					seen[i] = map[[2]string]bool{}
				}
				pairCount := map[[2]string]int{}
				fit := FitBT(nil, ids)
				for k := 0; k < budget; k++ {
					j := k % nJudges
					a, b, ok := SelectPair(fit, ids, seen[j], pairCount, rng, PairPolicy{Strategy: st, Avoid: last[j]})
					if !ok {
						continue
					}
					seen[j][PairKey(a, b)] = true
					last[j] = map[string]bool{a: true, b: true}
					pairCount[PairKey(a, b)]++
					cs = append(cs, Comparison{A: a, B: b, Outcome: answer(a, b)})
					if k%5 == 4 { // refit periodically, as the live system does per request
						fit = FitBT(cs, ids)
					}
				}
				return FitBT(cs, ids)
			}
			fit := adaptive(PairUncertainty)
			res.AdaptiveTau += KendallTau(fit.Strength, truth)
			res.AdaptiveTopK += topKOverlap(fit.Strength, truth, 5)
			fit = adaptive(PairInformation)
			res.InfoTau += KendallTau(fit.Strength, truth)
			res.InfoTopK += topKOverlap(fit.Strength, truth, 5)
			// random
			var cs []Comparison
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
		res.InfoTau /= n
		res.RandomTau /= n
		res.AdaptiveTopK /= n
		res.InfoTopK /= n
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

// DriftSimResult measures the fatigue check: how often it flags a judge whose
// scoring never changed, and how often it catches one that did.
type DriftSimResult struct {
	Judges        int     `json:"judges"`          // honest judges checked
	FalseFlagRate float64 `json:"false_flag_rate"` // share of honest judges flagged
	FlattenCaught float64 `json:"flatten_caught"`  // share of flattening judges flagged
	ErraticCaught float64 `json:"erratic_caught"`  // share of erratic judges flagged
}

// SimulateDrift builds worlds where each judge writes perReview reviews in a
// random order, fits the full model, and runs the drift check. In every world
// one judge gives a constant score for their second half (flattening) and one
// triples their noise for it (erratic); everyone else is unchanged.
func SimulateDrift(perJudge, trials int, seed uint64) DriftSimResult {
	rng := rand.New(rand.NewPCG(seed, 0x853c49e6748fea9b))
	const nProjects, nJudges, center = 40, 12, 3.5
	var res DriftSimResult
	var flagged, flat, erratic float64
	for t := 0; t < trials; t++ {
		truth := make([]float64, nProjects)
		for p := range truth {
			truth[p] = 0.6 * rng.NormFloat64()
		}
		var reviews []Review
		for j := 0; j < nJudges; j++ {
			bias, scale := 0.45*rng.NormFloat64(), math.Exp(0.35*rng.NormFloat64())
			for k, p := range rng.Perm(nProjects)[:perJudge] {
				late := k >= perJudge/2
				noise := 0.35
				if j == 1 && late {
					noise *= 3
				}
				v := center + bias + scale*truth[p] + noise*rng.NormFloat64()
				if j == 0 && late {
					v = math.Round(center + bias)
				}
				v = math.Max(1, math.Min(5, v))
				reviews = append(reviews, Review{Judge: fmt.Sprintf("j%02d", j), Project: fmt.Sprintf("p%02d", p), Score: v, Seq: k + 1})
			}
		}
		f := FitModel(reviews, true, Options{Bootstrap: -1})
		js := judgeDiagnostics(reviews, f)
		drift(js, reviews, f, seed+uint64(t))
		for _, jr := range js {
			hit := false
			for _, fl := range jr.Flags {
				if strings.HasPrefix(fl, "scores flattening") || strings.HasPrefix(fl, "scores becoming erratic") {
					hit = true
				}
			}
			switch jr.Judge {
			case "j00":
				if hit {
					flat++
				}
			case "j01":
				if hit {
					erratic++
				}
			default:
				res.Judges++
				if hit {
					flagged++
				}
			}
		}
	}
	res.FalseFlagRate = flagged / float64(res.Judges)
	res.FlattenCaught = flat / float64(trials)
	res.ErraticCaught = erratic / float64(trials)
	return res
}

// PairModelSimResult compares the three pairwise estimators on the same
// comparisons, drawn from a Davidson model with a known tie propensity.
type PairModelSimResult struct {
	Budget      int     `json:"budget"`
	TrueNu      float64 `json:"true_nu"`
	TieShare    float64 `json:"tie_share"`    // observed share of ties
	BTTau       float64 `json:"bt_tau"`       // ties as half a win (the live ranking)
	DavidsonTau float64 `json:"davidson_tau"` // ties modelled
	EloTau      float64 `json:"elo_tau"`      // Elo averaged over orderings
	NuMean      float64 `json:"nu_mean"`      // Davidson's estimate of nu
	NuCover     float64 `json:"nu_cover"`     // share of trials whose nu ± 1.645 SE covers the truth
}

// SimulatePairModels draws Davidson ground truth for n projects, answers
// budget random pairs, and scores each estimator against the true order.
func SimulatePairModels(nProjects int, nu float64, budgets []int, trials int, seed uint64) []PairModelSimResult {
	rng := rand.New(rand.NewPCG(seed, 0xda3e39cb94b95bdb))
	ids := make([]string, nProjects)
	for i := range ids {
		ids[i] = fmt.Sprintf("p%02d", i)
	}
	var out []PairModelSimResult
	for _, budget := range budgets {
		res := PairModelSimResult{Budget: budget, TrueNu: nu}
		ties := 0
		for t := 0; t < trials; t++ {
			truth := map[string]float64{}
			for _, id := range ids {
				truth[id] = 1.2 * rng.NormFloat64()
			}
			cs := make([]Comparison, 0, budget)
			for k := 0; k < budget; k++ {
				a := ids[rng.IntN(nProjects)]
				b := ids[rng.IntN(nProjects)]
				for b == a {
					b = ids[rng.IntN(nProjects)]
				}
				pa, pb := math.Exp(truth[a]), math.Exp(truth[b])
				tie := nu * math.Sqrt(pa*pb)
				u := rng.Float64() * (pa + pb + tie)
				o := 0.0
				switch {
				case u < pa:
					o = 1
				case u < pa+tie:
					o = 0.5
					ties++
				}
				cs = append(cs, Comparison{A: a, B: b, Outcome: o})
			}
			res.BTTau += KendallTau(FitBT(cs, ids).Strength, truth)
			d := FitDavidson(cs, ids)
			res.DavidsonTau += KendallTau(d.Strength, truth)
			res.NuMean += d.Nu
			if lo, hi := d.NuInterval(1.645); lo <= nu && nu <= hi {
				res.NuCover++
			}
			res.EloTau += KendallTau(FitElo(cs, ids, 50, seed+uint64(t)).Rating, truth)
		}
		n := float64(trials)
		res.TieShare = float64(ties) / (n * float64(budget))
		res.BTTau /= n
		res.DavidsonTau /= n
		res.EloTau /= n
		res.NuMean /= n
		res.NuCover /= n
		out = append(out, res)
	}
	return out
}
