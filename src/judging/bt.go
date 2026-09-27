package judging

import (
	"math"
	"math/rand/v2"
	"sort"
)

// Comparison is one pairwise verdict. Outcome is 1 if A won, 0 if B won, 0.5 for a tie.
type Comparison struct {
	Judge   string
	A, B    string
	Outcome float64
}

// BTFit is a Bradley-Terry fit: P(i beats j) = 1 / (1 + exp(-(theta_i - theta_j))).
type BTFit struct {
	Strength    map[string]float64 // theta, log-strength, centred at 0
	SE          map[string]float64 // standard error from the observed information matrix
	Comparisons map[string]int     // comparisons involving each item
	Iterations  int
}

// PriorGames is the weight of the regularising prior: every item is treated as
// having drawn PriorGames/2 wins and PriorGames/2 losses against a phantom item
// of strength 0. This keeps undefeated or never-compared items finite and
// connects otherwise disconnected comparison graphs (Laplace smoothing).
const PriorGames = 2.0

// FitBT estimates strengths with Hunter's (2004) MM algorithm. Ties count as
// half a win for each side, the usual convention (it is the MLE of the Rao-Kupper
// model's symmetric limit and keeps the estimator simple and monotone).
func FitBT(cs []Comparison, items []string) *BTFit {
	idx := map[string]int{}
	for _, it := range items {
		if _, ok := idx[it]; !ok {
			idx[it] = len(idx)
		}
	}
	for _, c := range cs {
		for _, it := range []string{c.A, c.B} {
			if _, ok := idx[it]; !ok {
				idx[it] = len(idx)
				items = append(items, it)
			}
		}
	}
	n := len(idx)
	wins := make([]float64, n)
	games := make([][]float64, n)
	for i := range games {
		games[i] = make([]float64, n)
	}
	count := map[string]int{}
	for _, c := range cs {
		a, b := idx[c.A], idx[c.B]
		wins[a] += c.Outcome
		wins[b] += 1 - c.Outcome
		games[a][b]++
		games[b][a]++
		count[c.A]++
		count[c.B]++
	}
	pi := make([]float64, n)
	for i := range pi {
		pi[i] = 1
	}
	fit := &BTFit{Strength: map[string]float64{}, SE: map[string]float64{}, Comparisons: count}
	for it := 1; it <= 10000; it++ {
		fit.Iterations = it
		maxDelta := 0.0
		next := make([]float64, n)
		for i := 0; i < n; i++ {
			den := PriorGames / (pi[i] + 1) // games against the phantom (strength 1)
			for j := 0; j < n; j++ {
				if games[i][j] > 0 {
					den += games[i][j] / (pi[i] + pi[j])
				}
			}
			next[i] = (wins[i] + PriorGames/2) / den
		}
		for i := range pi {
			maxDelta = math.Max(maxDelta, math.Abs(math.Log(next[i])-math.Log(pi[i])))
			pi[i] = next[i]
		}
		if maxDelta < 1e-10 {
			break
		}
	}
	// Information matrix for theta (phantom fixed at 0, so it is non-singular).
	info := make([][]float64, n)
	for i := range info {
		info[i] = make([]float64, n)
		p0 := pi[i] / (pi[i] + 1)
		info[i][i] += PriorGames * p0 * (1 - p0)
	}
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if games[i][j] == 0 {
				continue
			}
			p := pi[i] / (pi[i] + pi[j])
			w := games[i][j] * p * (1 - p)
			info[i][i] += w
			info[j][j] += w
			info[i][j] -= w
			info[j][i] -= w
		}
	}
	cov := invert(info)
	mean := 0.0
	for i := range pi {
		mean += math.Log(pi[i])
	}
	mean /= float64(n)
	for it, i := range idx {
		fit.Strength[it] = math.Log(pi[i]) - mean
		if cov != nil {
			fit.SE[it] = math.Sqrt(math.Max(cov[i][i], 0))
		}
	}
	return fit
}

// WinProb is the model's probability that a beats b.
func (f *BTFit) WinProb(a, b string) float64 {
	return 1 / (1 + math.Exp(-(f.Strength[a] - f.Strength[b])))
}

// NextPair picks the most informative pair for one judge from the candidate
// projects: it maximises p(1-p) (outcome uncertainty) divided by how often the
// pair and its members have already been compared, never repeats a pair the
// judge has already seen, and breaks near-ties randomly so judges do not all
// get the same queue. Returns ok=false when no fresh pair exists.
func NextPair(f *BTFit, candidates []string, seen map[[2]string]bool, pairCount map[[2]string]int, rng *rand.Rand) (a, b string, ok bool) {
	type cand struct {
		a, b  string
		score float64
	}
	var best []cand
	top := -1.0
	sort.Strings(candidates)
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			x, y := candidates[i], candidates[j]
			key := PairKey(x, y)
			if seen[key] {
				continue
			}
			p := f.WinProb(x, y)
			nx, ny := float64(f.Comparisons[x]), float64(f.Comparisons[y])
			score := p * (1 - p) / (1 + float64(pairCount[key])) / math.Sqrt(1+math.Min(nx, ny))
			switch {
			case score > top*1.02:
				top = score
				best = []cand{{x, y, score}}
			case score >= top*0.98:
				best = append(best, cand{x, y, score})
			}
		}
	}
	if len(best) == 0 {
		return "", "", false
	}
	c := best[rng.IntN(len(best))]
	if rng.IntN(2) == 0 { // randomise left/right to avoid position bias
		return c.b, c.a, true
	}
	return c.a, c.b, true
}

// PairKey is an order-independent key for a pair.
func PairKey(a, b string) [2]string {
	if a > b {
		a, b = b, a
	}
	return [2]string{a, b}
}

// invert returns the inverse of a symmetric positive-definite matrix by
// Gauss-Jordan elimination with partial pivoting, or nil if singular.
func invert(m [][]float64) [][]float64 {
	n := len(m)
	a := make([][]float64, n)
	for i := range m {
		a[i] = make([]float64, 2*n)
		copy(a[i], m[i])
		a[i][n+i] = 1
	}
	for col := 0; col < n; col++ {
		piv := col
		for r := col + 1; r < n; r++ {
			if math.Abs(a[r][col]) > math.Abs(a[piv][col]) {
				piv = r
			}
		}
		if math.Abs(a[piv][col]) < 1e-12 {
			return nil
		}
		a[col], a[piv] = a[piv], a[col]
		d := a[col][col]
		for k := range a[col] {
			a[col][k] /= d
		}
		for r := 0; r < n; r++ {
			if r == col || a[r][col] == 0 {
				continue
			}
			f := a[r][col]
			for k := range a[r] {
				a[r][k] -= f * a[col][k]
			}
		}
	}
	out := make([][]float64, n)
	for i := range a {
		out[i] = a[i][n:]
	}
	return out
}
