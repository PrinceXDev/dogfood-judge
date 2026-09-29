// Package judging holds the scoring mathematics: cross-judge normalization,
// Bradley-Terry estimation for pairwise mode, the assignment engine, and the
// Monte Carlo harness that validates them. It has no database or HTTP
// dependencies so every function can be tested against synthetic data.
//
// The method is documented and defended in JUDGING.md.
package judging

import (
	"math"
	"math/rand/v2"
	"sort"
)

// Review is one judge's composite (rubric-weighted) score for one project, on
// the rubric's own scale (e.g. 1..5).
type Review struct {
	Judge   string
	Project string
	Score   float64
	// Seq is the order in which the judge wrote this review (1 = first), used
	// only by the drift check; 0 means unknown and skips that check.
	Seq int
}

// Method names, in the order they are reported.
const (
	MethodRaw       = "raw"       // plain mean of reviews
	MethodZScore    = "zscore"    // per-judge standardisation (the common approach, shown for contrast)
	MethodBias      = "bias"      // additive judge-leniency model with shrinkage
	MethodBiasScale = "biasscale" // leniency + scale-use model with shrinkage (default)
	MethodPairwise  = "pairwise"  // Bradley-Terry on within-judge induced comparisons
)

// Options tunes the model. Zero values select the documented defaults.
type Options struct {
	// ScalePriorSD is the prior standard deviation of a judge's scale factor
	// around 1. Scale is weakly identified from a handful of reviews, so it is
	// a fixed, stated assumption rather than estimated. Default 0.3.
	ScalePriorSD float64
	// QualityPriorSD is the prior SD of project quality, in scale points.
	// Deliberately weak (default 1.0): projects are not pulled toward the mean
	// beyond this; uncertainty is reported as intervals instead. Estimating it
	// by empirical Bayes collapses toward zero on sparse, noisy data (the
	// fixture does this), which would make every project look identical.
	QualityPriorSD float64
	// Bootstrap replicates for rank intervals and top-k probabilities. Default 300; 0 disables with -1.
	Bootstrap int
	// Seed makes bootstrap output reproducible.
	Seed uint64
	// TopK for the "probability of finishing in the top k" column. Default 3.
	TopK int

	// Bootstrap refits start from the full-data fit and stop at a looser
	// tolerance; the rank statistics do not need 1e-9 precision.
	init      *Fit
	maxSweeps int
	tol       float64
}

func (o Options) withDefaults() Options {
	if o.ScalePriorSD == 0 {
		o.ScalePriorSD = 0.3
	}
	if o.QualityPriorSD == 0 {
		o.QualityPriorSD = 1.0
	}
	if o.Bootstrap == 0 {
		o.Bootstrap = 300
	}
	if o.Bootstrap < 0 {
		o.Bootstrap = 0
	}
	if o.Seed == 0 {
		o.Seed = 20260925
	}
	if o.TopK == 0 {
		o.TopK = 3
	}
	if o.maxSweeps == 0 {
		o.maxSweeps = 2000
	}
	if o.tol == 0 {
		o.tol = 1e-9
	}
	return o
}

// Fit is the result of the bias+scale model on one data set.
type Fit struct {
	Mu         float64            // grand mean
	Quality    map[string]float64 // q_p, deviation from Mu on the rubric scale
	QualitySE  map[string]float64 // posterior standard deviation of q_p
	Bias       map[string]float64 // b_j, judge leniency in scale points
	BiasSE     map[string]float64
	Scale      map[string]float64 // s_j, how much of the true spread the judge expresses
	Sigma      float64            // residual noise SD
	TauBias    float64            // estimated spread of judge leniency
	TauQuality float64            // estimated spread of project quality
	Iterations int
	Converged  bool
}

// Adjusted is the normalized score: what an average judge (zero bias, unit
// scale) would be expected to give the project, on the original scale.
func (f *Fit) Adjusted(p string) float64 { return f.Mu + f.Quality[p] }

