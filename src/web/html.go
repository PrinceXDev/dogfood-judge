package web

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"dogfood/src/core"
	"dogfood/src/judging"
	"dogfood/src/store"
)

// page wraps a form-handling page: CSRF on writes, errors rendered as pages.
func (s *Server) page(h func(w http.ResponseWriter, r *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
			if err := r.ParseForm(); err != nil {
				s.fail(w, r, &core.Error{Kind: core.KindInvalid, Code: "bad_form", Message: "could not read the form"})
				return
			}
			if !s.checkCSRF(r) {
				s.fail(w, r, errCSRF)
				return
			}
		}
		if err := h(w, r); err != nil {
			s.fail(w, r, err)
		}
	}
}

func redirect(w http.ResponseWriter, r *http.Request, to, msg string) error {
	if msg != "" {
		sep := "?"
		if strings.Contains(to, "?") {
			sep = "&"
		}
		to += sep + "msg=" + msg
	}
	http.Redirect(w, r, to, http.StatusSeeOther)
	return nil
}

func (s *Server) htmlRoutes(mux *http.ServeMux) {
	p := s.page
	mux.HandleFunc("GET /{$}", p(s.home))
	mux.HandleFunc("GET /projects", p(s.gallery))
	mux.HandleFunc("GET /events/{event}", p(s.eventPage))
	mux.HandleFunc("GET /events/{event}/projects", p(s.gallery))
	mux.HandleFunc("GET /events/{event}/results", p(s.publicResults))
	mux.HandleFunc("GET /p/{id}", p(s.projectPage))
	mux.HandleFunc("POST /p/{id}/comments", p(s.postComment))
	mux.HandleFunc("POST /p/{id}/vote", p(s.postVote))

	mux.HandleFunc("GET /login", p(s.loginPage))
	mux.HandleFunc("POST /login", p(s.loginPost))
	mux.HandleFunc("GET /signup", p(s.signupPage))
	mux.HandleFunc("POST /signup", p(s.signupPost))
	mux.HandleFunc("POST /logout", p(s.logoutPost))
	mux.HandleFunc("GET /activate/{token}", p(s.activatePage))
	mux.HandleFunc("POST /activate/{token}", p(s.activatePost))
	mux.HandleFunc("GET /account", p(s.accountPage))
	mux.HandleFunc("POST /account/tokens", p(s.accountToken))

	// participant
	mux.HandleFunc("GET /events/{event}/team", p(s.teamPage))
	mux.HandleFunc("POST /events/{event}/team", p(s.teamCreate))
	mux.HandleFunc("POST /events/{event}/team/leave", p(s.teamLeave))
	mux.HandleFunc("POST /events/{event}/team/rotate", p(s.teamRotate))
	mux.HandleFunc("POST /events/{event}/submission", p(s.submissionSave))
	mux.HandleFunc("GET /join/{token}", p(s.joinPage))
	mux.HandleFunc("POST /join/{token}", p(s.joinPost))
	mux.HandleFunc("GET /events/{event}/certificate", p(s.certificatePage))
	mux.HandleFunc("GET /events/{event}/ballot", p(s.ballotPage))

	// judge
	mux.HandleFunc("GET /invite/{token}", p(s.invitePage))
	mux.HandleFunc("POST /invite/{token}", p(s.invitePost))
	mux.HandleFunc("GET /judge", p(s.judgeHome))
	mux.HandleFunc("GET /judge/{event}/p/{project}", p(s.reviewPage))
	mux.HandleFunc("POST /judge/{event}/p/{project}", p(s.reviewPost))
	mux.HandleFunc("POST /judge/{event}/p/{project}/recuse", p(s.recusePost))
	mux.HandleFunc("GET /judge/{event}/pairwise", p(s.pairwisePage))
	mux.HandleFunc("POST /judge/{event}/pairwise", p(s.pairwisePost))
	mux.HandleFunc("GET /judge/{event}/record", p(s.judgeRecordPage))

	// organizer
	mux.HandleFunc("GET /organize/new", p(s.newEventPage))
	mux.HandleFunc("POST /organize/new", p(s.newEventPost))
	mux.HandleFunc("GET /organize/{event}", p(s.dashboard))
	mux.HandleFunc("POST /organize/{event}/assign", p(s.assignPost))
	mux.HandleFunc("POST /organize/{event}/invite", p(s.invitePostOrg))
	mux.HandleFunc("POST /organize/{event}/activation", p(s.activationPostOrg))
	mux.HandleFunc("GET /organize/{event}/settings", p(s.settingsPage))
	mux.HandleFunc("POST /organize/{event}/settings", p(s.settingsPost))
	mux.HandleFunc("POST /organize/{event}/tracks", p(s.trackPost))
	mux.HandleFunc("POST /organize/{event}/prizes", p(s.prizePost))
	mux.HandleFunc("POST /organize/{event}/criteria", p(s.criteriaPost))
	mux.HandleFunc("POST /organize/{event}/extension", p(s.extensionPost))
	mux.HandleFunc("GET /organize/{event}/results", p(s.orgResults))
	mux.HandleFunc("POST /organize/{event}/publish", p(s.publishPost))
	mux.HandleFunc("GET /organize/{event}/moderation", p(s.moderationPage))
	mux.HandleFunc("POST /organize/{event}/duplicate", p(s.duplicatePost))
	mux.HandleFunc("POST /organize/{event}/votes", p(s.voteReviewPost))
	mux.HandleFunc("POST /organize/{event}/comments/{id}", p(s.commentModeratePost))
	mux.HandleFunc("POST /organize/{event}/webhooks", p(s.webhookPost))
	mux.HandleFunc("GET /organize/{event}/audit", p(s.auditPage))

	// public utilities
	mux.HandleFunc("GET /verify", p(s.verifyPage))
	mux.HandleFunc("POST /verify", p(s.verifyPage))
	mux.HandleFunc("GET /embed/{event}", p(s.embedPage))
	mux.HandleFunc("GET /api", p(func(w http.ResponseWriter, r *http.Request) error {
		s.render(w, r, "apidocs", map[string]any{"Title": "API"})
		return nil
	}))
}

