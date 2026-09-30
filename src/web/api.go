package web

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"dogfood/src/core"
)

// The JSON API. Every page action is available here (API First); the
// OpenAPI description is served at /api/v1/openapi.yaml.

type apiHandler func(w http.ResponseWriter, r *http.Request) (any, error)

// api wraps a handler: CSRF for cookie-authenticated writes, JSON encoding,
// and error mapping. Handlers return (value, error); value nil means 204.
func (s *Server) api(h apiHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.checkCSRF(r) {
			s.fail(w, r, errCSRF)
			return
		}
		v, err := h(w, r)
		// Drain any unread body before replying: closing a socket with unread
		// request bytes makes the OS send a TCP reset, and the client can lose
		// the response (seen with Python's urllib, which sends Connection: close).
		io.Copy(io.Discard, io.LimitReader(r.Body, 1<<20))
		if err != nil {
			s.fail(w, r, err)
			return
		}
		if v == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		status := http.StatusOK
		if r.Method == http.MethodPost {
			if c, ok := v.(created); ok {
				status, v = http.StatusCreated, c.v
			}
		}
		writeJSON(w, status, v)
	}
}

type created struct{ v any }

func decode(r *http.Request, v any, limit int64) error {
	body := http.MaxBytesReader(nil, r.Body, limit)
	dec := json.NewDecoder(body)
	if err := dec.Decode(v); err != nil && err != io.EOF {
		return &core.Error{Kind: core.KindInvalid, Code: "invalid_json", Message: "request body is not valid JSON: " + err.Error()}
	}
	return nil
}

// eventParam resolves {event} (id or slug) to an id.
func (s *Server) eventParam(r *http.Request) (string, error) {
	return s.svc.EventID(r.Context(), r.PathValue("event"))
}

