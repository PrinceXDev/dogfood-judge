package judging

import (
	"hash/fnv"
	"math"
	"sort"
)

// AssignInput describes the assignment problem for one event.
type AssignInput struct {
	Judges     []JudgeInfo
	Projects   []ProjectInfo
	Existing   []Pair // assignments that already exist (any status except recused)
	Recused    []Pair // pairs that must never be re-created
	PerProject int    // target reviews per project
	// Targets overrides PerProject for individual projects (tie-breaker rounds).
	Targets map[string]int
	// Reasons prefixes a project's new assignment reasons, e.g. "tie-breaker: P(top 3) 48%".
	Reasons map[string]string
	Seed    uint64
}

type JudgeInfo struct {
	ID       string
	Tracks   []string // expertise; empty = generalist, eligible for any track
	Conflict []string // project ids this judge must never review (own team, declared COI)
}

type ProjectInfo struct {
	ID    string
	Track string
}

type Pair struct{ Judge, Project string }

// Assignment is one new (judge, project) pair with the reason it was chosen.
type Assignment struct {
	Judge   string `json:"judge"`
	Project string `json:"project"`
	Reason  string `json:"reason"`
}

// AssignReport summarises the resulting judge-project graph.
type AssignReport struct {
	New         []Assignment `json:"new"`
	LoadMin     int          `json:"load_min"`
	LoadMax     int          `json:"load_max"`
	LoadMean    float64      `json:"load_mean"`
	Components  int          `json:"components"`  // after assignment; 1 is what normalization needs
	Underfilled []string     `json:"underfilled"` // projects still short of PerProject
	OffTrack    int          `json:"off_track"`   // assignments made outside the judge's expertise
}

// Assign tops every project up to PerProject reviewers.
//
// Greedy, most-constrained project first. For each open slot it picks, among
// eligible judges (matching track, no conflict, not already assigned):
//
//  1. the lowest current load (balance the work),
//  2. then a judge in a different connected component from the project
//     (normalization can only compare judges whose projects overlap, so
//     bridging components is worth more than anything but load),
//  3. then the judge who shares the fewest projects with the project's
//     existing reviewers (spreads overlap across many judge pairs instead of
//     re-pairing the same two people, which strengthens the bias estimates),
//  4. then a seeded hash, so runs are reproducible but not alphabetical.
//
// If no track-matched judge is available it falls back to any conflict-free
// judge and says so in the reason. This is a heuristic, not an optimum; the
// report exposes load spread and connectivity so the organizer can judge it.
func Assign(in AssignInput) *AssignReport {
	rep := &AssignReport{}
	assigned := map[Pair]bool{}
	load := map[string]int{}
	byProject := map[string][]string{}
	blocked := map[Pair]bool{}
	for _, p := range in.Existing {
		assigned[p] = true
		load[p.Judge]++
		byProject[p.Project] = append(byProject[p.Project], p.Judge)
	}
	for _, p := range in.Recused {
		blocked[p] = true
	}
	for _, j := range in.Judges {
		for _, c := range j.Conflict {
			blocked[Pair{j.ID, c}] = true
		}
	}

	uf := newUnionFind()
	for p := range assigned {
		uf.union("j:"+p.Judge, "p:"+p.Project)
	}
	for _, j := range in.Judges {
		uf.find("j:" + j.ID)
	}
	for _, p := range in.Projects {
		uf.find("p:" + p.ID)
	}

	// co[a][b] = number of projects judges a and b both review.
	co := map[string]map[string]int{}
	bump := func(a, b string) {
		if co[a] == nil {
			co[a] = map[string]int{}
		}
		co[a][b]++
	}
	for _, js := range byProject {
		for _, a := range js {
			for _, b := range js {
				if a != b {
					bump(a, b)
				}
			}
		}
	}

	eligible := func(p ProjectInfo, strict bool) []string {
		var out []string
		for _, j := range in.Judges {
			pr := Pair{j.ID, p.ID}
			if assigned[pr] || blocked[pr] {
				continue
			}
			if strict && len(j.Tracks) > 0 && !contains(j.Tracks, p.Track) {
				continue
			}
			out = append(out, j.ID)
		}
		return out
	}

	projects := append([]ProjectInfo(nil), in.Projects...)
	sort.SliceStable(projects, func(a, b int) bool {
		ca, cb := len(eligible(projects[a], true)), len(eligible(projects[b], true))
		if ca != cb {
			return ca < cb
		}
		return projects[a].ID < projects[b].ID
	})

	for _, p := range projects {
		want := in.PerProject
		if t, ok := in.Targets[p.ID]; ok {
			want = t
		}
		for len(byProject[p.ID]) < want {
			cands := eligible(p, true)
			reason := "track match"
			if len(cands) == 0 {
				cands = eligible(p, false)
				reason = "no track-matched judge free; nearest available"
			}
			if len(cands) == 0 {
				rep.Underfilled = append(rep.Underfilled, p.ID)
				break
			}
			best, bestKey := "", [4]float64{math.Inf(1)}
			for _, j := range cands {
				bridge := 1.0
				if uf.find("j:"+j) != uf.find("p:"+p.ID) {
					bridge = 0
				}
				overlap := 0
				for _, other := range byProject[p.ID] {
					overlap += co[j][other]
				}
				key := [4]float64{float64(load[j]), bridge, float64(overlap), float64(hash(in.Seed, j, p.ID))}
				if less(key, bestKey) {
					best, bestKey = j, key
				}
			}
			why := reason
			if pre := in.Reasons[p.ID]; pre != "" {
				why = pre + "; " + reason
			}
			if bestKey[1] == 0 && len(byProject[p.ID]) > 0 {
				why += "; bridges two judge groups"
			}
			pr := Pair{best, p.ID}
			assigned[pr] = true
			load[best]++
			for _, other := range byProject[p.ID] {
				bump(best, other)
				bump(other, best)
			}
			byProject[p.ID] = append(byProject[p.ID], best)
			uf.union("j:"+best, "p:"+p.ID)
			if reason != "track match" {
				rep.OffTrack++
			}
			rep.New = append(rep.New, Assignment{Judge: best, Project: p.ID, Reason: why})
		}
	}

	rep.LoadMin = math.MaxInt
	total := 0
	for _, j := range in.Judges {
		l := load[j.ID]
		total += l
		rep.LoadMin = min(rep.LoadMin, l)
		rep.LoadMax = max(rep.LoadMax, l)
	}
	if len(in.Judges) == 0 {
		rep.LoadMin = 0
	} else {
		rep.LoadMean = float64(total) / float64(len(in.Judges))
	}
	// Components among projects and the judges attached to them.
	roots := map[string]bool{}
	for _, p := range in.Projects {
		roots[uf.find("p:"+p.ID)] = true
	}
	rep.Components = len(roots)
	return rep
}

func less(a, b [4]float64) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func hash(seed uint64, parts ...string) uint32 {
	h := fnv.New32a()
	var b [8]byte
	for i := range b {
		b[i] = byte(seed >> (8 * i))
	}
	h.Write(b[:])
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return h.Sum32()
}

type unionFind struct{ parent map[string]string }

func newUnionFind() *unionFind { return &unionFind{parent: map[string]string{}} }

func (u *unionFind) find(x string) string {
	if _, ok := u.parent[x]; !ok {
		u.parent[x] = x
	}
	for u.parent[x] != x {
		u.parent[x] = u.parent[u.parent[x]]
		x = u.parent[x]
	}
	return x
}

func (u *unionFind) union(a, b string) { u.parent[u.find(a)] = u.find(b) }