// ---------------------------------------------------------------------------
// Public pages

func (s *Server) home(w http.ResponseWriter, r *http.Request) error {
	events, err := s.svc.ListEvents(r.Context(), actorOf(r))
	if err != nil {
		return err
	}
	type row struct {
		*core.Event
		Phase string
		Roles map[string]bool
	}
	var rows []row
	for _, e := range events {
		rows = append(rows, row{e, e.Phase(s.now()), s.roleFlags(r, e.ID)})
	}
	s.render(w, r, "home", map[string]any{"Title": "Events", "Events": rows})
	return nil
}

func (s *Server) gallery(w http.ResponseWriter, r *http.Request) error {
	event := r.PathValue("event")
	if event == "" {
		event = r.URL.Query().Get("event")
	}
	f := galleryFilter(r, event)
	page, err := s.svc.Gallery(r.Context(), f)
	if err != nil {
		return err
	}
	data := map[string]any{"Title": "Gallery", "Page": page, "Filter": f}
	var ev *core.Event
	if event != "" {
		if ev, err = s.svc.Event(r.Context(), actorOf(r), event); err != nil {
			return err
		}
		data["Event"], data["Title"] = ev, ev.Name+" gallery"
	} else {
		events, _ := s.svc.ListEvents(r.Context(), actorOf(r))
		data["Events"] = events
	}
	pages := (page.Total + page.PageSize - 1) / page.PageSize
	data["Pages"], data["HasNext"], data["HasPrev"] = pages, page.Page < pages, page.Page > 1
	s.render(w, r, "gallery", data)
	return nil
}

func (s *Server) eventPage(w http.ResponseWriter, r *http.Request) error {
	e, err := s.svc.Event(r.Context(), actorOf(r), r.PathValue("event"))
	if err != nil {
		return err
	}
	now := s.now()
	data := map[string]any{"Title": e.Name, "Event": e, "Phase": e.Phase(now), "Roles": s.roleFlags(r, e.ID),
		"SubmissionsOpen": e.SubmissionsOpen(now), "JudgingOpen": e.JudgingOpen(now), "VotingOpen": e.VotingOpen(now)}
	if a := actorOf(r); a.LoggedIn() {
		if t, err := s.svc.MyTeam(r.Context(), a, e.ID); err == nil {
			data["Team"] = t
		}
	}
	page, err := s.svc.Gallery(r.Context(), core.GalleryFilter{EventID: e.ID})
	if err != nil {
		return err
	}
	data["ProjectCount"] = page.Total
	s.render(w, r, "event", data)
	return nil
}

func (s *Server) projectPage(w http.ResponseWriter, r *http.Request) error {
	a := actorOf(r)
	p, err := s.svc.Project(r.Context(), a, r.PathValue("id"))
	if err != nil {
		return err
	}
	e, err := s.svc.Event(r.Context(), a, p.EventID)
	if err != nil {
		return err
	}
	comments, err := s.svc.Comments(r.Context(), a, p.ID)
	if err != nil {
		return err
	}
	data := map[string]any{"Title": p.Title, "Project": p, "Event": e, "Comments": comments,
		"Roles": s.roleFlags(r, e.ID), "VotingOpen": e.VotingOpen(s.now())}
	if a.LoggedIn() && e.VotingOpen(s.now()) {
		if b, err := s.svc.Ballot(r.Context(), a, e.ID); err == nil {
			voted := false
			for _, id := range b.MyVotes {
				voted = voted || id == p.ID
			}
			data["Voted"], data["Remaining"] = voted, b.Remaining
		}
	}
	s.render(w, r, "project", data)
	return nil
}

func (s *Server) postComment(w http.ResponseWriter, r *http.Request) error {
	if err := s.limit(w, r, "comment", 10, time.Minute); err != nil {
		return err
	}
	id := r.PathValue("id")
	if _, err := s.svc.AddComment(r.Context(), actorOf(r), id, r.PostFormValue("body")); err != nil {
		return err
	}
	return redirect(w, r, "/p/"+id+"#comments", "")
}

func (s *Server) postVote(w http.ResponseWriter, r *http.Request) error {
	if err := s.limit(w, r, "vote", 30, time.Minute); err != nil {
		return err
	}
	id := r.PathValue("id")
	back := safeNext(r.PostFormValue("next"))
	if back == "/" {
		back = "/p/" + id
	}
	if r.PostFormValue("action") == "unvote" {
		if err := s.svc.Unvote(r.Context(), actorOf(r), id); err != nil {
			return err
		}
		return redirect(w, r, back, "unvoted")
	}
	if err := s.svc.Vote(r.Context(), actorOf(r), id); err != nil {
		return err
	}
	return redirect(w, r, back, "voted")
}

func (s *Server) publicResults(w http.ResponseWriter, r *http.Request) error {
	res, err := s.svc.Results(r.Context(), actorOf(r), r.PathValue("event"), 300)
	if err != nil {
		return err
	}
	if !res.Published {
		return &core.Error{Kind: core.KindForbidden, Code: "not_published", Message: "results are not published yet"}
	}
	s.render(w, r, "results", map[string]any{"Title": res.Event.Name + " results", "Res": res, "TopK": res.Report.TopK})
	return nil
}

