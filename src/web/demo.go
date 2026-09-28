package web

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"dogfood/src/judging"
)

// Public, read-only endpoints behind the landing page. Neither touches event
// data beyond aggregate counts: the simulation runs the real engine on a
// synthetic hackathon drawn from the query parameters.

var demoCache = struct {
	sync.Mutex
	m map[judging.DemoConfig]*judging.DemoResult
}{m: map[judging.DemoConfig]*judging.DemoResult{}}

func (s *Server) demoRoutes(mux *http.ServeMux) {
	a := s.api
	mux.HandleFunc("GET /api/v1/stats", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.Stats(r.Context())
	}))
	mux.HandleFunc("GET /api/v1/demo/simulate", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := r.URL.Query()
		i := func(k string, def int) int {
			if v, err := strconv.Atoi(q.Get(k)); err == nil {
				return v
			}
			return def
		}
		f := func(k string, def float64) float64 {
			if v, err := strconv.ParseFloat(q.Get(k), 64); err == nil {
				return v
			}
			return def
		}
		seed, _ := strconv.ParseUint(q.Get("seed"), 10, 64)
		cfg := judging.DemoConfig{
			Projects: i("projects", 24), Judges: i("judges", 8), Coverage: i("coverage", 3),
			Leniency: f("leniency", 0.5), Scale: f("scale", 0.35), Noise: f("noise", 0.6), Seed: seed,
		}.Clamp()

		demoCache.Lock()
		res, ok := demoCache.m[cfg]
		demoCache.Unlock()
		if ok {
			return res, nil
		}
		// Only cache misses cost a fit, so only they spend the tighter budget.
		if err := s.limit(w, r, "simulate", 40, time.Minute); err != nil {
			return nil, err
		}
		res = judging.Demo(cfg, 120)
		demoCache.Lock()
		if len(demoCache.m) >= 256 {
			demoCache.m = map[judging.DemoConfig]*judging.DemoResult{}
		}
		demoCache.m[cfg] = res
		demoCache.Unlock()
		return res, nil
	}))
}