// FitModel estimates  x_jp = mu + b_j + s_j * q_p + e_jp  by maximum a
// posteriori under Gaussian priors
//
//	b_j ~ N(0, tauB^2)   s_j ~ N(1, tauS^2)   q_p ~ N(0, tauQ^2)   e ~ N(0, sigma^2)
//
// using alternating ridge regressions (each step is an exact conditional
// update). tauB and sigma are re-estimated each sweep by approximate empirical
// Bayes (moment updates with leverage corrections), so judges are corrected
// only as far as the data supports; tauS and tauQ are fixed, stated priors. With withScale=false every s_j is
// pinned to 1, which gives the additive two-way random-effects model.
func FitModel(reviews []Review, withScale bool, opt Options) *Fit {
	opt = opt.withDefaults()
	f := &Fit{
		Quality: map[string]float64{}, QualitySE: map[string]float64{},
		Bias: map[string]float64{}, BiasSE: map[string]float64{}, Scale: map[string]float64{},
	}
	if len(reviews) == 0 {
		return f
	}
	// Dense indices: the loop below runs hundreds of sweeps per fit and
	// thousands of fits per bootstrap, so it works on slices, not maps.
	jIdx, pIdx := map[string]int{}, map[string]int{}
	for _, r := range reviews {
		if _, ok := jIdx[r.Judge]; !ok {
			jIdx[r.Judge] = 0
		}
		if _, ok := pIdx[r.Project]; !ok {
			pIdx[r.Project] = 0
		}
	}
	judges, projects := sortedKeys(jIdx), sortedKeys(pIdx)
	for i, j := range judges {
		jIdx[j] = i
	}
	for i, p := range projects {
		pIdx[p] = i
	}
	nJ, nP := len(judges), len(projects)
	rj := make([]int, len(reviews))
	rp := make([]int, len(reviews))
	x := make([]float64, len(reviews))
	byJudge := make([][]int, nJ)
	byProject := make([][]int, nP)
	sum := 0.0
	for i, r := range reviews {
		rj[i], rp[i], x[i] = jIdx[r.Judge], pIdx[r.Project], r.Score
		byJudge[rj[i]] = append(byJudge[rj[i]], i)
		byProject[rp[i]] = append(byProject[rp[i]], i)
		sum += r.Score
	}
	n := float64(len(reviews))
	mu := sum / n
	bias := make([]float64, nJ)
	scale := make([]float64, nJ)
	biasSE := make([]float64, nJ)
	q := make([]float64, nP)
	qSE := make([]float64, nP)
	for j := range scale {
		scale[j] = 1
	}
	// Initial variance components: split the total variance evenly.
	total := 0.0
	for _, v := range x {
		total += (v - mu) * (v - mu)
	}
	total = math.Max(total/n, 1e-3)
	sigma2, tauB2 := total/2, total/2
	tauS2 := opt.ScalePriorSD * opt.ScalePriorSD
	tauQ2 := opt.QualityPriorSD * opt.QualityPriorSD

	if in := opt.init; in != nil {
		mu = in.Mu
		for i, j := range judges {
			bias[i] = in.Bias[j]
			if s, ok := in.Scale[j]; ok {
				scale[i] = s
			}
		}
		for i, p := range projects {
			q[i] = in.Quality[p]
		}
		sigma2, tauB2 = in.Sigma*in.Sigma, in.TauBias*in.TauBias
	}

	for it := 1; it <= opt.maxSweeps; it++ {
		change := 0.0
		track := func(old, new float64) float64 {
			if d := math.Abs(new - old); d > change {
				change = d
			}
			return new
		}
		f.Iterations = it
		lamB, lamQ, lamS := sigma2/tauB2, sigma2/tauQ2, sigma2/tauS2

		// mu | b, s, q  (flat prior)
		acc := 0.0
		for i := range x {
			acc += x[i] - bias[rj[i]] - scale[rj[i]]*q[rp[i]]
		}
		mu = track(mu, acc/n)

		// q_p | mu, b, s  — ridge regression through the judges' scales.
		for p := 0; p < nP; p++ {
			num, den := 0.0, lamQ
			for _, i := range byProject[p] {
				s := scale[rj[i]]
				num += s * (x[i] - mu - bias[rj[i]])
				den += s * s
			}
			q[p] = track(q[p], num/den)
		}

		// (b_j, s_j) | mu, q  — 2x2 ridge regression per judge, s shrunk toward 1.
		for j := 0; j < nJ; j++ {
			var cnt, sq, sqq, sy, sqy float64
			for _, i := range byJudge[j] {
				qv := q[rp[i]]
				y := x[i] - mu
				cnt++
				sq += qv
				sqq += qv * qv
				sy += y
				sqy += qv * y
			}
			if !withScale {
				bias[j] = track(bias[j], (sy-sq)/(cnt+lamB))
				continue
			}
			a11, a12, a22 := cnt+lamB, sq, sqq+lamS
			b1, b2 := sy, sqy+lamS
			det := a11*a22 - a12*a12
			bias[j] = track(bias[j], (b1*a22-a12*b2)/det)
			scale[j] = track(scale[j], (a11*b2-a12*b1)/det)
		}

		// Empirical-Bayes variance updates. Each posterior variance term keeps a
		// component with little data from collapsing its prior to zero.
		rss := 0.0
		for i := range x {
			e := x[i] - mu - bias[rj[i]] - scale[rj[i]]*q[rp[i]]
			rss += e * e
		}
		lev, accB := 0.0, 0.0
		for j := 0; j < nJ; j++ {
			nj := float64(len(byJudge[j]))
			v := sigma2 / (nj + lamB)
			biasSE[j] = math.Sqrt(v)
			accB += bias[j]*bias[j] + v
			lev += nj / (nj + lamB)
		}
		for p := 0; p < nP; p++ {
			info := 0.0
			for _, i := range byProject[p] {
				s := scale[rj[i]]
				info += s * s
			}
			qSE[p] = math.Sqrt(sigma2 / (info + lamQ))
			lev += info / (info + lamQ)
		}
		dof := math.Max(n-1-lev, 0.25*n)
		newSigma2 := math.Max(rss/dof, 0.01)
		newTauB2 := math.Max(accB/float64(nJ), 0.0025) // floor: 0.05 scale points
		change = math.Max(change, math.Abs(newSigma2-sigma2)+math.Abs(newTauB2-tauB2))
		sigma2, tauB2 = newSigma2, newTauB2
		if change < opt.tol {
			f.Converged = true
			break
		}
	}
	f.Mu = mu
	for i, j := range judges {
		f.Bias[j], f.BiasSE[j], f.Scale[j] = bias[i], biasSE[i], scale[i]
	}
	for i, p := range projects {
		f.Quality[p], f.QualitySE[p] = q[i], qSE[i]
	}
	f.Sigma, f.TauBias, f.TauQuality = math.Sqrt(sigma2), math.Sqrt(tauB2), math.Sqrt(tauQ2)
	return f
}