func (s *Server) ballotPage(w http.ResponseWriter, r *http.Request) error {
	b, err := s.svc.Ballot(r.Context(), actorOf(r), r.PathValue("event"))
	if err != nil {
		return err
	}
	e, err := s.svc.Event(r.Context(), actorOf(r), b.EventID)
	if err != nil {
		return err
	}
	voted := map[string]bool{}
	for _, id := range b.MyVotes {
		voted[id] = true
	}
	s.render(w, r, "ballot", map[string]any{"Title": "Vote", "Ballot": b, "Event": e, "Voted": voted})
	return nil
}

// ---------------------------------------------------------------------------
// Accounts

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) error {
	s.render(w, r, "login", map[string]any{"Title": "Sign in", "Next": safeNext(r.URL.Query().Get("next"))})
	return nil
}

func (s *Server) loginPost(w http.ResponseWriter, r *http.Request) error {
	next := safeNext(r.PostFormValue("next"))
	if err := s.limit(w, r, "login", 10, time.Minute); err != nil {
		return err
	}
	tok, _, err := s.svc.Login(r.Context(), actorOf(r), r.PostFormValue("email"), r.PostFormValue("password"))
	if err != nil {
		if core.ErrorKind(err) == core.KindUnauthenticated {
			w.WriteHeader(http.StatusUnauthorized)
			s.render(w, r, "login", map[string]any{"Title": "Sign in", "Next": next, "Error": err.Error(), "Email": r.PostFormValue("email")})
			return nil
		}
		return err
	}
	s.setSession(w, tok)
	return redirect(w, r, next, "")
}

func (s *Server) signupPage(w http.ResponseWriter, r *http.Request) error {
	s.render(w, r, "signup", map[string]any{"Title": "Create account", "Next": safeNext(r.URL.Query().Get("next"))})
	return nil
}

func (s *Server) signupPost(w http.ResponseWriter, r *http.Request) error {
	next := safeNext(r.PostFormValue("next"))
	if err := s.limit(w, r, "signup", 5, time.Hour); err != nil {
		return err
	}
	f := r.PostForm
	if _, err := s.svc.SignUp(r.Context(), actorOf(r), f.Get("email"), f.Get("name"), f.Get("password")); err != nil {
		if k := core.ErrorKind(err); k == core.KindInvalid || k == core.KindConflict {
			w.WriteHeader(statusFor(err))
			s.render(w, r, "signup", map[string]any{"Title": "Create account", "Next": next, "Error": err.Error(),
				"Email": f.Get("email"), "Name": f.Get("name")})
			return nil
		}
		return err
	}
	tok, _, err := s.svc.Login(r.Context(), actorOf(r), f.Get("email"), f.Get("password"))
	if err != nil {
		return err
	}
	s.setSession(w, tok)
	return redirect(w, r, next, "welcome")
}

func (s *Server) logoutPost(w http.ResponseWriter, r *http.Request) error {
	if tok, fromCookie := tokenOf(r); fromCookie {
		s.svc.Logout(r.Context(), tok)
	}
	s.clearSession(w)
	return redirect(w, r, "/", "")
}

func (s *Server) activatePage(w http.ResponseWriter, r *http.Request) error {
	u, err := s.svc.ActivationInfo(r.Context(), r.PathValue("token"))
	if err != nil {
		return err
	}
	s.render(w, r, "activate", map[string]any{"Title": "Activate account", "User": u, "Token": r.PathValue("token")})
	return nil
}

func (s *Server) activatePost(w http.ResponseWriter, r *http.Request) error {
	if err := s.limit(w, r, "login", 10, time.Minute); err != nil {
		return err
	}
	tok, _, err := s.svc.Activate(r.Context(), actorOf(r), r.PathValue("token"), r.PostFormValue("password"))
	if err != nil {
		if core.ErrorKind(err) == core.KindInvalid {
			u, _ := s.svc.ActivationInfo(r.Context(), r.PathValue("token"))
			w.WriteHeader(http.StatusBadRequest)
			s.render(w, r, "activate", map[string]any{"Title": "Activate account", "User": u, "Token": r.PathValue("token"), "Error": err.Error()})
			return nil
		}
		return err
	}
	s.setSession(w, tok)
	return redirect(w, r, "/", "welcome")
}

func (s *Server) accountPage(w http.ResponseWriter, r *http.Request) error {
	a := actorOf(r)
	if !a.LoggedIn() {
		return core.ErrUnauthenticated
	}
	s.render(w, r, "account", map[string]any{"Title": "Account"})
	return nil
}

func (s *Server) accountToken(w http.ResponseWriter, r *http.Request) error {
	tok, err := s.svc.CreateAPIToken(r.Context(), actorOf(r), r.PostFormValue("label"))
	if err != nil {
		return err
	}
	s.render(w, r, "account", map[string]any{"Title": "Account", "NewToken": tok})
	return nil
}

// ---------------------------------------------------------------------------
// Participant

func (s *Server) teamPage(w http.ResponseWriter, r *http.Request) error {
	a := actorOf(r)
	if !a.LoggedIn() {
		return core.ErrUnauthenticated
	}
	e, err := s.svc.Event(r.Context(), a, r.PathValue("event"))
	if err != nil {
		return err
	}
	data := map[string]any{"Title": "Your team", "Event": e, "Roles": s.roleFlags(r, e.ID),
		"SubmissionsOpen": e.SubmissionsOpen(s.now()), "Closed": !s.now().Before(e.SubmissionsCloseAt)}
	t, err := s.svc.MyTeam(r.Context(), a, e.ID)
	if err != nil && core.ErrorKind(err) != core.KindNotFound {
		return err
	}
	if t != nil {
		data["Team"] = t
		data["InviteURL"] = s.absURL(r, "/join/"+t.InviteToken)
	}
	s.render(w, r, "team", data)
	return nil
}