func (s *Server) apiRoutes(mux *http.ServeMux) {
	a := s.api
	// auth
	mux.HandleFunc("POST /api/v1/auth/login", a(s.apiLogin))
	mux.HandleFunc("POST /api/v1/auth/signup", a(s.apiSignup))
	mux.HandleFunc("POST /api/v1/auth/logout", a(s.apiLogout))
	mux.HandleFunc("GET /api/v1/me", a(s.apiMe))
	mux.HandleFunc("POST /api/v1/tokens", a(s.apiCreateToken))
	mux.HandleFunc("POST /api/v1/activate/{token}", a(s.apiActivate))
	s.oauthRoutes(mux)

	// events
	mux.HandleFunc("GET /api/v1/events", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.ListEvents(r.Context(), actorOf(r))
	}))
	mux.HandleFunc("POST /api/v1/events", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in core.EventInput
		if err := decode(r, &in, 1<<20); err != nil {
			return nil, err
		}
		e, err := s.svc.CreateEvent(r.Context(), actorOf(r), in)
		return created{e}, err
	}))
	mux.HandleFunc("GET /api/v1/events/{event}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.Event(r.Context(), actorOf(r), r.PathValue("event"))
	}))
	mux.HandleFunc("PATCH /api/v1/events/{event}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in core.EventInput
		if err := decode(r, &in, 1<<20); err != nil {
			return nil, err
		}
		return s.svc.UpdateEvent(r.Context(), actorOf(r), id, in)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/tracks", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in core.Track
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		t, err := s.svc.AddTrack(r.Context(), actorOf(r), id, in.Name, in.Description)
		return created{t}, err
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/prizes", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in core.Prize
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		p, err := s.svc.AddPrize(r.Context(), actorOf(r), id, in)
		return created{p}, err
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/criteria", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in core.Criterion
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		c, err := s.svc.AddCriterion(r.Context(), actorOf(r), id, in)
		return created{c}, err
	}))
	mux.HandleFunc("PUT /api/v1/events/{event}/criteria/weights", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in map[string]float64
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		if err := s.svc.SetCriterionWeights(r.Context(), actorOf(r), id, in); err != nil {
			return nil, err
		}
		return s.svc.Event(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/invitations", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in struct {
			Email string    `json:"email"`
			Role  core.Role `json:"role"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		inv, err := s.svc.Invite(r.Context(), actorOf(r), id, in.Email, in.Role)
		if err != nil {
			return nil, err
		}
		return created{map[string]any{"invitation": inv, "url": s.absURL(r, "/invite/"+inv.Token)}}, nil
	}))
	mux.HandleFunc("GET /api/v1/invitations/{token}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		inv, e, err := s.svc.InvitationInfo(r.Context(), r.PathValue("token"))
		if err != nil {
			return nil, err
		}
		inv.Token = ""
		return map[string]any{"invitation": inv, "event": e}, nil
	}))
	mux.HandleFunc("GET /api/v1/teams/invite/{token}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		t, e, err := s.svc.TeamByInvite(r.Context(), r.PathValue("token"))
		if err != nil {
			return nil, err
		}
		// Public preview of an invite link: names only, never member emails.
		names := []string{}
		for _, m := range t.Members {
			names = append(names, m.Name)
		}
		return map[string]any{"team": map[string]any{"id": t.ID, "name": t.Name, "members": names}, "event": e}, nil
	}))
	mux.HandleFunc("GET /api/v1/activate/{token}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		u, err := s.svc.ActivationInfo(r.Context(), r.PathValue("token"))
		if err != nil {
			return nil, err
		}
		return map[string]string{"email": u.Email, "name": u.Name}, nil
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/all-projects", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		ps, err := s.svc.EventProjects(r.Context(), actorOf(r), id)
		if ps == nil && err == nil {
			ps = []*core.Project{}
		}
		return ps, err
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/comments", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.EventComments(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("POST /api/v1/invitations/{token}/accept", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.AcceptInvitation(r.Context(), actorOf(r), r.PathValue("token"))
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/judges", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.Judges(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("PUT /api/v1/events/{event}/judges/{user}/tracks", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in struct {
			Tracks []string `json:"tracks"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return nil, s.svc.SetJudgeTracks(r.Context(), actorOf(r), id, r.PathValue("user"), in.Tracks)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/users/{user}/activation", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		tok, err := s.svc.ActivationLink(r.Context(), actorOf(r), id, r.PathValue("user"))
		if err != nil {
			return nil, err
		}
		return created{map[string]string{"url": s.absURL(r, "/activate/"+tok)}}, nil
	}))

	// gallery and projects
	mux.HandleFunc("GET /api/v1/projects", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.Gallery(r.Context(), galleryFilter(r, r.URL.Query().Get("event")))
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/projects", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.Gallery(r.Context(), galleryFilter(r, r.PathValue("event")))
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/projects", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in core.ProjectInput
		if err := decode(r, &in, 1<<20); err != nil {
			return nil, err
		}
		p, err := s.svc.CreateProject(r.Context(), actorOf(r), r.PathValue("event"), in)
		return created{p}, err
	}))
	mux.HandleFunc("GET /api/v1/projects/{id}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.Project(r.Context(), actorOf(r), r.PathValue("id"))
	}))
	mux.HandleFunc("PATCH /api/v1/projects/{id}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in core.ProjectInput
		if err := decode(r, &in, 1<<20); err != nil {
			return nil, err
		}
		return s.svc.UpdateProject(r.Context(), actorOf(r), r.PathValue("id"), in)
	}))
	mux.HandleFunc("POST /api/v1/projects/{id}/duplicate", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Of string `json:"of"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return nil, s.svc.MarkDuplicate(r.Context(), actorOf(r), r.PathValue("id"), in.Of)
	}))
	mux.HandleFunc("POST /api/v1/projects/{id}/disqualify", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Reason string `json:"reason"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return nil, s.svc.Disqualify(r.Context(), actorOf(r), r.PathValue("id"), in.Reason)
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/duplicates", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		pairs, err := s.svc.DuplicateCandidates(r.Context(), actorOf(r), id)
		out := []map[string]any{}
		for _, p := range pairs {
			out = append(out, map[string]any{"original": p[0], "duplicate": p[1]})
		}
		return out, err
	}))

	// teams
	mux.HandleFunc("POST /api/v1/events/{event}/teams", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Name string `json:"name"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		t, err := s.svc.CreateTeam(r.Context(), actorOf(r), r.PathValue("event"), in.Name)
		return created{t}, err
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/team", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.MyTeam(r.Context(), actorOf(r), r.PathValue("event"))
	}))
	mux.HandleFunc("POST /api/v1/teams/join", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Token string `json:"token"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return s.svc.JoinTeam(r.Context(), actorOf(r), in.Token)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/team/leave", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return nil, s.svc.LeaveTeam(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/team/invite/rotate", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.RotateInvite(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/teams/{team}/extension", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in struct {
			Minutes int    `json:"minutes"`
			Reason  string `json:"reason"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return nil, s.svc.GrantExtension(r.Context(), actorOf(r), id, r.PathValue("team"), in.Minutes, in.Reason)
	}))

	// judging
	mux.HandleFunc("GET /api/v1/judge/scores", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := r.URL.Query()
		rs, err := s.svc.JudgeScores(r.Context(), actorOf(r), q.Get("judge"), q.Get("event"))
		if err != nil {
			return nil, err
		}
		if rs == nil {
			rs = []*core.Review{}
		}
		return map[string]any{"scores": rs}, nil
	}))
	mux.HandleFunc("GET /api/v1/judge/assignments", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		as, err := s.svc.MyAssignments(r.Context(), actorOf(r), r.URL.Query().Get("event"))
		if as == nil && err == nil {
			as = []core.Assignment{}
		}
		return as, err
	}))
	mux.HandleFunc("PUT /api/v1/events/{event}/reviews/{project}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Scores  map[string]int `json:"scores"`
			Comment string         `json:"comment"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return s.svc.SubmitReview(r.Context(), actorOf(r), r.PathValue("event"), r.PathValue("project"), in.Scores, in.Comment)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/assignments/{project}/recuse", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in struct {
			Reason string `json:"reason"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return nil, s.svc.Recuse(r.Context(), actorOf(r), id, r.PathValue("project"), in.Reason)
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/assignments", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.EventAssignments(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/assignments/run", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.RunAssignment(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/assignments/tiebreak", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		in := struct {
			Max int `json:"max"`
		}{}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return s.svc.RunTiebreak(r.Context(), actorOf(r), r.PathValue("event"), in.Max)
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/results/bundle", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		b, err := s.svc.Bundle(r.Context(), actorOf(r), r.PathValue("event"))
		if err == nil {
			w.Header().Set("Content-Disposition", `attachment; filename="`+b.Inputs.EventID+`-results-bundle.json"`)
		}
		return b, err
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/pairwise/next", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.NextPair(r.Context(), actorOf(r), r.PathValue("event"))
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/pairwise", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			A       string `json:"a"`
			B       string `json:"b"`
			Outcome string `json:"outcome"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return nil, s.svc.SubmitComparison(r.Context(), actorOf(r), r.PathValue("event"), in.A, in.B, in.Outcome)
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/progress", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.Progress(r.Context(), actorOf(r), r.PathValue("event"))
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/results", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		b, _ := strconv.Atoi(r.URL.Query().Get("bootstrap"))
		if b <= 0 || b > 2000 {
			b = 300
		}
		return s.svc.Results(r.Context(), actorOf(r), r.PathValue("event"), b)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/publish", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		in := struct {
			Published *bool `json:"published"`
		}{}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		publish := in.Published == nil || *in.Published
		return nil, s.svc.Publish(r.Context(), actorOf(r), id, publish)
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/reviews", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.EventReviews(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/export/scores.csv", func(w http.ResponseWriter, r *http.Request) {
		s.csv(w, r, "scores", s.svc.ScoresCSV)
	})
	mux.HandleFunc("GET /api/v1/events/{event}/export/results.csv", func(w http.ResponseWriter, r *http.Request) {
		s.csv(w, r, "results", s.svc.ResultsCSV)
	})
	mux.HandleFunc("GET /api/v1/events/{event}/export.json", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		d, err := s.svc.Export(r.Context(), actorOf(r), r.PathValue("event"))
		if err == nil {
			w.Header().Set("Content-Disposition", `attachment; filename="`+d.Event.ID+`.json"`)
		}
		return d, err
	}))
	mux.HandleFunc("POST /api/v1/import", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var d core.Doc
		if err := decode(r, &d, 32<<20); err != nil {
			return nil, err
		}
		res, err := s.svc.Import(r.Context(), actorOf(r), &d)
		return created{res}, err
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/audit", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		entries, v, err := s.svc.AuditLog(r.Context(), actorOf(r), id, 500)
		if err != nil {
			return nil, err
		}
		ids := make([]string, 0, len(entries))
		for _, e := range entries {
			ids = append(ids, e.ActorID)
		}
		return map[string]any{"verification": v, "entries": entries, "names": s.svc.UserNames(r.Context(), ids)}, nil
	}))

	// voting and comments
	mux.HandleFunc("GET /api/v1/events/{event}/ballot", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.svc.Ballot(r.Context(), actorOf(r), r.PathValue("event"))
	}))
	mux.HandleFunc("POST /api/v1/projects/{id}/vote", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		if err := s.limit(w, r, "vote", 30, time.Minute); err != nil {
			return nil, err
		}
		return nil, s.svc.Vote(r.Context(), actorOf(r), r.PathValue("id"))
	}))
	mux.HandleFunc("DELETE /api/v1/projects/{id}/vote", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return nil, s.svc.Unvote(r.Context(), actorOf(r), r.PathValue("id"))
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/votes/flagged", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.FlaggedVotes(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/votes/review", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in struct {
			User    string `json:"user"`
			Project string `json:"project"`
			Approve bool   `json:"approve"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return nil, s.svc.ReviewVote(r.Context(), actorOf(r), id, in.User, in.Project, in.Approve)
	}))
	mux.HandleFunc("GET /api/v1/projects/{id}/comments", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		cs, err := s.svc.Comments(r.Context(), actorOf(r), r.PathValue("id"))
		if cs == nil && err == nil {
			cs = []core.Comment{}
		}
		return cs, err
	}))
	mux.HandleFunc("POST /api/v1/projects/{id}/comments", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		if err := s.limit(w, r, "comment", 10, time.Minute); err != nil {
			return nil, err
		}
		var in struct {
			Body string `json:"body"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		c, err := s.svc.AddComment(r.Context(), actorOf(r), r.PathValue("id"), in.Body)
		return created{c}, err
	}))
	mux.HandleFunc("POST /api/v1/comments/{id}/hide", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		in := struct {
			Hidden *bool `json:"hidden"`
		}{}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		return nil, s.svc.HideComment(r.Context(), actorOf(r), r.PathValue("id"), in.Hidden == nil || *in.Hidden)
	}))

	// webhooks
	mux.HandleFunc("GET /api/v1/events/{event}/webhooks", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.Webhooks(r.Context(), actorOf(r), id)
	}))
	mux.HandleFunc("POST /api/v1/events/{event}/webhooks", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		var in struct {
			URL    string   `json:"url"`
			Topics []string `json:"topics"`
		}
		if err := decode(r, &in, 1<<16); err != nil {
			return nil, err
		}
		h, err := s.svc.CreateWebhook(r.Context(), actorOf(r), id, in.URL, in.Topics)
		return created{h}, err
	}))
	mux.HandleFunc("DELETE /api/v1/events/{event}/webhooks/{id}", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return nil, s.svc.DeleteWebhook(r.Context(), actorOf(r), id, r.PathValue("id"))
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/webhooks/deliveries", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := s.eventParam(r)
		if err != nil {
			return nil, err
		}
		return s.svc.Deliveries(r.Context(), actorOf(r), id)
	}))

	// signed records
	mux.HandleFunc("GET /api/v1/events/{event}/records/judge", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		rec, payload, err := s.svc.JudgeRecord(r.Context(), actorOf(r), r.PathValue("event"))
		return map[string]any{"record": rec, "payload": payload}, err
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/records/participant", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		rec, payload, err := s.svc.ParticipantRecord(r.Context(), actorOf(r), r.PathValue("event"))
		return map[string]any{"record": rec, "payload": payload}, err
	}))
	mux.HandleFunc("POST /api/v1/records/verify", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var rec core.SignedRecord
		if err := decode(r, &rec, 1<<16); err != nil {
			return nil, err
		}
		p, err := core.VerifyRecord(s.svc.SigningKey().Pub, rec)
		if err != nil {
			return map[string]any{"valid": false, "reason": err.Error()}, nil
		}
		return map[string]any{"valid": true, "payload": p}, nil
	}))
	// signed audit checkpoints and receipts
	mux.HandleFunc("GET /api/v1/audit/checkpoint", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		rec, payload, err := s.svc.AuditCheckpoint(r.Context())
		return map[string]any{"record": rec, "payload": payload}, err
	}))
	mux.HandleFunc("GET /api/v1/events/{event}/audit/receipt", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		rec, payload, err := s.svc.AuditReceipt(r.Context(), actorOf(r), r.PathValue("event"))
		return map[string]any{"record": rec, "payload": payload}, err
	}))
	mux.HandleFunc("POST /api/v1/audit/verify", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		// Re-walks the whole chain, so it is rate-limited like other public writes.
		if err := s.limit(w, r, "audit-verify", 30, time.Minute); err != nil {
			return nil, err
		}
		var rec core.SignedRecord
		if err := decode(r, &rec, 1<<20); err != nil {
			return nil, err
		}
		return s.svc.CheckAuditProof(r.Context(), rec)
	}))
	mux.HandleFunc("GET /.well-known/dogfood-signing-key", a(func(w http.ResponseWriter, r *http.Request) (any, error) {
		k := s.svc.SigningKey()
		return map[string]string{"alg": "Ed25519", "key_id": k.KeyID, "public_key": base64.StdEncoding.EncodeToString(k.Pub)}, nil
	}))

	s.demoRoutes(mux)

	mux.HandleFunc("GET /api/v1/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		b, _ := assets.ReadFile("static/openapi.yaml")
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		w.Write(b)
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		s.fail(w, r, &core.Error{Kind: core.KindNotFound, Code: "not_found", Message: "no such endpoint; see /api/v1/openapi.yaml"})
	})
}

