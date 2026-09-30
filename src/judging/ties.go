package judging

import "math"

// DavidsonFit is a Bradley-Terry fit that models ties instead of counting them
// as half a win (Davidson 1970):
//
//	P(i beats j) = pi_i / D,  P(tie) = nu*sqrt(pi_i*pi_j) / D,
//	D = pi_i + pi_j + nu*sqrt(pi_i*pi_j).
//
// nu is estimated from the data: two evenly matched projects tie with
// probability nu/(2+nu). With nu -> 0 it reduces to plain Bradley-Terry.
type DavidsonFit struct {
	Strength    map[string]float64 // theta = log pi, centred at 0 (same scale as BTFit)
	SE          map[string]float64
	Comparisons map[string]int
	Nu          float64 // tie propensity
	NuSE        float64 // delta-method SE of Nu
	Ties        int     // observed ties
	Total       int     // observed comparisons
	Iterations  int
	Converged   bool
}

// TiePrior is the pseudo-data that keeps nu finite: one tie and one decisive
// game between two evenly matched phantoms, which pulls an event with no ties
// (or only ties) gently towards nu = 2 instead of 0 or infinity.
const TiePrior = 1.0

// FitDavidson maximises the Davidson log-likelihood plus the same phantom
// prior FitBT uses (PriorGames decisive games per item against strength 0)
// and TiePrior. The penalised log-likelihood is jointly concave in
// (theta, log nu), so damped Newton from the origin finds the unique maximum.
// Outcome 0.5 is a tie; anything else is read as a win for A (>0.5) or B.
func FitDavidson(cs []Comparison, items []string) *DavidsonFit {
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
			}
		}
	}
	n := len(idx)
	type obs struct {
		a, b int
		kind int // 0: a won, 1: b won, 2: tie
	}
	data := make([]obs, 0, len(cs))
	fit := &DavidsonFit{Strength: map[string]float64{}, SE: map[string]float64{}, Comparisons: map[string]int{}}
	for _, c := range cs {
		o := obs{a: idx[c.A], b: idx[c.B]}
		switch {
		case c.Outcome == 0.5:
			o.kind = 2
			fit.Ties++
		case c.Outcome < 0.5:
			o.kind = 1
		}
		data = append(data, o)
		fit.Comparisons[c.A]++
		fit.Comparisons[c.B]++
	}
	fit.Total = len(cs)

	// Parameters: x[0..n-1] = theta, x[n] = lambda = log nu.
	dim := n + 1
	x := make([]float64, dim)
	x[n] = math.Log(2)

	// eval returns the penalised log-likelihood and, when want is set, its
	// gradient and the negative Hessian (which is the Fisher information:
	// for a softmax over linear features it does not depend on the outcome).
	eval := func(x []float64, want bool) (float64, []float64, [][]float64) {
		var g []float64
		var h [][]float64
		if want {
			g = make([]float64, dim)
			h = make([][]float64, dim)
			for i := range h {
				h[i] = make([]float64, dim)
			}
		}
		ll := 0.0
		lam := x[n]
		for _, o := range data {
			ti, tj := x[o.a], x[o.b]
			// Three outcomes, each exp(linear feature): e_i, e_j, (e_i+e_j)/2 + e_lambda.
			z := [3]float64{ti, tj, lam + (ti+tj)/2}
			m := math.Max(z[0], math.Max(z[1], z[2]))
			s := math.Exp(z[0]-m) + math.Exp(z[1]-m) + math.Exp(z[2]-m)
			lse := m + math.Log(s)
			ll += z[o.kind] - lse
			if !want {
				continue
			}
			p := [3]float64{math.Exp(z[0] - lse), math.Exp(z[1] - lse), math.Exp(z[2] - lse)}
			// Features as sparse (index, weight) lists over (theta_i, theta_j, lambda).
			type fw struct {
				i int
				w float64
			}
			feat := [3][]fw{
				{{o.a, 1}},
				{{o.b, 1}},
				{{o.a, 0.5}, {o.b, 0.5}, {n, 1}},
			}
			for _, f := range feat[o.kind] {
				g[f.i] += f.w
			}
			mean := map[int]float64{}
			for k := 0; k < 3; k++ {
				for _, f := range feat[k] {
					g[f.i] -= p[k] * f.w
					mean[f.i] += p[k] * f.w
				}
			}
			// Information = E[a a^T] - E[a] E[a]^T.
			for k := 0; k < 3; k++ {
				for _, f1 := range feat[k] {
					for _, f2 := range feat[k] {
						h[f1.i][f2.i] += p[k] * f1.w * f2.w
					}
				}
			}
			for i, mi := range mean {
				for j, mj := range mean {
					h[i][j] -= mi * mj
				}
			}
		}
		// Phantom prior: PriorGames/2 wins and losses against strength 0.
		for i := 0; i < n; i++ {
			p0 := 1 / (1 + math.Exp(-x[i]))
			ll += PriorGames / 2 * (math.Log(p0) + math.Log(1-p0))
			if want {
				g[i] += PriorGames/2 - PriorGames*p0
				h[i][i] += PriorGames * p0 * (1 - p0)
			}
		}
		// Tie prior: one tie and one decisive game between equal phantoms.
		nu := math.Exp(lam)
		pt := nu / (2 + nu)
		ll += TiePrior * (math.Log(pt) + math.Log(1-pt))
		if want {
			g[n] += TiePrior * (1 - 2*pt)
			h[n][n] += 2 * TiePrior * pt * (1 - pt)
		}
		return ll, g, h
	}

	ll, g, h := eval(x, true)
	for it := 1; it <= 200; it++ {
		fit.Iterations = it
		cov := invert(h)
		if cov == nil {
			break
		}
		step := make([]float64, dim)
		dec := 0.0
		for i := range step {
			for j := range step {
				step[i] += cov[i][j] * g[j]
			}
			dec += step[i] * g[i]
		}
		if dec < 1e-18 { // Newton decrement: we are at the maximum
			fit.Converged = true
			break
		}
		t := 1.0
		next := make([]float64, dim)
		for {
			for i := range next {
				next[i] = x[i] + t*step[i]
			}
			nll, _, _ := eval(next, false)
			if nll >= ll+1e-4*t*dec || t < 1e-8 {
				break
			}
			t /= 2
		}
		x = next
		ll, g, h = eval(x, true)
	}

	cov := invert(h)
	mean := 0.0
	for i := 0; i < n; i++ {
		mean += x[i]
	}
	if n > 0 {
		mean /= float64(n)
	}
	for it, i := range idx {
		fit.Strength[it] = x[i] - mean
		if cov != nil {
			fit.SE[it] = math.Sqrt(math.Max(cov[i][i], 0))
		}
	}
	fit.Nu = math.Exp(x[n])
	if cov != nil {
		fit.NuSE = fit.Nu * math.Sqrt(math.Max(cov[n][n], 0))
	}
	return fit
}

// Probs returns P(a wins), P(b wins) and P(tie) under the fit.
func (f *DavidsonFit) Probs(a, b string) (win, loss, tie float64) {
	pa, pb := math.Exp(f.Strength[a]), math.Exp(f.Strength[b])
	t := f.Nu * math.Sqrt(pa*pb)
	d := pa + pb + t
	return pa / d, pb / d, t / d
}

// EvenTieProb is the probability that two evenly matched projects tie.
func (f *DavidsonFit) EvenTieProb() float64 { return f.Nu / (2 + f.Nu) }

// NuInterval is a z-sigma interval for Nu, built on log nu (where the fit is
// close to normal) and mapped back, so it never goes below zero.
func (f *DavidsonFit) NuInterval(z float64) (lo, hi float64) {
	if f.Nu <= 0 {
		return 0, 0
	}
	s := f.NuSE / f.Nu
	return f.Nu * math.Exp(-z*s), f.Nu * math.Exp(z*s)
}