func (s *Server) teamCreate(w http.ResponseWriter, r *http.Request) error {
	ev := r.PathValue("event")
	if _, err := s.svc.CreateTeam(r.Context(), actorOf(r), ev, r.PostFormValue("name")); err != nil {
		return err
	}
	return redirect(w, r, "/events/"+ev+"/team", "created")
}

func (s *Server) teamLeave(w http.ResponseWriter, r *http.Request) error {
	id, err := s.svc.EventID(r.Context(), r.PathValue("event"))
	if err != nil {
		return err
	}
	if err := s.svc.LeaveTeam(r.Context(), actorOf(r), id); err != nil {
		return err
	}
	return redirect(w, r, "/events/"+r.PathValue("event"), "left")
}

func (s *Server) teamRotate(w http.ResponseWriter, r *http.Request) error {
	id, err := s.svc.EventID(r.Context(), r.PathValue("event"))
	if err != nil {
		return err
	}
	if _, err := s.svc.RotateInvite(r.Context(), actorOf(r), id); err != nil {
		return err
	}
	return redirect(w, r, "/events/"+r.PathValue("event")+"/team", "saved")
}

func (s *Server) submissionSave(w http.ResponseWriter, r *http.Request) error {
	a := actorOf(r)
	ev := r.PathValue("event")
	f := r.PostForm
	in := core.ProjectInput{Title: f.Get("title"), Summary: f.Get("summary"), Description: f.Get("description"),
		RepoURL: f.Get("repo_url"), DemoURL: f.Get("demo_url"), TrackID: f.Get("track_id"), Submit: f.Get("action") == "submit"}
	var err error
	if pid := f.Get("project_id"); pid != "" {
		_, err = s.svc.UpdateProject(r.Context(), a, pid, in)
	} else {
		_, err = s.svc.CreateProject(r.Context(), a, ev, in)
	}
	if err != nil {
		if core.ErrorKind(err) == core.KindInvalid {
			// Re-show the form with what they typed.
			e, _ := s.svc.Event(r.Context(), a, ev)
			t, _ := s.svc.MyTeam(r.Context(), a, ev)
			w.WriteHeader(http.StatusBadRequest)
			data := map[string]any{"Title": "Your team", "Event": e, "Team": t, "Error": err.Error(), "Draft": in,
				"SubmissionsOpen": e != nil && e.SubmissionsOpen(s.now()), "Roles": s.roleFlags(r, ev)}
			if t != nil {
				data["InviteURL"] = s.absURL(r, "/join/"+t.InviteToken)
			}
			s.render(w, r, "team", data)
			return nil
		}
		return err
	}
	msg := "saved"
	if in.Submit {
		msg = "submitted"
	}
	return redirect(w, r, "/events/"+ev+"/team", msg)
}

func (s *Server) joinPage(w http.ResponseWriter, r *http.Request) error {
	t, e, err := s.svc.TeamByInvite(r.Context(), r.PathValue("token"))
	if err != nil {
		return err
	}
	s.render(w, r, "join", map[string]any{"Title": "Join " + t.Name, "Team": t, "Event": e, "Token": r.PathValue("token")})
	return nil
}

func (s *Server) joinPost(w http.ResponseWriter, r *http.Request) error {
	t, err := s.svc.JoinTeam(r.Context(), actorOf(r), r.PathValue("token"))
	if err != nil {
		return err
	}
	return redirect(w, r, "/events/"+t.EventID+"/team", "joined")
}

func (s *Server) certificatePage(w http.ResponseWriter, r *http.Request) error {
	rec, payload, err := s.svc.ParticipantRecord(r.Context(), actorOf(r), r.PathValue("event"))
	if err != nil {
		return err
	}
	return s.renderRecord(w, r, rec, payload)
}

func (s *Server) judgeRecordPage(w http.ResponseWriter, r *http.Request) error {
	rec, payload, err := s.svc.JudgeRecord(r.Context(), actorOf(r), r.PathValue("event"))
	if err != nil {
		return err
	}
	return s.renderRecord(w, r, rec, payload)
}

func (s *Server) renderRecord(w http.ResponseWriter, r *http.Request, rec *core.SignedRecord, p *core.RecordPayload) error {
	blob, _ := json.MarshalIndent(rec, "", "  ")
	s.render(w, r, "record", map[string]any{"Title": "Certificate", "Record": rec, "Payload": p, "JSON": string(blob),
		"KeyID": s.svc.SigningKey().KeyID})
	return nil
}

// ---------------------------------------------------------------------------
// Judge

func (s *Server) invitePage(w http.ResponseWriter, r *http.Request) error {
	inv, e, err := s.svc.InvitationInfo(r.Context(), r.PathValue("token"))
	if err != nil {
		return err
	}
	s.render(w, r, "invite", map[string]any{"Title": "Invitation", "Invitation": inv, "Event": e, "Token": r.PathValue("token")})
	return nil
}

func (s *Server) invitePost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.svc.AcceptInvitation(r.Context(), actorOf(r), r.PathValue("token"))
	if err != nil {
		return err
	}
	return redirect(w, r, "/events/"+e.Slug, "welcome")
}