// zScores standardises each judge's scores, then maps back to the pooled
// mean and SD. Judges with fewer than two reviews or zero variance carry no
// usable spread; their reviews become exactly average, which is the
// method's honest failure mode (a flat judge drags strong projects down).
func zScores(reviews []Review) map[string]float64 {
	byJudge := map[string][]float64{}
	all := make([]float64, 0, len(reviews))
	for _, r := range reviews {
		byJudge[r.Judge] = append(byJudge[r.Judge], r.Score)
		all = append(all, r.Score)
	}
	gm, gsd := meanSD(all)
	sums, counts := map[string]float64{}, map[string]float64{}
	for _, r := range reviews {
		m, sd := meanSD(byJudge[r.Judge])
		z := 0.0
		if len(byJudge[r.Judge]) >= 2 && sd > 1e-9 {
			z = (r.Score - m) / sd
		}
		sums[r.Project] += gm + gsd*z
		counts[r.Project]++
	}
	out := map[string]float64{}
	for p, s := range sums {
		out[p] = s / counts[p]
	}
	return out
}

func rawMeans(reviews []Review) map[string]float64 {
	sums, counts := map[string]float64{}, map[string]float64{}
	for _, r := range reviews {
		sums[r.Project] += r.Score
		counts[r.Project]++
	}
	out := map[string]float64{}
	for p, s := range sums {
		out[p] = s / counts[p]
	}
	return out
}

