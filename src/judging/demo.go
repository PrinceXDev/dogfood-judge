package judging

import (
	"fmt"
	"math"
	"math/rand/v2"
)

// DemoConfig describes one small synthetic hackathon for the public, educational
// simulation on the landing page. Unlike Simulate it produces a single world and
// runs the full Analyze pipeline on it, so the page can show exactly what the
// engine reports next to the ground truth that generated the scores.
type DemoConfig struct {
	Projects int     `json:"projects"`
	Judges   int     `json:"judges"`
	Coverage int     `json:"coverage"` // reviews per project
	Leniency float64 `json:"leniency"` // SD of judge leniency, scale points
	Scale    float64 `json:"scale"`    // log-normal SD of judge scale use
	Noise    float64 `json:"noise"`    // per-criterion noise SD
	Seed     uint64  `json:"seed"`
}

// Clamp bounds every field so an anonymous request cannot ask for an expensive fit.
func (c DemoConfig) Clamp() DemoConfig {
	ci := func(v, lo, hi int) int { return max(lo, min(hi, v)) }
	cf := func(v, lo, hi float64) float64 {
		if math.IsNaN(v) {
			return lo
		}
		return math.Max(lo, math.Min(hi, v))
	}
	c.Projects = ci(c.Projects, 6, 40)
	c.Judges = ci(c.Judges, 3, 16)
	c.Coverage = ci(c.Coverage, 2, min(6, c.Judges))
	c.Leniency = cf(c.Leniency, 0, 1.5)
	c.Scale = cf(c.Scale, 0, 1)
	c.Noise = cf(c.Noise, 0.05, 1.5)
	return c
}

type DemoProject struct {
	ID       string  `json:"id"`
	Truth    float64 `json:"truth"`
	TrueRank int     `json:"true_rank"`
}

type DemoJudge struct {
	ID        string  `json:"id"`
	TrueBias  float64 `json:"true_bias"`
	TrueScale float64 `json:"true_scale"`
}

type DemoReview struct {
	Judge   string  `json:"judge"`
	Project string  `json:"project"`
	Score   float64 `json:"score"`
}

// DemoAccuracy compares each ranking with the ground truth, which only a
// simulation knows.
type DemoAccuracy struct {
	RawTau       float64 `json:"raw_tau"`
	AdjustedTau  float64 `json:"adjusted_tau"`
	RawTopK      int     `json:"raw_top_k"`       // true top-k projects the raw mean put in its top k
	AdjustedTopK int     `json:"adjusted_top_k"`  // same for the primary method
	RawWinner    bool    `json:"raw_winner"`      // raw mean picked the true winner
	AdjWinner    bool    `json:"adjusted_winner"` // primary method picked the true winner
}

type DemoResult struct {
	Config   DemoConfig    `json:"config"`
	Truth    []DemoProject `json:"truth"`
	Judges   []DemoJudge   `json:"judges"`
	Reviews  []DemoReview  `json:"reviews"`
	Report   *Report       `json:"report"`
	Accuracy DemoAccuracy  `json:"accuracy"`
}

// Demo draws one world from cfg, generates three-criterion 1..5 reviews through a
// balanced, connected assignment, and analyzes them exactly as a real event is.
func Demo(cfg DemoConfig, bootstrap int) *DemoResult {
	cfg = cfg.Clamp()
	rng := rand.New(rand.NewPCG(cfg.Seed, 0x5eed_d06f00d))
	const center, criteria = 3.3, 3

	res := &DemoResult{Config: cfg}
	truth := map[string]float64{}
	pids := make([]string, cfg.Projects)
	for i := range pids {
		pids[i] = fmt.Sprintf("p%02d", i+1)
		truth[pids[i]] = 0.6 * rng.NormFloat64()
	}
	jids := make([]string, cfg.Judges)
	bias, scale := map[string]float64{}, map[string]float64{}
	for i := range jids {
		jids[i] = fmt.Sprintf("j%02d", i+1)
		bias[jids[i]] = cfg.Leniency * rng.NormFloat64()
		scale[jids[i]] = math.Exp(cfg.Scale * rng.NormFloat64())
		res.Judges = append(res.Judges, DemoJudge{jids[i], bias[jids[i]], scale[jids[i]]})
	}
	trueRank := rankOf(truth)
	for _, p := range pids {
		res.Truth = append(res.Truth, DemoProject{p, truth[p], trueRank[p]})
	}

	// Walk a shuffled judge order round-robin: consecutive projects share
	// judges, which keeps the review graph connected and loads balanced.
	order := rng.Perm(cfg.Judges)
	var reviews []Review
	slot := 0
	for _, p := range pids {
		for k := 0; k < cfg.Coverage; k++ {
			j := jids[order[slot%cfg.Judges]]
			slot++
			sum := 0.0
			for c := 0; c < criteria; c++ {
				v := math.Round(center + bias[j] + scale[j]*truth[p] + cfg.Noise*rng.NormFloat64())
				sum += math.Max(1, math.Min(5, v))
			}
			s := sum / criteria
			reviews = append(reviews, Review{Judge: j, Project: p, Score: s})
			res.Reviews = append(res.Reviews, DemoReview{j, p, s})
		}
	}

	rep := Analyze(reviews, cfg.Coverage, Options{Bootstrap: bootstrap, Seed: cfg.Seed + 1})
	res.Report = rep

	raw, adj := map[string]float64{}, map[string]float64{}
	for _, pr := range rep.Projects {
		raw[pr.Project] = pr.Scores[MethodRaw]
		adj[pr.Project] = pr.Scores[rep.Primary]
	}
	rr, ar := rankOf(raw), rankOf(adj)
	acc := DemoAccuracy{RawTau: KendallTau(raw, truth), AdjustedTau: KendallTau(adj, truth)}
	for _, p := range pids {
		if trueRank[p] <= rep.TopK {
			if rr[p] <= rep.TopK {
				acc.RawTopK++
			}
			if ar[p] <= rep.TopK {
				acc.AdjustedTopK++
			}
		}
		if trueRank[p] == 1 {
			acc.RawWinner, acc.AdjWinner = rr[p] == 1, ar[p] == 1
		}
	}
	res.Accuracy = acc
	return res
}