func (s *Server) judgeHome(w http.ResponseWriter, r *http.Request) error {
	a := actorOf(r)
	if !a.LoggedIn() {
		return core.ErrUnauthenticated
	}
	as, err := s.svc.MyAssignments(r.Context(), a, "")
	if err != nil {
		return err
	}
	type group struct {
		EventID, EventName, EventSlug string
		Pending, Done                 []core.Assignment
		JudgingOpen, Published        bool
	}
	var groups []*group
	byEvent := map[string]*group{}
	for _, x := range as {
		g := byEvent[x.EventID]
		if g == nil {
			g = &group{EventID: x.EventID, EventName: x.EventName, EventSlug: x.EventSlug}
			if e, err := s.svc.Event(r.Context(), a, x.EventID); err == nil {
				g.JudgingOpen, g.Published = e.JudgingOpen(s.now()), e.Published()
			}
			byEvent[x.EventID] = g
			groups = append(groups, g)
		}
		if x.Status == "done" {
			g.Done = append(g.Done, x)
		} else {
			g.Pending = append(g.Pending, x)
		}
	}
	s.render(w, r, "judge_home", map[string]any{"Title": "Judging", "Groups": groups})
	return nil
}

func (s *Server) reviewPage(w http.ResponseWriter, r *http.Request) error {
	a := actorOf(r)
	e, err := s.svc.Event(r.Context(), a, r.PathValue("event"))
	if err != nil {
		return err
	}
	as, err := s.svc.MyAssignments(r.Context(), a, e.ID)
	if err != nil {
		return err
	}
	var cur *core.Assignment
	var next string
	for i := range as {
		if as[i].Project.ID == r.PathValue("project") {
			cur = &as[i]
		} else if as[i].Status == "pending" && next == "" {
			next = as[i].Project.ID
		}
	}
	if cur == nil {
		return &core.Error{Kind: core.KindForbidden, Code: "forbidden", Message: "this project is not assigned to you"}
	}
	done := 0
	for _, x := range as {
		if x.Status == "done" {
			done++
		}
	}
	s.render(w, r, "review", map[string]any{"Title": "Review " + cur.Project.Title, "Event": e, "A": cur, "Next": next,
		"Done": done, "Total": len(as), "JudgingOpen": e.JudgingOpen(s.now())})
	return nil
}

func (s *Server) reviewPost(w http.ResponseWriter, r *http.Request) error {
	a := actorOf(r)
	e, err := s.svc.Event(r.Context(), a, r.PathValue("event"))
	if err != nil {
		return err
	}
	scores := map[string]int{}
	for _, c := range e.Criteria {
		v, err := strconv.Atoi(r.PostFormValue("c_" + c.Key))
		if err != nil {
			return &core.Error{Kind: core.KindInvalid, Code: "missing_score", Message: "score every criterion (" + c.Name + " is missing)"}
		}
		scores[c.Key] = v
	}
	if _, err := s.svc.SubmitReview(r.Context(), a, e.ID, r.PathValue("project"), scores, r.PostFormValue("comment")); err != nil {
		return err
	}
	if next := r.PostFormValue("next"); next != "" {
		return redirect(w, r, "/judge/"+e.Slug+"/p/"+url.PathEscape(next), "reviewed")
	}
	return redirect(w, r, "/judge", "reviewed")
}

func (s *Server) recusePost(w http.ResponseWriter, r *http.Request) error {
	id, err := s.svc.EventID(r.Context(), r.PathValue("event"))
	if err != nil {
		return err
	}
	if err := s.svc.Recuse(r.Context(), actorOf(r), id, r.PathValue("project"), r.PostFormValue("reason")); err != nil {
		return err
	}
	return redirect(w, r, "/judge", "recused")
}

func (s *Server) pairwisePage(w http.ResponseWriter, r *http.Request) error {
	a := actorOf(r)
	e, err := s.svc.Event(r.Context(), a, r.PathValue("event"))
	if err != nil {
		return err
	}
	offer, err := s.svc.NextPair(r.Context(), a, e.ID)
	if err != nil {
		return err
	}
	s.render(w, r, "pairwise", map[string]any{"Title": "Compare", "Event": e, "Offer": offer})
	return nil
}

func (s *Server) pairwisePost(w http.ResponseWriter, r *http.Request) error {
	ev := r.PathValue("event")
	f := r.PostForm
	if err := s.svc.SubmitComparison(r.Context(), actorOf(r), ev, f.Get("a"), f.Get("b"), f.Get("outcome")); err != nil {
		return err
	}
	return redirect(w, r, "/judge/"+ev+"/pairwise", "compared")
}

// ---------------------------------------------------------------------------
// Organizer

func (s *Server) newEventPage(w http.ResponseWriter, r *http.Request) error {
	if !s.svc.CanCreateEvents(actorOf(r)) {
		if !actorOf(r).LoggedIn() {
			return core.ErrUnauthenticated
		}
		return &core.Error{Kind: core.KindForbidden, Code: "forbidden", Message: "only admins can create events"}
	}
	now := s.now().Truncate(time.Hour)
	s.render(w, r, "event_new", map[string]any{"Title": "New event",
		"Open": now.Format("2006-01-02T15:04"), "Close": now.Add(72 * time.Hour).Format("2006-01-02T15:04")})
	return nil
}

func formTime(v string) (*time.Time, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02T15:04", v)
	if err != nil {
		if t, err = store.ParseTime(v); err != nil {
			return nil, &core.Error{Kind: core.KindInvalid, Code: "invalid_dates", Message: "dates must look like 2026-09-28T18:00 (UTC)"}
		}
	}
	t = t.UTC()
	return &t, nil
}