// InducedComparisons turns ratings into within-judge pairwise outcomes: for
// every pair of projects one judge scored, the higher score wins. A judge's
// leniency and scale cancel inside their own pairs, so this is an
// independent, assumption-light cross-check on the parametric model.
func InducedComparisons(reviews []Review) []Comparison {
	byJudge := map[string][]Review{}
	for _, r := range reviews {
		byJudge[r.Judge] = append(byJudge[r.Judge], r)
	}
	var out []Comparison
	for _, j := range sortedKeys(byJudge) {
		rs := byJudge[j]
		sort.Slice(rs, func(a, b int) bool { return rs[a].Project < rs[b].Project })
		for a := 0; a < len(rs); a++ {
			for b := a + 1; b < len(rs); b++ {
				c := Comparison{Judge: j, A: rs[a].Project, B: rs[b].Project}
				switch {
				case rs[a].Score > rs[b].Score+1e-9:
					c.Outcome = 1
				case rs[b].Score > rs[a].Score+1e-9:
					c.Outcome = 0
				default:
					c.Outcome = 0.5
				}
				out = append(out, c)
			}
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Report: everything the organizer's results page and the proof CLI show.

type ProjectResult struct {
	Project     string             `json:"project"`
	Reviews     int                `json:"reviews"`
	Scores      map[string]float64 `json:"scores"` // by method
	Ranks       map[string]int     `json:"ranks"`  // by method
	SE          float64            `json:"se"`     // posterior SD of the adjusted score
	RankLow     int                `json:"rank_low"`
	RankHigh    int                `json:"rank_high"`
	ProbTopK    float64            `json:"prob_top_k"`
	RankChange  int                `json:"rank_change"` // raw rank minus adjusted rank (+ = moved up)
	Provisional bool               `json:"provisional"` // fewer reviews than requested
	// AheadOfNext is the bootstrap probability that this project really
	// outranks the one listed directly below it; near 0.5 is a statistical tie.
	AheadOfNext float64 `json:"ahead_of_next"`
	// RankDist[r-1] counts bootstrap replicates in which the project placed
	// r-th; it sums to the bootstrap count. P(top n) for any n falls out of it.
	RankDist []int `json:"rank_dist"`
}

type JudgeResult struct {
	Judge     string   `json:"judge"`
	Reviews   int      `json:"reviews"`
	MeanGiven float64  `json:"mean_given"`
	SDGiven   float64  `json:"sd_given"`
	Bias      float64  `json:"bias"`
	BiasSE    float64  `json:"bias_se"`
	Scale     float64  `json:"scale"`
	Flags     []string `json:"flags"`
	// Agreement is the correlation between this judge's scores and the
	// consensus computed WITHOUT them (NaN-free; 0 when under 3 reviews).
	Agreement  float64 `json:"agreement"`
	HasAgree   bool    `json:"has_agreement"`
	Influence  float64 `json:"influence"` // 1 - Kendall tau between the full ranking and the ranking without this judge
	Outliers   int     `json:"outliers"`  // reviews by this judge flagged as outliers
	FlipsTopK  int     `json:"flips_top_k"`
	FlipsFirst bool    `json:"flips_first"`
	// Drift compares the judge's first and second half of reviews in the
	// order they wrote them; nil below DriftMinReviews or without an order.
	Drift *JudgeDrift `json:"drift,omitempty"`
}

type Report struct {
	Methods    []string           `json:"methods"`
	Primary    string             `json:"primary"`
	Projects   []*ProjectResult   `json:"projects"` // sorted by primary rank
	Judges     []*JudgeResult     `json:"judges"`
	Fit        FitSummary         `json:"fit"`
	Agreement  map[string]float64 `json:"agreement"`  // Kendall tau of each method vs primary
	Components int                `json:"components"` // connected components of the judge-project graph
	TopK       int                `json:"top_k"`
	Bootstrap  int                `json:"bootstrap"`
	Reviews    int                `json:"reviews"`
	Robustness *Robustness        `json:"robustness,omitempty"`
	Outliers   []*OutlierReview   `json:"outliers"`
}

type FitSummary struct {
	Mu         float64 `json:"mu"`
	Sigma      float64 `json:"sigma"`
	TauBias    float64 `json:"tau_bias"`
	TauQuality float64 `json:"tau_quality"`
	TauScale   float64 `json:"tau_scale_prior"`
	Iterations int     `json:"iterations"`
	Converged  bool    `json:"converged"`
}

// Analyze runs every method on the same reviews and assembles the report.
// wantReviews marks projects with fewer reviews as provisional.
func Analyze(reviews []Review, wantReviews int, opt Options) *Report {
	opt = opt.withDefaults()
	rep := &Report{
		Methods: []string{MethodRaw, MethodZScore, MethodBias, MethodBiasScale, MethodPairwise},
		Primary: MethodBiasScale, TopK: opt.TopK, Bootstrap: opt.Bootstrap, Reviews: len(reviews),
		Agreement: map[string]float64{},
	}
	if len(reviews) == 0 {
		return rep
	}
	scores := map[string]map[string]float64{
		MethodRaw:    rawMeans(reviews),
		MethodZScore: zScores(reviews),
	}
	bias := FitModel(reviews, false, opt)
	full := FitModel(reviews, true, opt)
	scores[MethodBias], scores[MethodBiasScale] = map[string]float64{}, map[string]float64{}
	for p := range full.Quality {
		scores[MethodBias][p] = bias.Adjusted(p)
		scores[MethodBiasScale][p] = full.Adjusted(p)
	}
	bt := FitBT(InducedComparisons(reviews), sortedKeys(full.Quality))
	scores[MethodPairwise] = bt.Strength

	ranks := map[string]map[string]int{}
	for m, sc := range scores {
		ranks[m] = rankOf(sc)
	}
	count := map[string]int{}
	for _, r := range reviews {
		count[r.Project]++
	}
	for _, p := range sortedKeys(full.Quality) {
		pr := &ProjectResult{Project: p, Reviews: count[p], Scores: map[string]float64{}, Ranks: map[string]int{},
			SE: full.QualitySE[p], Provisional: count[p] < wantReviews}
		for m := range scores {
			pr.Scores[m] = scores[m][p]
			pr.Ranks[m] = ranks[m][p]
		}
		pr.RankChange = pr.Ranks[MethodRaw] - pr.Ranks[MethodBiasScale]
		rep.Projects = append(rep.Projects, pr)
	}
	sort.Slice(rep.Projects, func(a, b int) bool {
		return rep.Projects[a].Ranks[rep.Primary] < rep.Projects[b].Ranks[rep.Primary]
	})
	for _, m := range rep.Methods {
		rep.Agreement[m] = KendallTau(scores[m], scores[rep.Primary])
	}
	rep.Fit = FitSummary{Mu: full.Mu, Sigma: full.Sigma, TauBias: full.TauBias, TauQuality: full.TauQuality,
		TauScale: opt.ScalePriorSD, Iterations: full.Iterations, Converged: full.Converged}
	rep.Judges = judgeDiagnostics(reviews, full)
	drift(rep.Judges, reviews, full, opt.Seed)
	rep.Components = Components(reviews)
	bootstrap(rep, reviews, full, opt)
	robustness(rep, reviews, full, opt)
	return rep
}

func judgeDiagnostics(reviews []Review, f *Fit) []*JudgeResult {
	given := map[string][]float64{}
	for _, r := range reviews {
		given[r.Judge] = append(given[r.Judge], r.Score)
	}
	var out []*JudgeResult
	for _, j := range sortedKeys(given) {
		m, sd := meanSD(given[j])
		jr := &JudgeResult{Judge: j, Reviews: len(given[j]), MeanGiven: m, SDGiven: sd,
			Bias: f.Bias[j], BiasSE: f.BiasSE[j], Scale: f.Scale[j], Flags: []string{}}
		if len(given[j]) >= 2 && sd < 1e-9 {
			jr.Flags = append(jr.Flags, "flat: identical scores for every project; carries no ranking information")
		}
		if len(given[j]) < 3 {
			jr.Flags = append(jr.Flags, "low data: bias estimate shrunk strongly toward zero")
		}
		if math.Abs(jr.Bias) > 2*jr.BiasSE && len(given[j]) >= 3 {
			if jr.Bias > 0 {
				jr.Flags = append(jr.Flags, "lenient")
			} else {
				jr.Flags = append(jr.Flags, "harsh")
			}
		}
		if jr.Scale < 0.6 && len(given[j]) >= 3 {
			jr.Flags = append(jr.Flags, "compressed: uses little of the scale")
		}
		out = append(out, jr)
	}
	return out
}

// bootstrap resamples each project's reviews with replacement (stratified, so
// no project vanishes from a replicate), refits the primary model, and records
// rank intervals and the probability of finishing in the top k.
func bootstrap(rep *Report, reviews []Review, full *Fit, opt Options) {
	if opt.Bootstrap == 0 {
		for _, p := range rep.Projects {
			p.RankLow, p.RankHigh = p.Ranks[rep.Primary], p.Ranks[rep.Primary]
		}
		return
	}
	byProject := map[string][]Review{}
	for _, r := range reviews {
		byProject[r.Project] = append(byProject[r.Project], r)
	}
	projects := sortedKeys(byProject)
	rng := rand.New(rand.NewPCG(opt.Seed, 0x9e3779b97f4a7c15))
	rankSamples := map[string][]int{}
	top := map[string]int{}
	rankDist := map[string][]int{}
	ahead := make([]int, len(rep.Projects))
	quick := opt
	quick.Bootstrap = -1
	quick.init, quick.maxSweeps, quick.tol = full, 300, 1e-6
	for b := 0; b < opt.Bootstrap; b++ {
		sample := make([]Review, 0, len(reviews))
		for _, p := range projects {
			rs := byProject[p]
			for range rs {
				sample = append(sample, rs[rng.IntN(len(rs))])
			}
		}
		f := FitModel(sample, true, quick)
		adj := map[string]float64{}
		for _, p := range projects {
			adj[p] = f.Adjusted(p)
		}
		for p, r := range rankOf(adj) {
			rankSamples[p] = append(rankSamples[p], r)
			if rankDist[p] == nil {
				rankDist[p] = make([]int, len(projects))
			}
			rankDist[p][r-1]++
			if r <= opt.TopK {
				top[p]++
			}
		}
		for i := 0; i+1 < len(rep.Projects); i++ {
			if adj[rep.Projects[i].Project] > adj[rep.Projects[i+1].Project] {
				ahead[i]++
			}
		}
	}
	for _, p := range rep.Projects {
		rs := rankSamples[p.Project]
		sort.Ints(rs)
		p.RankLow = rs[int(0.05*float64(len(rs)))]
		p.RankHigh = rs[int(math.Min(0.95*float64(len(rs)), float64(len(rs)-1)))]
		p.ProbTopK = float64(top[p.Project]) / float64(opt.Bootstrap)
		p.RankDist = rankDist[p.Project]
	}
	for i := 0; i+1 < len(rep.Projects); i++ {
		rep.Projects[i].AheadOfNext = float64(ahead[i]) / float64(opt.Bootstrap)
	}
}

// ---------------------------------------------------------------------------
// helpers

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func meanSD(xs []float64) (float64, float64) {
	if len(xs) == 0 {
		return 0, 0
	}
	m := 0.0
	for _, x := range xs {
		m += x
	}
	m /= float64(len(xs))
	v := 0.0
	for _, x := range xs {
		v += (x - m) * (x - m)
	}
	if len(xs) > 1 {
		v /= float64(len(xs) - 1)
	}
	return m, math.Sqrt(v)
}

// rankOf ranks by descending score; ties broken by id so output is deterministic.
func rankOf(scores map[string]float64) map[string]int {
	ids := sortedKeys(scores)
	sort.SliceStable(ids, func(a, b int) bool { return scores[ids[a]] > scores[ids[b]] })
	out := map[string]int{}
	for i, id := range ids {
		out[id] = i + 1
	}
	return out
}

// RankOf is exported for callers that rank their own score maps.
func RankOf(scores map[string]float64) map[string]int { return rankOf(scores) }

// KendallTau (tau-b) between two score maps over their shared keys.
func KendallTau(a, b map[string]float64) float64 {
	var keys []string
	for k := range a {
		if _, ok := b[k]; ok {
			keys = append(keys, k)
		}
	}
	var conc, disc, tieA, tieB float64
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			da := a[keys[i]] - a[keys[j]]
			db := b[keys[i]] - b[keys[j]]
			switch {
			case math.Abs(da) < 1e-12 && math.Abs(db) < 1e-12:
			case math.Abs(da) < 1e-12:
				tieA++
			case math.Abs(db) < 1e-12:
				tieB++
			case da*db > 0:
				conc++
			default:
				disc++
			}
		}
	}
	den := math.Sqrt((conc + disc + tieA) * (conc + disc + tieB))
	if den == 0 {
		return 0
	}
	return (conc - disc) / den
}

// Components counts connected components of the bipartite judge-project
// graph. Scores in different components cannot be put on a common scale by
// any method without extra assumptions; the report says so when this is > 1.
func Components(reviews []Review) int {
	parent := map[string]string{}
	var find func(string) string
	find = func(x string) string {
		if _, ok := parent[x]; !ok {
			parent[x] = x
		}
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for _, r := range reviews {
		parent[find("j:"+r.Judge)] = find("p:" + r.Project)
	}
	roots := map[string]bool{}
	for k := range parent {
		roots[find(k)] = true
	}
	return len(roots)
}
