package judging

import (
	"math"
	"sort"
)

// Robustness answers the question a losing team will ask: "would we have won
// with different judges?" Every judge is removed in turn and the whole model
// refitted (leave-one-judge-out). If the winner and the top k survive every
// removal, no single judge decided the prizes.
type Robustness struct {
	Winner       string   `json:"winner"`
	Refits       int      `json:"refits"`        // judges removed one at a time
	WinnerHeld   int      `json:"winner_held"`   // refits in which the winner stayed first
	WinnerFlips  []string `json:"winner_flips"`  // judges whose removal changes the winner
	TopK         []string `json:"top_k"`         // the primary top k
	TopKHeld     int      `json:"top_k_held"`    // refits in which the top-k set is unchanged
	TopKFlips    []string `json:"top_k_flips"`   // judges whose removal changes the top-k set
	Pivotal      string   `json:"pivotal"`       // most influential judge (largest ranking change)
	PivotalTau   float64  `json:"pivotal_tau"`   // Kendall tau of the ranking without them
	RunnerUpGap  float64  `json:"runner_up_gap"` // adjusted-score gap between first and second
	WinnerMargin float64  `json:"winner_margin"` // gap in units of the pair's combined SE
}

// OutlierReview is a single review the model cannot explain: the judge's own
// leniency and scale, and every other judge's view of the project, predict
// something very different. It is where a typo, a misunderstanding, a
// conflict of interest or targeted favouritism shows up.
type OutlierReview struct {
	Judge       string  `json:"judge"`
	Project     string  `json:"project"`
	Score       float64 `json:"score"`
	Expected    float64 `json:"expected"`     // what the model predicts this judge would give this project
	Z           float64 `json:"z"`            // standardized residual
	RankWith    int     `json:"rank_with"`    // project's rank with the review
	RankWithout int     `json:"rank_without"` // and with only this one review removed
}

// OutlierZ is the standardized-residual threshold for flagging a review.
// Under the model about 1.2% of honest reviews exceed it by chance, so on a
// 120-review event expect one or two flags from noise alone: they are prompts
// to read the review, not accusations.
const OutlierZ = 2.5

func robustness(rep *Report, reviews []Review, full *Fit, opt Options) {
	if len(rep.Projects) < 2 {
		return
	}
	primary := map[string]float64{}
	for _, p := range rep.Projects {
		primary[p.Project] = p.Scores[rep.Primary]
	}
	k := min(opt.TopK, len(rep.Projects))
	winner := rep.Projects[0].Project
	topK := make([]string, 0, k)
	for _, p := range rep.Projects[:k] {
		topK = append(topK, p.Project)
	}
	second := rep.Projects[1]
	gap := primary[winner] - second.Scores[rep.Primary]
	rb := &Robustness{Winner: winner, TopK: topK, RunnerUpGap: gap, PivotalTau: 1}
	if se := math.Hypot(rep.Projects[0].SE, second.SE); se > 0 {
		rb.WinnerMargin = gap / se
	}

	quick := opt
	quick.Bootstrap = -1
	quick.init, quick.maxSweeps, quick.tol = full, 500, 1e-7

	byJudge := map[string][]Review{}
	for _, r := range reviews {
		byJudge[r.Judge] = append(byJudge[r.Judge], r)
	}
	judgeRow := map[string]*JudgeResult{}
	for _, j := range rep.Judges {
		judgeRow[j.Judge] = j
	}

	for _, j := range sortedKeys(byJudge) {
		var rest []Review
		for _, r := range reviews {
			if r.Judge != j {
				rest = append(rest, r)
			}
		}
		if len(rest) == 0 {
			continue
		}
		f := FitModel(rest, true, quick)
		adj := map[string]float64{}
		for p := range f.Quality {
			adj[p] = f.Adjusted(p)
		}
		rb.Refits++
		ranks := rankOf(adj)
		jr := judgeRow[j]

		if ranks[winner] == 1 {
			rb.WinnerHeld++
		} else {
			rb.WinnerFlips = append(rb.WinnerFlips, j)
			if jr != nil {
				jr.FlipsFirst = true
			}
		}
		changed := 0
		for _, p := range topK {
			if r, ok := ranks[p]; !ok || r > k {
				changed++
			}
		}
		if changed == 0 {
			rb.TopKHeld++
		} else {
			rb.TopKFlips = append(rb.TopKFlips, j)
		}
		tau := KendallTau(adj, primary)
		if tau < rb.PivotalTau {
			rb.Pivotal, rb.PivotalTau = j, tau
		}
		if jr == nil {
			continue
		}
		jr.Influence = 1 - tau
		jr.FlipsTopK = changed
		// Agreement with the consensus formed without this judge.
		var mine, theirs []float64
		for _, r := range byJudge[j] {
			if v, ok := adj[r.Project]; ok {
				mine = append(mine, r.Score)
				theirs = append(theirs, v)
			}
		}
		if len(mine) >= 3 {
			if c, ok := pearson(mine, theirs); ok {
				jr.Agreement, jr.HasAgree = c, true
				if c < 0 {
					jr.Flags = append(jr.Flags, "contrarian: ranks their projects opposite to the other judges")
				}
			}
		}
	}
	rep.Robustness = rb

	// Outlier reviews, and what each one is worth.
	rank := rankOf(primary)
	for i, r := range reviews {
		expected := full.Mu + full.Bias[r.Judge] + full.Scale[r.Judge]*full.Quality[r.Project]
		z := (r.Score - expected) / math.Max(full.Sigma, 1e-6)
		if math.Abs(z) < OutlierZ {
			continue
		}
		o := &OutlierReview{Judge: r.Judge, Project: r.Project, Score: r.Score, Expected: expected, Z: z, RankWith: rank[r.Project]}
		rest := make([]Review, 0, len(reviews)-1)
		rest = append(rest, reviews[:i]...)
		rest = append(rest, reviews[i+1:]...)
		f := FitModel(rest, true, quick)
		adj := map[string]float64{}
		for p := range f.Quality {
			adj[p] = f.Adjusted(p)
		}
		o.RankWithout = rankOf(adj)[r.Project]
		rep.Outliers = append(rep.Outliers, o)
		if jr := judgeRow[r.Judge]; jr != nil {
			jr.Outliers++
		}
	}
	sort.Slice(rep.Outliers, func(a, b int) bool { return math.Abs(rep.Outliers[a].Z) > math.Abs(rep.Outliers[b].Z) })
}

func pearson(x, y []float64) (float64, bool) {
	mx, sx := meanSD(x)
	my, sy := meanSD(y)
	if sx < 1e-9 || sy < 1e-9 {
		return 0, false
	}
	c := 0.0
	for i := range x {
		c += (x[i] - mx) * (y[i] - my)
	}
	return c / float64(len(x)-1) / (sx * sy), true
}

// Tiebreak picks the projects whose place in the prize zone is least certain
// (P(top k) closest to one half) so the next reviews go where they can change
// the outcome instead of confirming what is already clear. Projects with
// P(top k) outside [lo, hi] are settled and skipped.
func Tiebreak(rep *Report, max int, lo, hi float64) []*ProjectResult {
	var out []*ProjectResult
	for _, p := range rep.Projects {
		if p.ProbTopK > lo && p.ProbTopK < hi {
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		return math.Abs(out[a].ProbTopK-0.5) < math.Abs(out[b].ProbTopK-0.5)
	})
	if len(out) > max {
		out = out[:max]
	}
	return out
}