func eventInputFromForm(f url.Values) (core.EventInput, error) {
	in := core.EventInput{Name: f.Get("name"), Slug: f.Get("slug"), Description: f.Get("description")}
	var err error
	var open, close *time.Time
	if open, err = formTime(f.Get("submissions_open_at")); err != nil {
		return in, err
	}
	if close, err = formTime(f.Get("submissions_close_at")); err != nil {
		return in, err
	}
	if open != nil {
		in.SubmissionsOpenAt = *open
	}
	if close != nil {
		in.SubmissionsCloseAt = *close
	}
	if in.JudgingCloseAt, err = formTime(f.Get("judging_close_at")); err != nil {
		return in, err
	}
	if in.VotingOpenAt, err = formTime(f.Get("voting_open_at")); err != nil {
		return in, err
	}
	if in.VotingCloseAt, err = formTime(f.Get("voting_close_at")); err != nil {
		return in, err
	}
	in.ReviewsPerProject, _ = strconv.Atoi(f.Get("reviews_per_project"))
	in.MaxTeamSize, _ = strconv.Atoi(f.Get("max_team_size"))
	in.VotesPerVoter, _ = strconv.Atoi(f.Get("votes_per_voter"))
	public := f.Get("is_public") != ""
	in.IsPublic = &public
	for _, line := range strings.Split(f.Get("tracks"), "\n") {
		if t := strings.TrimSpace(line); t != "" {
			in.Tracks = append(in.Tracks, t)
		}
	}
	for _, line := range strings.Split(f.Get("criteria"), "\n") {
		if c := strings.TrimSpace(line); c != "" {
			in.Criteria = append(in.Criteria, c)
		}
	}
	return in, nil
}

func (s *Server) newEventPost(w http.ResponseWriter, r *http.Request) error {
	in, err := eventInputFromForm(r.PostForm)
	if err == nil {
		var e *core.Event
		if e, err = s.svc.CreateEvent(r.Context(), actorOf(r), in); err == nil {
			return redirect(w, r, "/organize/"+e.Slug+"/settings", "created")
		}
	}
	if k := core.ErrorKind(err); k == core.KindInvalid || k == core.KindConflict {
		w.WriteHeader(statusFor(err))
		s.render(w, r, "event_new", map[string]any{"Title": "New event", "Error": err.Error(), "Form": r.PostForm,
			"Open": r.PostFormValue("submissions_open_at"), "Close": r.PostFormValue("submissions_close_at")})
		return nil
	}
	return err
}

func (s *Server) orgEvent(r *http.Request) (*core.Event, error) {
	a := actorOf(r)
	if !a.LoggedIn() {
		return nil, core.ErrUnauthenticated
	}
	e, err := s.svc.Event(r.Context(), a, r.PathValue("event"))
	if err != nil {
		return nil, err
	}
	if !s.roleFlags(r, e.ID)["organizer"] {
		return nil, &core.Error{Kind: core.KindForbidden, Code: "forbidden", Message: "organizers only"}
	}
	return e, nil
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	a := actorOf(r)
	prog, err := s.svc.Progress(r.Context(), a, e.ID)
	if err != nil {
		return err
	}
	judges, err := s.svc.Judges(r.Context(), a, e.ID)
	if err != nil {
		return err
	}
	trackNames := map[string]string{}
	for _, t := range e.Tracks {
		trackNames[t.ID] = t.Name
	}
	type jrow struct {
		core.JudgeSummary
		TrackNames []string
		CanLogin   bool
	}
	var rows []jrow
	for _, j := range judges {
		var names []string
		for _, t := range j.Tracks {
			names = append(names, trackNames[t])
		}
		u, _ := s.svc.UserByID(r.Context(), j.User.ID)
		rows = append(rows, jrow{j, names, u != nil && u.CanLogin})
	}
	hist := []map[string]int{}
	maxN := 0
	for n := range prog.ReviewHistogram {
		maxN = max(maxN, n)
	}
	for n := 0; n <= maxN; n++ {
		hist = append(hist, map[string]int{"Reviews": n, "Projects": prog.ReviewHistogram[n]})
	}
	data := map[string]any{"Title": "Dashboard · " + e.Name, "Event": e, "P": prog, "Judges": rows, "Hist": hist,
		"Phase": e.Phase(s.now())}
	if link := r.URL.Query().Get("invite"); link != "" {
		data["InviteLink"] = s.absURL(r, "/invite/"+link)
	}
	if link := r.URL.Query().Get("activation"); link != "" {
		data["ActivationLink"] = s.absURL(r, "/activate/"+link)
	}
	if as := r.URL.Query().Get("assigned"); as != "" {
		data["AssignSummary"] = as
	}
	s.render(w, r, "dashboard", data)
	return nil
}

func (s *Server) assignPost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	rep, err := s.svc.RunAssignment(r.Context(), actorOf(r), e.ID)
	if err != nil {
		return err
	}
	summary := strconv.Itoa(len(rep.New)) + " new assignments; judge load " + strconv.Itoa(rep.LoadMin) + "–" +
		strconv.Itoa(rep.LoadMax) + "; " + strconv.Itoa(rep.Components) + " connected group(s)"
	if len(rep.Underfilled) > 0 {
		summary += "; " + strconv.Itoa(len(rep.Underfilled)) + " project(s) could not be filled (invite more judges)"
	}
	if rep.OffTrack > 0 {
		summary += "; " + strconv.Itoa(rep.OffTrack) + " outside judges' tracks"
	}
	return redirect(w, r, "/organize/"+e.Slug+"?assigned="+url.QueryEscape(summary), "assigned")
}

