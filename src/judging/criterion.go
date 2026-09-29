package judging

import (
	"math"
	"sort"
)

// Per-criterion leniency. The main model corrects each judge's composite
// score; this breaks leniency down by criterion, so an organizer can see
// "jdg_07 is harsh on innovation only" before reading a single review.
//
// Each value is compared with the mean of the OTHER judges who scored the
// same project on the same criterion, so project quality cancels out and only
// the judge's offset remains. A judge's raw offset on a criterion is the mean
// of those deviations. It is then shrunk toward zero by empirical Bayes:
//
//	lambda = tau^2 / (tau^2 + SE^2)    shrunk = lambda * raw
//
// where SE^2 = s^2 / n is the sampling variance of the raw mean (s pooled
// across the criterion's judges) and tau^2 is the real spread of leniency on
// that criterion, estimated by the method of moments. A judge with few
// reviews, or a criterion where judges don't really differ, is pulled to zero.
// The 90% interval is shrunk +- 1.645 * sqrt(lambda) * SE, the posterior SD.

// CriterionScore is one criterion value from one review.
type CriterionScore struct {
	Judge     string
	Project   string
	Criterion string
	Value     float64
}

type CriterionCell struct {
	Judge     string  `json:"judge"`
	Criterion string  `json:"criterion"`
	Reviews   int     `json:"reviews"` // co-judged values behind the estimate
	Raw       float64 `json:"raw"`     // mean deviation from co-judges, scale points
	Lambda    float64 `json:"lambda"`  // shrinkage weight on the raw offset
	Shrunk    float64 `json:"shrunk"`
	Low       float64 `json:"low"` // 90% interval
	High      float64 `json:"high"`
	// Signal is "lenient" or "harsh" when the interval clears zero, "noise"
	// when it doesn't, and "low data" under CriterionMinReviews.
	Signal string `json:"signal"`
}

type CriterionSpread struct {
	Criterion string  `json:"criterion"`
	Tau       float64 `json:"tau"`   // real spread of judge leniency on this criterion
	Sigma     float64 `json:"sigma"` // per-review noise of a deviation
	Flagged   int     `json:"flagged"`
}

type CriterionReport struct {
	Criteria []CriterionSpread `json:"criteria"`
	Cells    []CriterionCell   `json:"cells"` // by judge, then criterion in rubric order
}

const CriterionMinReviews = 3

// CriterionLeniency estimates every judge's offset on every criterion.
// criteria gives the rubric order; values on other criteria are ignored.
func CriterionLeniency(scores []CriterionScore, criteria []string) *CriterionReport {
	rep := &CriterionReport{Criteria: []CriterionSpread{}, Cells: []CriterionCell{}}
	type key struct{ j, c string }
	cells := map[key]CriterionCell{}
	for _, c := range criteria {
		byProject := map[string][]CriterionScore{}
		for _, s := range scores {
			if s.Criterion == c {
				byProject[s.Project] = append(byProject[s.Project], s)
			}
		}
		devs := map[string][]float64{}
		for _, ss := range byProject {
			if len(ss) < 2 {
				continue // nobody to compare with
			}
			sum := 0.0
			for _, s := range ss {
				sum += s.Value
			}
			for _, s := range ss {
				others := (sum - s.Value) / float64(len(ss)-1)
				devs[s.Judge] = append(devs[s.Judge], s.Value-others)
			}
		}
		if len(devs) == 0 {
			continue
		}
		// Pooled within-judge variance of a deviation; with too few degrees
		// of freedom, fall back to the variance of all deviations.
		var ss, all []float64
		df := 0
		sq := 0.0
		for _, d := range devs {
			m, _ := meanSD(d)
			for _, x := range d {
				sq += (x - m) * (x - m)
				all = append(all, x)
			}
			df += len(d) - 1
			ss = append(ss, m)
		}
		s2 := 0.0
		if df >= 2 {
			s2 = sq / float64(df)
		} else {
			_, sd := meanSD(all)
			s2 = sd * sd
		}
		s2 = math.Max(s2, 1e-6)
		// Method of moments: Var(raw means) = tau^2 + mean(SE^2).
		meanSE2 := 0.0
		for _, d := range devs {
			meanSE2 += s2 / float64(len(d))
		}
		meanSE2 /= float64(len(devs))
		tau2 := 0.0
		if len(ss) >= 2 {
			_, sdm := meanSD(ss)
			tau2 = math.Max(0, sdm*sdm-meanSE2)
		}
		spread := CriterionSpread{Criterion: c, Tau: math.Sqrt(tau2), Sigma: math.Sqrt(s2)}
		for _, j := range sortedKeys(devs) {
			d := devs[j]
			raw, _ := meanSD(d)
			se2 := s2 / float64(len(d))
			lam := tau2 / (tau2 + se2)
			post := math.Sqrt(lam * se2)
			cell := CriterionCell{Judge: j, Criterion: c, Reviews: len(d), Raw: raw, Lambda: lam,
				Shrunk: lam * raw, Low: lam*raw - 1.645*post, High: lam*raw + 1.645*post, Signal: "noise"}
			switch {
			case len(d) < CriterionMinReviews:
				cell.Signal = "low data"
			case cell.Low > 0:
				cell.Signal = "lenient"
			case cell.High < 0:
				cell.Signal = "harsh"
			}
			if cell.Signal == "lenient" || cell.Signal == "harsh" {
				spread.Flagged++
			}
			cells[key{j, c}] = cell
		}
		rep.Criteria = append(rep.Criteria, spread)
	}
	order := map[string]int{}
	for i, c := range criteria {
		order[c] = i
	}
	for _, cell := range cells {
		rep.Cells = append(rep.Cells, cell)
	}
	sort.Slice(rep.Cells, func(a, b int) bool {
		x, y := rep.Cells[a], rep.Cells[b]
		if x.Judge != y.Judge {
			return x.Judge < y.Judge
		}
		return order[x.Criterion] < order[y.Criterion]
	})
	return rep
}