func (s *Server) apiLogin(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := s.limit(w, r, "login", 10, time.Minute); err != nil {
		return nil, err
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(r, &in, 1<<16); err != nil {
		return nil, err
	}
	tok, u, err := s.svc.Login(r.Context(), actorOf(r), in.Email, in.Password)
	if err != nil {
		return nil, err
	}
	return map[string]any{"token": tok, "user": u, "expires_in": int(core.SessionTTL.Seconds())}, nil
}

func (s *Server) apiSignup(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := s.limit(w, r, "signup", 5, time.Hour); err != nil {
		return nil, err
	}
	var in struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := decode(r, &in, 1<<16); err != nil {
		return nil, err
	}
	u, err := s.svc.SignUp(r.Context(), actorOf(r), in.Email, in.Name, in.Password)
	if err != nil {
		return nil, err
	}
	tok, _, err := s.svc.Login(r.Context(), actorOf(r), in.Email, in.Password)
	return created{map[string]any{"token": tok, "user": u}}, err
}

func (s *Server) apiLogout(w http.ResponseWriter, r *http.Request) (any, error) {
	tok, _ := tokenOf(r)
	return nil, s.svc.Logout(r.Context(), tok)
}

func (s *Server) apiActivate(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Password string `json:"password"`
	}
	if err := decode(r, &in, 1<<16); err != nil {
		return nil, err
	}
	tok, u, err := s.svc.Activate(r.Context(), actorOf(r), r.PathValue("token"), in.Password)
	if err != nil {
		return nil, err
	}
	return map[string]any{"token": tok, "user": u}, nil
}