// The raw invite token travels in the redirect URL once, to the organizer who
// created it; it is never stored in clear and never shown again.
func (s *Server) invitePostOrg(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	inv, err := s.svc.Invite(r.Context(), actorOf(r), e.ID, r.PostFormValue("email"), core.Role(r.PostFormValue("role")))
	if err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"?invite="+inv.Token+"#judges", "")
}

func (s *Server) activationPostOrg(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	tok, err := s.svc.ActivationLink(r.Context(), actorOf(r), e.ID, r.PostFormValue("user"))
	if err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"?activation="+tok+"#judges", "")
}

func (s *Server) settingsPage(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	projects, err := s.svc.EventProjects(r.Context(), actorOf(r), e.ID)
	if err != nil {
		return err
	}
	teams := map[string]string{}
	for _, p := range projects {
		teams[p.TeamID] = p.TeamName
	}
	var teamList [][2]string
	for id, name := range teams {
		teamList = append(teamList, [2]string{id, name})
	}
	sort.Slice(teamList, func(i, j int) bool { return teamList[i][1] < teamList[j][1] })
	hooks, err := s.svc.Webhooks(r.Context(), actorOf(r), e.ID)
	if err != nil {
		return err
	}
	deliveries, err := s.svc.Deliveries(r.Context(), actorOf(r), e.ID)
	if err != nil {
		return err
	}
	data := map[string]any{"Title": "Settings · " + e.Name, "Event": e, "Teams": teamList, "Hooks": hooks,
		"Deliveries": deliveries, "Topics": core.HookTopics}
	if sec := r.URL.Query().Get("secret"); sec != "" {
		data["NewSecret"] = sec
	}
	s.render(w, r, "settings", data)
	return nil
}

func (s *Server) settingsPost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	in, err := eventInputFromForm(r.PostForm)
	if err != nil {
		return err
	}
	updated, err := s.svc.UpdateEvent(r.Context(), actorOf(r), e.ID, in)
	if err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+updated.Slug+"/settings", "saved")
}

func (s *Server) trackPost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	if _, err := s.svc.AddTrack(r.Context(), actorOf(r), e.ID, r.PostFormValue("name"), r.PostFormValue("description")); err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"/settings#tracks", "saved")
}

func (s *Server) prizePost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	f := r.PostForm
	if _, err := s.svc.AddPrize(r.Context(), actorOf(r), e.ID, core.Prize{Name: f.Get("name"), Description: f.Get("description"),
		Value: f.Get("value"), TrackID: f.Get("track_id")}); err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"/settings#prizes", "saved")
}

func (s *Server) criteriaPost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	f := r.PostForm
	if name := strings.TrimSpace(f.Get("new_name")); name != "" {
		w8, _ := strconv.ParseFloat(f.Get("new_weight"), 64)
		if _, err := s.svc.AddCriterion(r.Context(), actorOf(r), e.ID, core.Criterion{Name: name, Weight: w8}); err != nil {
			return err
		}
	}
	weights := map[string]float64{}
	for _, c := range e.Criteria {
		if v := f.Get("w_" + c.ID); v != "" {
			w8, err := strconv.ParseFloat(v, 64)
			if err != nil {
				return &core.Error{Kind: core.KindInvalid, Code: "invalid_weight", Message: "weights must be numbers"}
			}
			if w8 != c.Weight {
				weights[c.ID] = w8
			}
		}
	}
	if len(weights) > 0 {
		if err := s.svc.SetCriterionWeights(r.Context(), actorOf(r), e.ID, weights); err != nil {
			return err
		}
	}
	return redirect(w, r, "/organize/"+e.Slug+"/settings#rubric", "saved")
}

func (s *Server) extensionPost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	minutes, _ := strconv.Atoi(r.PostFormValue("minutes"))
	if err := s.svc.GrantExtension(r.Context(), actorOf(r), e.ID, r.PostFormValue("team_id"), minutes, r.PostFormValue("reason")); err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"/settings#extensions", "extended")
}

func (s *Server) webhookPost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	if del := r.PostFormValue("delete"); del != "" {
		if err := s.svc.DeleteWebhook(r.Context(), actorOf(r), e.ID, del); err != nil {
			return err
		}
		return redirect(w, r, "/organize/"+e.Slug+"/settings#webhooks", "saved")
	}
	h, err := s.svc.CreateWebhook(r.Context(), actorOf(r), e.ID, r.PostFormValue("url"), r.PostForm["topics"])
	if err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"/settings?secret="+h.Secret+"#webhooks", "created")
}

func (s *Server) orgResults(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	res, err := s.svc.Results(r.Context(), actorOf(r), e.ID, 300)
	if err != nil {
		return err
	}
	methodNames := map[string]string{
		judging.MethodRaw: "Raw mean", judging.MethodZScore: "Z-score", judging.MethodBias: "Bias only",
		judging.MethodBiasScale: "Bias + scale", judging.MethodPairwise: "Induced pairwise",
	}
	var agreement []map[string]any
	for _, m := range res.Report.Methods {
		agreement = append(agreement, map[string]any{"Name": methodNames[m], "Tau": res.Report.Agreement[m]})
	}
	moved := 0
	for _, row := range res.Rows {
		if row.RankChange != 0 {
			moved++
		}
	}
	s.render(w, r, "org_results", map[string]any{"Title": "Results · " + e.Name, "Event": e, "Res": res,
		"Agreement": agreement, "Moved": moved, "VotingOpen": e.VotingOpen(s.now())})
	return nil
}

func (s *Server) publishPost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	publish := r.PostFormValue("publish") == "1"
	if err := s.svc.Publish(r.Context(), actorOf(r), e.ID, publish); err != nil {
		return err
	}
	msg := "published"
	if !publish {
		msg = "unpublished"
	}
	return redirect(w, r, "/organize/"+e.Slug+"/results", msg)
}

func (s *Server) moderationPage(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	a := actorOf(r)
	dups, err := s.svc.DuplicateCandidates(r.Context(), a, e.ID)
	if err != nil {
		return err
	}
	projects, err := s.svc.EventProjects(r.Context(), a, e.ID)
	if err != nil {
		return err
	}
	var flaggedProjects []*core.Project
	for _, p := range projects {
		if p.DuplicateOf != "" || p.DisqualifiedReason != "" {
			flaggedProjects = append(flaggedProjects, p)
		}
	}
	votes, err := s.svc.FlaggedVotes(r.Context(), a, e.ID)
	if err != nil {
		return err
	}
	var comments []core.Comment
	for _, p := range projects {
		cs, err := s.svc.Comments(r.Context(), a, p.ID)
		if err != nil {
			return err
		}
		comments = append(comments, cs...)
	}
	sort.Slice(comments, func(i, j int) bool { return comments[i].CreatedAt.After(comments[j].CreatedAt) })
	if len(comments) > 100 {
		comments = comments[:100]
	}
	s.render(w, r, "moderation", map[string]any{"Title": "Moderation · " + e.Name, "Event": e, "Dups": dups,
		"Flagged": flaggedProjects, "Votes": votes, "Comments": comments, "Projects": projects})
	return nil
}

func (s *Server) duplicatePost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	f := r.PostForm
	switch f.Get("action") {
	case "disqualify":
		err = s.svc.Disqualify(r.Context(), actorOf(r), f.Get("project"), f.Get("reason"))
	case "reinstate":
		if err = s.svc.Disqualify(r.Context(), actorOf(r), f.Get("project"), ""); err == nil {
			err = s.svc.MarkDuplicate(r.Context(), actorOf(r), f.Get("project"), "")
		}
	default:
		err = s.svc.MarkDuplicate(r.Context(), actorOf(r), f.Get("project"), f.Get("of"))
	}
	if err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"/moderation", "marked")
}

func (s *Server) voteReviewPost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	f := r.PostForm
	if err := s.svc.ReviewVote(r.Context(), actorOf(r), e.ID, f.Get("user"), f.Get("project"), f.Get("approve") == "1"); err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"/moderation#votes", "moderated")
}

func (s *Server) commentModeratePost(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	if err := s.svc.HideComment(r.Context(), actorOf(r), r.PathValue("id"), r.PostFormValue("hide") == "1"); err != nil {
		return err
	}
	return redirect(w, r, "/organize/"+e.Slug+"/moderation#comments", "moderated")
}

func (s *Server) auditPage(w http.ResponseWriter, r *http.Request) error {
	e, err := s.orgEvent(r)
	if err != nil {
		return err
	}
	entries, v, err := s.svc.AuditLog(r.Context(), actorOf(r), e.ID, 500)
	if err != nil {
		return err
	}
	var ids []string
	for _, x := range entries {
		ids = append(ids, x.ActorID)
	}
	type row struct {
		store.AuditEntry
		Actor   string
		Summary string
	}
	names := s.svc.UserNames(r.Context(), ids)
	var rows []row
	filter := r.URL.Query().Get("action")
	for _, x := range entries {
		if filter != "" && !strings.HasPrefix(x.Action, filter) {
			continue
		}
		b, _ := json.Marshal(x.Detail)
		name := names[x.ActorID]
		if name == "" {
			name = "system"
		}
		rows = append(rows, row{x, name, string(b)})
	}
	s.render(w, r, "audit", map[string]any{"Title": "Audit · " + e.Name, "Event": e, "Rows": rows, "V": v, "Filter": filter})
	return nil
}

// ---------------------------------------------------------------------------
// Public utilities

func (s *Server) verifyPage(w http.ResponseWriter, r *http.Request) error {
	data := map[string]any{"Title": "Verify a record", "KeyID": s.svc.SigningKey().KeyID,
		"PublicKey": base64.StdEncoding.EncodeToString(s.svc.SigningKey().Pub)}
	if r.Method == http.MethodPost {
		raw := r.PostFormValue("record")
		data["Raw"] = raw
		var rec core.SignedRecord
		if err := json.Unmarshal([]byte(raw), &rec); err != nil {
			data["Error"] = "That is not a record: paste the JSON exactly as issued."
		} else if p, err := core.VerifyRecord(s.svc.SigningKey().Pub, rec); err != nil {
			var e *core.Error
			if errors.As(err, &e) {
				data["Error"] = e.Message
			} else {
				data["Error"] = err.Error()
			}
		} else {
			data["Valid"] = p
		}
	}
	s.render(w, r, "verify", data)
	return nil
}

func (s *Server) embedPage(w http.ResponseWriter, r *http.Request) error {
	e, err := s.svc.Event(r.Context(), actorOf(r), r.PathValue("event"))
	if err != nil {
		return err
	}
	page, err := s.svc.Gallery(r.Context(), core.GalleryFilter{EventID: e.ID, Query: r.URL.Query().Get("q"), TrackID: r.URL.Query().Get("track")})
	if err != nil {
		return err
	}
	s.render(w, r, "embed", map[string]any{"Bare": true, "Event": e, "Page": page, "Base": s.absURL(r, "")})
	return nil
}