func (s *Server) apiMe(w http.ResponseWriter, r *http.Request) (any, error) {
	a := actorOf(r)
	if !a.LoggedIn() {
		return nil, core.ErrUnauthenticated
	}
	events, err := s.svc.ListEvents(r.Context(), a)
	if err != nil {
		return nil, err
	}
	roles := map[string][]core.Role{}
	for _, e := range events {
		rs, err := s.svc.Roles(r.Context(), a, e.ID)
		if err != nil {
			return nil, err
		}
		for role, ok := range rs {
			if ok {
				roles[e.ID] = append(roles[e.ID], role)
			}
		}
	}
	return map[string]any{"user": a.User, "roles": roles, "can_create_events": s.svc.CanCreateEvents(a),
		"csrf_token": s.csrfToken(r)}, nil
}

func (s *Server) apiCreateToken(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Label string `json:"label"`
	}
	if err := decode(r, &in, 1<<16); err != nil {
		return nil, err
	}
	tok, err := s.svc.CreateAPIToken(r.Context(), actorOf(r), in.Label)
	return created{map[string]string{"token": tok}}, err
}

func galleryFilter(r *http.Request, event string) core.GalleryFilter {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	return core.GalleryFilter{EventID: event, Query: q.Get("q"), TrackID: q.Get("track"), Page: page}
}

func (s *Server) csv(w http.ResponseWriter, r *http.Request, name string, fn func(context.Context, core.Actor, string, io.Writer) error) {
	id, err := s.eventParam(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var buf strings.Builder
	if err := fn(r.Context(), actorOf(r), id, &buf); err != nil {
		s.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+id+"-"+name+`.csv"`)
	w.Header().Set("Cache-Control", "no-store")
	io.WriteString(w, buf.String())
}

func (s *Server) absURL(r *http.Request, path string) string {
	if s.cfg.PublicURL != "" {
		return strings.TrimRight(s.cfg.PublicURL, "/") + path
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host + path
}
