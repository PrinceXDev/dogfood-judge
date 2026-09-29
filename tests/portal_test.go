package tests

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"dogfood/src/core"
)

// The seven checks from run.py, reproduced so `go test` fails before the
// acceptance report would.
func TestAcceptanceChecks(t *testing.T) {
	p := newPortal(t)
	// The HTML gallery is served by the Next.js frontend; this checks the API it renders from.
	r := p.api("GET", "/api/v1/projects", "", nil)
	if r.Status != 200 || !contains(r.Body, "Glass Signal") {
		t.Fatalf("gallery: %d, has fixture title: %v", r.Status, contains(r.Body, "Glass Signal"))
	}
	r = p.api("POST", "/api/v1/events/evt_01/projects", partToken, map[string]string{"title": "late", "summary": "probe"})
	if r.Status != 403 || !contains(r.Body, "submissions_closed") {
		t.Fatalf("late submission should be refused as late, got %d %s", r.Status, r.Body)
	}
	p.must(p.api("GET", "/api/v1/judge/scores", judgeA, nil), 200)
	p.must(p.api("GET", "/api/v1/judge/scores?judge=jdg_26", judgeB, nil), 403)
	p.must(p.api("GET", "/api/v1/judge/scores", partToken, nil), 403)
	r = p.must(p.api("GET", "/api/v1/events/evt_01/export/scores.csv", orgToken, nil), 200)
	if first := strings.SplitN(r.Body, "\n", 2)[0]; !strings.Contains(first, ",") {
		t.Fatalf("csv first line %q", first)
	}
}

// Every sensitive endpoint, every role. The point is breadth: a new route that
// forgets its check shows up here as an unexpected 200.
func TestAuthorizationMatrix(t *testing.T) {
	p := newPortal(t)
	const (
		anon = ""
	)
	cases := []struct {
		method, path string
		token        string
		want         int
	}{
		{"GET", "/api/v1/judge/scores", anon, 401},
		{"GET", "/api/v1/judge/scores", partToken, 403},
		{"GET", "/api/v1/judge/scores", judgeA, 200},
		{"GET", "/api/v1/judge/scores?judge=jdg_26", judgeB, 403},
		{"GET", "/api/v1/judge/scores?judge=jdg_24", judgeA, 403},
		{"GET", "/api/v1/judge/scores?judge=jdg_26", partToken, 403},
		{"GET", "/api/v1/judge/scores?judge=jdg_26", orgToken, 200},
		{"GET", "/api/v1/events/evt_01/reviews", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/reviews", partToken, 403},
		{"GET", "/api/v1/events/evt_01/reviews", orgToken, 200},
		{"GET", "/api/v1/events/evt_01/results", anon, 401},
		{"GET", "/api/v1/events/evt_01/results", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/results", partToken, 403},
		{"GET", "/api/v1/events/evt_01/progress", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/progress", orgToken, 200},
		{"GET", "/api/v1/events/evt_01/export/scores.csv", anon, 401},
		{"GET", "/api/v1/events/evt_01/export/scores.csv", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/export/scores.csv", partToken, 403},
		{"GET", "/api/v1/events/evt_01/export/results.csv", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/export.json", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/audit", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/audit", orgToken, 200},
		{"GET", "/api/v1/events/evt_01/judges", partToken, 403},
		{"GET", "/api/v1/events/evt_01/votes/flagged", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/webhooks", judgeA, 403},
		{"GET", "/api/v1/auth/providers", anon, 200},
		{"GET", "/api/v1/events/evt_01/assignments", anon, 401},
		{"GET", "/api/v1/events/evt_01/assignments", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/assignments", partToken, 403},
		{"GET", "/api/v1/events/evt_01/assignments", orgToken, 200},
		{"POST", "/api/v1/events/evt_01/assignments/run", judgeA, 403},
		{"POST", "/api/v1/events/evt_01/publish", judgeA, 403},
		{"POST", "/api/v1/events/evt_01/publish", partToken, 403},
		{"POST", "/api/v1/events/evt_01/invitations", judgeA, 403},
		{"PUT", "/api/v1/events/evt_01/criteria/weights", judgeA, 403},
		{"PATCH", "/api/v1/events/evt_01", partToken, 403},
		{"POST", "/api/v1/events", orgToken, 403}, // only admins create events
		{"POST", "/api/v1/import", orgToken, 403},
		{"PUT", "/api/v1/events/evt_01/reviews/prj_01", partToken, 403},
		{"PUT", "/api/v1/events/evt_01/reviews/prj_01", judgeA, 403}, // not assigned to jdg_26
		{"POST", "/api/v1/projects/prj_07/duplicate", judgeA, 403},
		{"GET", "/api/v1/events/evt_01/pairwise/next", partToken, 403},
		{"GET", "/api/v1/projects", anon, 200},
		{"GET", "/api/v1/events/evt_01/projects", anon, 200},
	}
	for _, c := range cases {
		var body any
		if c.method != "GET" {
			body = map[string]any{}
		}
		if r := p.api(c.method, c.path, c.token, body); r.Status != c.want {
			who := c.token
			if who == "" {
				who = "anonymous"
			}
			t.Errorf("%s %s as %s: got %d, want %d (%s)", c.method, c.path, who, r.Status, c.want, strings.TrimSpace(r.Body))
		}
	}
}

// A judge's own-score response never contains another judge's review, even
// when asked by query parameter for the event.
func TestJudgeScoresNeverLeakPeers(t *testing.T) {
	p := newPortal(t)
	var out struct{ Scores []core.Review }
	p.must(p.api("GET", "/api/v1/judge/scores?event=evt_01", judgeA, nil), 200).JSON(t, &out)
	if len(out.Scores) == 0 {
		t.Fatal("expected judge_a's own reviews")
	}
	for _, s := range out.Scores {
		if s.JudgeID != "jdg_26" {
			t.Fatalf("leaked review by %s", s.JudgeID)
		}
	}
}

func TestDeadlineEnforcedByDatabase(t *testing.T) {
	p := newPortal(t)
	// Bypass the service layer entirely: the trigger must still refuse.
	_, err := p.svc.DB.Exec(`UPDATE projects SET title = 'sneaky edit' WHERE id = 'prj_01'`)
	if err == nil || !strings.Contains(err.Error(), "submissions_closed") {
		t.Fatalf("raw UPDATE after the deadline should fail, got %v", err)
	}
	_, err = p.svc.DB.Exec(`INSERT INTO projects (id, event_id, team_id, title, status, created_at, updated_at)
		VALUES ('prj_late', 'evt_01', 'tm_02', 'late', 'draft', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	if err == nil || !strings.Contains(err.Error(), "submissions_closed") {
		t.Fatalf("raw INSERT after the deadline should fail, got %v", err)
	}
	// Organizer moderation columns are not participant edits and stay writable.
	if _, err := p.svc.DB.Exec(`UPDATE projects SET disqualified_reason = 'x' WHERE id = 'prj_02'`); err != nil {
		t.Fatalf("moderation update should be allowed: %v", err)
	}
}

func TestConflictOfInterestEnforcedByDatabase(t *testing.T) {
	p := newPortal(t)
	// sana7 participates in evt_01; making them a judge there must fail.
	_, err := p.svc.DB.Exec(`INSERT INTO event_roles (event_id, user_id, role)
		SELECT 'evt_01', id, 'judge' FROM users WHERE email = 'sana7@example.org'`)
	if err == nil || !strings.Contains(err.Error(), "conflict_of_interest") {
		t.Fatalf("expected conflict_of_interest, got %v", err)
	}
}

func TestSignupCannotClaimImportedAccount(t *testing.T) {
	p := newPortal(t)
	r := p.api("POST", "/api/v1/auth/signup", "", map[string]string{"email": "wei.lindqvist@example.org", "name": "Imposter", "password": "correct horse battery"})
	if r.Status != 409 {
		t.Fatalf("claiming an imported judge's email must fail, got %d %s", r.Status, r.Body)
	}
}

func TestCSRFRequiredForCookieAuthenticatedWrites(t *testing.T) {
	p := newPortal(t)
	tok := p.login("sana7@example.org", "dogfood-demo")
	send := func(csrf string) int {
		req, _ := http.NewRequest("POST", p.srv.URL+"/api/v1/events/playground/teams", strings.NewReader(`{"name":"Cookie Team"}`))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "dogfood_session", Value: tok})
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	if got := send(""); got != 403 {
		t.Fatalf("cookie write without CSRF token: %d, want 403", got)
	}
	// Bearer requests are CSRF-immune; /me hands a cookie session its token.
	req, _ := http.NewRequest("GET", p.srv.URL+"/api/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: "dogfood_session", Value: tok})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var me struct {
		CSRF string `json:"csrf_token"`
	}
	json.NewDecoder(res.Body).Decode(&me)
	res.Body.Close()
	if got := send(me.CSRF); got != 201 {
		t.Fatalf("cookie write with CSRF token: %d, want 201", got)
	}
}

func TestFullLifecycle(t *testing.T) {
	p := newPortal(t)
	e := p.openEvent("lifecycle", nil)
	slug := "lifecycle"
	tools := trackID(e, 0)

	// Two teams, one via invite link.
	alice := p.signup("alice@test.local", "Alice")
	bob := p.signup("bob@test.local", "Bob")
	carol := p.signup("carol@test.local", "Carol")
	var team core.Team
	p.must(p.api("POST", "/api/v1/events/"+slug+"/teams", alice, map[string]string{"name": "Aces"}), 201).JSON(t, &team)
	p.must(p.api("POST", "/api/v1/teams/join", bob, map[string]string{"token": team.InviteToken}), 200)
	p.must(p.api("POST", "/api/v1/events/"+slug+"/teams", carol, map[string]string{"name": "Solo"}), 201)

	// Draft, edit, submit.
	var proj core.Project
	p.must(p.api("POST", "/api/v1/events/"+slug+"/projects", alice, map[string]any{"title": "Draft One"}), 201).JSON(t, &proj)
	if proj.Status != "draft" {
		t.Fatalf("expected draft, got %s", proj.Status)
	}
	p.must(p.api("PATCH", "/api/v1/projects/"+proj.ID, bob, map[string]any{"title": "Aces Tool", "summary": "it works", "track_id": tools, "submit": true}), 200).JSON(t, &proj)
	if proj.Status != "submitted" || proj.Title != "Aces Tool" {
		t.Fatalf("teammate edit+submit failed: %+v", proj)
	}
	// Drafts are private; submitted projects are public.
	p.must(p.api("POST", "/api/v1/events/"+slug+"/projects", carol, map[string]any{"title": "Carol Data", "track_id": trackID(e, 1), "submit": true, "repo_url": "https://example.org/c"}), 201)
	p.must(p.api("GET", "/api/v1/projects/"+proj.ID, "", nil), 200)
	// Outsiders cannot edit; a second project per team is refused.
	p.must(p.api("PATCH", "/api/v1/projects/"+proj.ID, carol, map[string]any{"title": "hijack"}), 403)
	p.must(p.api("POST", "/api/v1/events/"+slug+"/projects", alice, map[string]any{"title": "Another"}), 409)

	// Judges: invitation, acceptance, and the COI rule (a participant cannot judge).
	var inv struct {
		Invitation core.Invitation
		URL        string
	}
	p.must(p.api("POST", "/api/v1/events/"+slug+"/invitations", adminTok, map[string]string{"role": "judge"}), 201).JSON(t, &inv)
	p.must(p.api("POST", "/api/v1/invitations/"+inv.Invitation.Token+"/accept", alice, nil), 409)
	j1 := p.signup("judge1@test.local", "Judge One")
	j2 := p.signup("judge2@test.local", "Judge Two")
	for _, j := range []string{j1, j2} {
		p.must(p.api("POST", "/api/v1/events/"+slug+"/invitations", adminTok, map[string]string{"role": "judge"}), 201).JSON(t, &inv)
		p.must(p.api("POST", "/api/v1/invitations/"+inv.Invitation.Token+"/accept", j, nil), 200)
	}
	// Invitations are single use.
	p.must(p.api("POST", "/api/v1/invitations/"+inv.Invitation.Token+"/accept", carol, nil), 409)

	// Judging is closed while submissions are open.
	var rep struct{ New []any }
	p.must(p.api("POST", "/api/v1/events/"+slug+"/assignments/run", adminTok, nil), 200).JSON(t, &rep)
	if len(rep.New) != 4 {
		t.Fatalf("2 projects x 2 reviews = 4 assignments, got %d", len(rep.New))
	}
	scores := map[string]int{"functionality": 4, "quality": 3, "innovation": 5}
	p.must(p.api("PUT", "/api/v1/events/"+slug+"/reviews/"+proj.ID, j1, map[string]any{"scores": scores}), 403)

	// Close submissions: move the deadline into the past.
	now := time.Now().UTC()
	patch := map[string]any{"name": "Test lifecycle", "slug": slug,
		"submissions_open_at": now.Add(-3 * time.Hour).Format(time.RFC3339), "submissions_close_at": now.Add(-time.Minute).Format(time.RFC3339),
		"reviews_per_project": 2}
	p.must(p.api("PATCH", "/api/v1/events/"+slug, adminTok, patch), 200)
	p.must(p.api("PATCH", "/api/v1/projects/"+proj.ID, alice, map[string]any{"title": "too late"}), 403)

	// Reviews: validation, then success, then isolation.
	p.must(p.api("PUT", "/api/v1/events/"+slug+"/reviews/"+proj.ID, j1, map[string]any{"scores": map[string]int{"functionality": 9, "quality": 3, "innovation": 5}}), 400)
	p.must(p.api("PUT", "/api/v1/events/"+slug+"/reviews/"+proj.ID, j1, map[string]any{"scores": map[string]int{"functionality": 4}}), 400)
	p.must(p.api("PUT", "/api/v1/events/"+slug+"/reviews/"+proj.ID, j1, map[string]any{"scores": scores, "comment": "nice"}), 200)
	var j1scores struct{ Scores []core.Review }
	p.must(p.api("GET", "/api/v1/judge/scores?event="+slug, j2, nil), 200).JSON(t, &j1scores)
	if len(j1scores.Scores) != 0 {
		t.Fatalf("judge 2 saw %d reviews before writing any", len(j1scores.Scores))
	}

	// Pairwise: the server offers a pair and only accepts a verdict on it.
	var offer core.PairOffer
	p.must(p.api("GET", "/api/v1/events/"+slug+"/pairwise/next", j2, nil), 200).JSON(t, &offer)
	if offer.A == nil || offer.B == nil {
		t.Fatal("expected a pair")
	}
	p.must(p.api("POST", "/api/v1/events/"+slug+"/pairwise", j2, map[string]string{"a": offer.B.ID, "b": offer.A.ID, "outcome": "a"}), 409)
	p.must(p.api("POST", "/api/v1/events/"+slug+"/pairwise", j2, map[string]string{"a": offer.A.ID, "b": offer.B.ID, "outcome": "a"}), 204)
	if offer.Reason == "" || offer.PauseAfter != core.PauseAfter || offer.Streak != 0 {
		t.Fatalf("offer explains nothing or miscounts the streak: %+v", offer)
	}
	var next core.PairOffer
	p.must(p.api("GET", "/api/v1/events/"+slug+"/pairwise/next", j2, nil), 200).JSON(t, &next)
	if next.Streak != 1 || next.Done != 1 {
		t.Fatalf("after one comparison: streak %d, done %d", next.Streak, next.Done)
	}

	// Finish reviews, check progress, publish.
	var as []core.Assignment
	for _, j := range []string{j1, j2} {
		p.must(p.api("GET", "/api/v1/judge/assignments?event="+slug, j, nil), 200).JSON(t, &as)
		for _, a := range as {
			p.must(p.api("PUT", "/api/v1/events/"+slug+"/reviews/"+a.Project.ID, j, map[string]any{"scores": scores}), 200)
		}
	}
	var prog core.Progress
	p.must(p.api("GET", "/api/v1/events/"+slug+"/progress", adminTok, nil), 200).JSON(t, &prog)
	if prog.Done != 4 || prog.Percent != 100 || prog.Comparisons != 1 {
		t.Fatalf("progress %+v", prog)
	}
	p.must(p.api("GET", "/api/v1/events/"+slug+"/results", alice, nil), 403)
	p.must(p.api("POST", "/api/v1/events/"+slug+"/publish", adminTok, map[string]bool{"published": true}), 204)
	var res core.Results
	p.must(p.api("GET", "/api/v1/events/"+slug+"/results", alice, nil), 200).JSON(t, &res)
	if len(res.Rows) != 2 || len(res.Judges) != 0 {
		t.Fatalf("public results: %d rows, %d judge rows (judge diagnostics must stay private)", len(res.Rows), len(res.Judges))
	}
	// Judging closes on publication.
	p.must(p.api("PUT", "/api/v1/events/"+slug+"/reviews/"+proj.ID, j1, map[string]any{"scores": scores}), 403)

	// Signed judge record verifies; a tampered one does not.
	var rec struct {
		Record  core.SignedRecord
		Payload core.RecordPayload
	}
	p.must(p.api("GET", "/api/v1/events/"+slug+"/records/judge", j1, nil), 200).JSON(t, &rec)
	if rec.Payload.Reviews != 2 {
		t.Fatalf("record says %d reviews", rec.Payload.Reviews)
	}
	var key struct {
		PublicKey string `json:"public_key"`
	}
	p.must(p.api("GET", "/.well-known/dogfood-signing-key", "", nil), 200).JSON(t, &key)
	pub, _ := base64.StdEncoding.DecodeString(key.PublicKey)
	if _, err := core.VerifyRecord(ed25519.PublicKey(pub), rec.Record); err != nil {
		t.Fatalf("record should verify offline: %v", err)
	}
	body, _ := base64.StdEncoding.DecodeString(rec.Record.Payload)
	forged := rec.Record
	forged.Payload = base64.StdEncoding.EncodeToString([]byte(strings.Replace(string(body), `"reviews_completed":2`, `"reviews_completed":20`, 1)))
	var v struct{ Valid bool }
	p.must(p.api("POST", "/api/v1/records/verify", "", forged), 200).JSON(t, &v)
	if v.Valid {
		t.Fatal("a forged record verified")
	}
	// Participant certificate.
	p.must(p.api("GET", "/api/v1/events/"+slug+"/records/participant", bob, nil), 200)

	// The audit trail recorded the story and its chain is intact.
	var audit struct {
		Verification struct{ OK bool }
		Entries      []struct{ Action string }
	}
	p.must(p.api("GET", "/api/v1/events/"+slug+"/audit", adminTok, nil), 200).JSON(t, &audit)
	seen := map[string]bool{}
	for _, e := range audit.Entries {
		seen[e.Action] = true
	}
	for _, want := range []string{"event.create", "team.create", "team.join", "project.create", "project.submit", "invitation.accept",
		"assignment.run", "review.submit", "pairwise.compare", "event.update", "results.publish"} {
		if !seen[want] {
			t.Errorf("audit log missing %s", want)
		}
	}
	if !audit.Verification.OK {
		t.Fatal("audit chain should verify")
	}
}

func TestAuditChainDetectsTampering(t *testing.T) {
	p := newPortal(t)
	// A determined operator can drop the append-only trigger; the chain still catches the edit.
	if _, err := p.svc.DB.Exec(`UPDATE audit_log SET detail = '{}' WHERE seq = 2`); err == nil {
		t.Fatal("append-only trigger should block updates")
	}
	p.svc.DB.Exec(`DROP TRIGGER audit_log_append_only_update`)
	if _, err := p.svc.DB.Exec(`UPDATE audit_log SET actor_id = 'someone-else' WHERE seq = 2`); err != nil {
		t.Fatal(err)
	}
	var audit struct {
		Verification struct {
			OK       bool
			BrokenAt int64 `json:"broken_at"`
		}
	}
	p.must(p.api("GET", "/api/v1/events/evt_01/audit", orgToken, nil), 200).JSON(t, &audit)
	if audit.Verification.OK || audit.Verification.BrokenAt != 2 {
		t.Fatalf("tampering not detected: %+v", audit.Verification)
	}
}

func TestVotingRulesAndHiddenResults(t *testing.T) {
	p := newPortal(t)
	// evt_01 is seeded with an open 48h voting window. Timestamps have second
	// precision, so let a second pass before creating "new" accounts.
	time.Sleep(1100 * time.Millisecond)
	voters := []string{p.signup("v1@test.local", "V1"), p.signup("v2@test.local", "V2")}
	// Accounts created after voting opened are held for review, not counted.
	p.must(p.api("POST", "/api/v1/projects/prj_01/vote", voters[0], nil), 204)
	var flagged []core.FlaggedVote
	p.must(p.api("GET", "/api/v1/events/evt_01/votes/flagged", orgToken, nil), 200).JSON(t, &flagged)
	if len(flagged) != 1 || !contains(flagged[0].Reason, "after voting opened") {
		t.Fatalf("expected the new account's vote to be held, got %+v", flagged)
	}
	// Established fixture accounts vote normally, within their budget.
	fixtureVoter := p.login("member5_1@example.org", "dogfood-demo")
	for _, prj := range []string{"prj_01", "prj_02", "prj_03"} {
		p.must(p.api("POST", "/api/v1/projects/"+prj+"/vote", fixtureVoter, nil), 204)
	}
	p.must(p.api("POST", "/api/v1/projects/prj_04/vote", fixtureVoter, nil), 409) // budget of 3
	p.must(p.api("POST", "/api/v1/projects/prj_01/vote", fixtureVoter, nil), 409) // no double vote
	// No voting for your own team (sana7 is on tm_07, which owns prj_07).
	p.must(p.api("POST", "/api/v1/projects/prj_07/vote", partToken, nil), 403)
	// Duplicates and excluded projects are not on the ballot.
	p.must(p.api("POST", "/api/v1/projects/prj_41/vote", partToken, nil), 400)

	// Results cannot be published while voting is open, and nobody but organizers sees tallies.
	p.must(p.api("POST", "/api/v1/events/evt_01/publish", orgToken, nil), 409)
	p.must(p.api("GET", "/api/v1/events/evt_01/results", fixtureVoter, nil), 403)

	// Ballots are shuffled per voter but stable for each voter.
	var b1, b1again, b2 core.Ballot
	p.must(p.api("GET", "/api/v1/events/evt_01/ballot", voters[0], nil), 200).JSON(t, &b1)
	p.must(p.api("GET", "/api/v1/events/evt_01/ballot", voters[0], nil), 200).JSON(t, &b1again)
	p.must(p.api("GET", "/api/v1/events/evt_01/ballot", voters[1], nil), 200).JSON(t, &b2)
	order := func(b core.Ballot) string {
		var ids []string
		for _, p := range b.Projects {
			ids = append(ids, p.ID)
		}
		return strings.Join(ids, ",")
	}
	if len(b1.Projects) != 40 {
		t.Fatalf("ballot should list 40 live projects, got %d", len(b1.Projects))
	}
	if order(b1) != order(b1again) {
		t.Fatal("ballot order changed on reload")
	}
	if order(b1) == order(b2) {
		t.Fatal("two voters got the same ballot order")
	}

	// Organizer approves the held vote; it then counts.
	p.must(p.api("POST", "/api/v1/events/evt_01/votes/review", orgToken, map[string]any{"user": flagged[0].UserID, "project": "prj_01", "approve": true}), 204)
	var res core.Results
	p.must(p.api("GET", "/api/v1/events/evt_01/results", orgToken, nil), 200).JSON(t, &res)
	for _, v := range res.Votes {
		if v.Project.ID == "prj_01" && v.Counted != 2 {
			t.Fatalf("prj_01 should have 2 counted votes, got %d", v.Counted)
		}
	}
}

func TestLoginRateLimited(t *testing.T) {
	p := newPortal(t)
	limited := false
	for i := 0; i < 15; i++ {
		r := p.api("POST", "/api/v1/auth/login", "", map[string]string{"email": "admin@dogfood.local", "password": "wrong password"})
		if r.Status == 429 {
			limited = true
			break
		}
		if r.Status != 401 {
			t.Fatalf("unexpected %d", r.Status)
		}
	}
	if !limited {
		t.Fatal("15 failed logins in a row were never rate limited")
	}
}

func TestCommentsAndModeration(t *testing.T) {
	p := newPortal(t)
	u := p.login("member5_1@example.org", "dogfood-demo")
	var c core.Comment
	p.must(p.api("POST", "/api/v1/projects/prj_02/comments", u, map[string]string{"body": "Lovely work"}), 201).JSON(t, &c)
	p.must(p.api("POST", "/api/v1/projects/prj_02/comments", u, map[string]string{"body": "Lovely work"}), 409) // double post
	p.must(p.api("POST", "/api/v1/comments/"+c.ID+"/hide", u, nil), 403)
	p.must(p.api("POST", "/api/v1/comments/"+c.ID+"/hide", orgToken, nil), 204)
	var cs []core.Comment
	p.must(p.api("GET", "/api/v1/projects/prj_02/comments", "", nil), 200).JSON(t, &cs)
	if len(cs) != 0 {
		t.Fatal("hidden comment still public")
	}
}

func TestCSVIsInjectionSafe(t *testing.T) {
	p := newPortal(t)
	e := p.openEvent("csv", nil)
	u := p.signup("mallory@test.local", "=HYPERLINK(\"http://evil\")")
	p.must(p.api("POST", "/api/v1/events/csv/teams", u, map[string]string{"name": "@evil"}), 201)
	p.must(p.api("POST", "/api/v1/events/csv/projects", u, map[string]any{"title": "=cmd|' /C calc'!A0", "track_id": trackID(e, 0), "submit": true}), 201)
	r := p.must(p.api("GET", "/api/v1/events/csv/export.json", adminTok, nil), 200)
	if !contains(r.Body, "=cmd") {
		t.Fatal("JSON export should keep the raw title")
	}
	r = p.must(p.api("GET", "/api/v1/events/csv/export/results.csv", adminTok, nil), 200)
	for _, line := range strings.Split(r.Body, "\n") {
		for _, cell := range strings.Split(line, ",") {
			if strings.HasPrefix(cell, "=") || strings.HasPrefix(cell, "@") {
				t.Fatalf("unescaped formula cell %q", cell)
			}
		}
	}
}

func TestImportExportRoundTrip(t *testing.T) {
	a := newPortal(t)
	r := a.must(a.api("GET", "/api/v1/events/evt_01/export.json", orgToken, nil), 200)
	var doc map[string]any
	r.JSON(t, &doc)
	ev := doc["event"].(map[string]any)
	ev["id"], ev["slug"] = "evt_copy", "copy"
	var resA, resB core.Results
	a.must(a.api("GET", "/api/v1/events/evt_01/results?bootstrap=50", orgToken, nil), 200).JSON(t, &resA)

	b := newPortal(t)
	b.must(b.api("POST", "/api/v1/import", adminTok, doc), 201)
	b.must(b.api("GET", "/api/v1/events/copy/results?bootstrap=50", adminTok, nil), 200).JSON(t, &resB)
	if len(resA.Rows) != len(resB.Rows) {
		t.Fatalf("rows %d vs %d", len(resA.Rows), len(resB.Rows))
	}
	for i := range resA.Rows {
		// Ids collide with the seeded copy and are remapped, so compare by title.
		if resA.Rows[i].Project.Title != resB.Rows[i].Project.Title {
			t.Fatalf("rank %d differs after round trip: %s vs %s", i+1, resA.Rows[i].Project.Title, resB.Rows[i].Project.Title)
		}
	}
}

func TestWebhookDeliveredAndSigned(t *testing.T) {
	p := newPortal(t)
	var mu sync.Mutex
	var got []*http.Request
	var bodies [][]byte
	recv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		got, bodies = append(got, r), append(bodies, b)
		mu.Unlock()
	}))
	defer recv.Close()
	go p.svc.RunWebhookWorker(t.Context(), slog.New(slog.NewTextHandler(io.Discard, nil)))

	e := p.openEvent("hooks", nil)
	var hook core.Webhook
	p.must(p.api("POST", "/api/v1/events/hooks/webhooks", adminTok, map[string]any{"url": recv.URL, "topics": []string{"project.submitted"}}), 201).JSON(t, &hook)
	u := p.signup("hooker@test.local", "Hook")
	p.must(p.api("POST", "/api/v1/events/hooks/teams", u, map[string]string{"name": "H"}), 201)
	p.must(p.api("POST", "/api/v1/events/hooks/projects", u, map[string]any{"title": "Hooked", "track_id": trackID(e, 0), "submit": true}), 201)

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 {
		t.Fatalf("expected 1 delivery, got %d", len(got))
	}
	m := hmac.New(sha256.New, []byte(hook.Secret))
	m.Write(bodies[0])
	if want := "sha256=" + hex.EncodeToString(m.Sum(nil)); got[0].Header.Get("X-Dogfood-Signature") != want {
		t.Fatal("bad webhook signature")
	}
	var payload struct{ Topic string }
	json.Unmarshal(bodies[0], &payload)
	if payload.Topic != "project.submitted" {
		t.Fatalf("topic %q", payload.Topic)
	}
}

// Publishing produces a bundle anyone can re-run offline; any edit to the
// inputs, the manifest or the signature is caught.
func TestVerifiableResultsBundle(t *testing.T) {
	p := newPortal(t)
	e := p.openEvent("verify", nil)
	slug := "verify"
	// Two teams, two judges, a few reviews.
	for i, name := range []string{"Alpha", "Beta", "Gamma"} {
		u := p.signup(name+"@test.local", name)
		p.must(p.api("POST", "/api/v1/events/"+slug+"/teams", u, map[string]string{"name": name}), 201)
		p.must(p.api("POST", "/api/v1/events/"+slug+"/projects", u, map[string]any{"title": name + " app", "track_id": trackID(e, i%2), "submit": true}), 201)
	}
	var judges []string
	for _, n := range []string{"j1", "j2"} {
		tok := p.signup(n+"@test.local", n)
		var inv struct{ Invitation core.Invitation }
		p.must(p.api("POST", "/api/v1/events/"+slug+"/invitations", adminTok, map[string]string{"role": "judge"}), 201).JSON(t, &inv)
		p.must(p.api("POST", "/api/v1/invitations/"+inv.Invitation.Token+"/accept", tok, nil), 200)
		judges = append(judges, tok)
	}
	p.must(p.api("POST", "/api/v1/events/"+slug+"/assignments/run", adminTok, nil), 200)
	now := time.Now().UTC()
	p.must(p.api("PATCH", "/api/v1/events/"+slug, adminTok, map[string]any{"name": "Test verify", "slug": slug,
		"submissions_open_at": now.Add(-3 * time.Hour).Format(time.RFC3339), "submissions_close_at": now.Add(-time.Minute).Format(time.RFC3339),
		"reviews_per_project": 2}), 200)
	for ji, j := range judges {
		var as []core.Assignment
		p.must(p.api("GET", "/api/v1/judge/assignments?event="+slug, j, nil), 200).JSON(t, &as)
		for k, a := range as {
			v := 2 + (ji+k)%4
			p.must(p.api("PUT", "/api/v1/events/"+slug+"/reviews/"+a.Project.ID, j, map[string]any{
				"scores": map[string]int{"functionality": v, "quality": 5 - v%3, "innovation": 3}}), 200)
		}
	}
	// Not public before publication; organizers may preview.
	p.must(p.api("GET", "/api/v1/events/"+slug+"/results/bundle", "", nil), 403)
	p.must(p.api("GET", "/api/v1/events/"+slug+"/results/bundle", adminTok, nil), 200)
	p.must(p.api("POST", "/api/v1/events/"+slug+"/publish", adminTok, map[string]bool{"published": true}), 204)

	var b core.ResultsBundle
	p.must(p.api("GET", "/api/v1/events/"+slug+"/results/bundle", "", nil), 200).JSON(t, &b)
	var key struct {
		PublicKey string `json:"public_key"`
	}
	p.must(p.api("GET", "/.well-known/dogfood-signing-key", "", nil), 200).JSON(t, &key)
	pub, _ := base64.StdEncoding.DecodeString(key.PublicKey)

	v := core.VerifyBundle(ed25519.PublicKey(pub), b)
	if !v.Signature || !v.Digest || !v.Reproduced {
		t.Fatalf("genuine bundle failed: %+v", v)
	}
	if v.Manifest.AuditAnchor == "" || len(v.Manifest.Ranking) != 3 {
		t.Fatalf("manifest incomplete: %+v", v.Manifest)
	}
	for _, r := range b.Inputs.Reviews {
		if !strings.HasPrefix(r.Judge, "J-") {
			t.Fatalf("judge identity leaked in bundle: %q", r.Judge)
		}
	}

	// Change one score: the digest no longer matches the signed manifest.
	tampered := b
	tampered.Inputs.Reviews = append([]core.BundleReview(nil), b.Inputs.Reviews...)
	vals := map[string]int{}
	for k, x := range tampered.Inputs.Reviews[0].Values {
		vals[k] = x
	}
	vals["functionality"] = 1
	tampered.Inputs.Reviews[0].Values = vals
	if v := core.VerifyBundle(ed25519.PublicKey(pub), tampered); v.Digest {
		t.Fatal("tampered inputs passed the digest check")
	}
	// Rewrite the manifest's ranking: the signature breaks.
	body, _ := base64.StdEncoding.DecodeString(b.Manifest.Payload)
	forged := b
	forged.Manifest.Payload = base64.StdEncoding.EncodeToString([]byte(strings.Replace(string(body), `"rank":1`, `"rank":9`, 1)))
	if v := core.VerifyBundle(ed25519.PublicKey(pub), forged); v.Signature {
		t.Fatal("forged manifest passed the signature check")
	}

	// v2: every review is committed under the manifest's Merkle root, and a
	// judge's signed record proves each of their reviews is in it unchanged.
	if v.Manifest.Type != core.ManifestV2 || v.ReviewRoot == nil || !*v.ReviewRoot ||
		v.Manifest.ReviewCount != len(b.Inputs.Reviews) {
		t.Fatalf("review root not committed: %+v", v.Manifest)
	}
	var rec struct {
		Record  core.SignedRecord
		Payload core.RecordPayload
	}
	p.must(p.api("GET", "/api/v1/events/"+slug+"/records/judge", judges[0], nil), 200).JSON(t, &rec)
	if _, err := core.VerifyRecord(ed25519.PublicKey(pub), rec.Record); err != nil {
		t.Fatal(err)
	}
	if len(rec.Payload.ReviewLeaves) != rec.Payload.Reviews || rec.Payload.Pseudonym == "" {
		t.Fatalf("record has %d leaves for %d reviews", len(rec.Payload.ReviewLeaves), rec.Payload.Reviews)
	}
	for _, c := range core.VerifyReviews(b, v.Manifest, rec.Payload.ReviewLeaves) {
		if !c.OK {
			t.Fatalf("genuine review %s failed: %s", c.Leaf, c.Problem)
		}
	}
	// Change one of this judge's reviews in the bundle: it no longer appears,
	// and the recomputed root no longer matches the signed one.
	edited := b
	edited.Inputs.Reviews = append([]core.BundleReview(nil), b.Inputs.Reviews...)
	for i, r := range edited.Inputs.Reviews {
		if r.Judge == rec.Payload.Pseudonym {
			vals := map[string]int{}
			for k, x := range r.Values {
				vals[k] = x
			}
			vals["innovation"] = 1 + vals["innovation"]%5
			edited.Inputs.Reviews[i].Values = vals
			break
		}
	}
	// The edited review's leaf is gone; proofs of the judge's other reviews
	// that pass through the edited subtree no longer reach the root either.
	missing := 0
	for _, c := range core.VerifyReviews(edited, v.Manifest, rec.Payload.ReviewLeaves) {
		if c.Index < 0 {
			missing++
		}
	}
	if missing != 1 {
		t.Fatalf("editing one review left %d leaves missing, want 1", missing)
	}
	if ev := core.VerifyBundle(ed25519.PublicKey(pub), edited); ev.ReviewRoot == nil || *ev.ReviewRoot {
		t.Fatal("edited reviews still match the signed review root")
	}
}

// Inclusion proofs verify for every leaf of trees of every small size, and
// fail against the wrong index or root.
func TestMerkleInclusionProofs(t *testing.T) {
	for n := 1; n <= 17; n++ {
		in := core.BundleInputs{}
		for i := range n {
			in.Reviews = append(in.Reviews, core.BundleReview{Judge: "J-x", Project: fmt.Sprintf("prj_%02d", i), Values: map[string]int{"a": i}})
		}
		root := core.ReviewRoot(in)
		for i := range n {
			leaf := core.ReviewLeaf(in.Reviews[i])
			path := core.InclusionProof(in, i)
			if err := core.VerifyInclusion(leaf, i, n, path, root); err != nil {
				t.Fatalf("n=%d i=%d: %v", n, i, err)
			}
			if n > 1 {
				if core.VerifyInclusion(leaf, (i+1)%n, n, path, root) == nil {
					t.Fatalf("n=%d i=%d: proof accepted at the wrong index", n, i)
				}
			}
			if core.VerifyInclusion(leaf, i, n, path, strings.Repeat("0", 64)) == nil {
				t.Fatalf("n=%d i=%d: proof accepted against the wrong root", n, i)
			}
		}
	}
}

func TestTiebreakTargetsPrizeBoundary(t *testing.T) {
	p := newPortal(t)
	var before, after core.Progress
	p.must(p.api("GET", "/api/v1/events/evt_01/progress", orgToken, nil), 200).JSON(t, &before)
	var rep core.TiebreakReport
	p.must(p.api("POST", "/api/v1/events/evt_01/assignments/tiebreak", orgToken, map[string]int{"max": 3}), 200).JSON(t, &rep)
	if len(rep.Candidates) == 0 || len(rep.Candidates) > 3 {
		t.Fatalf("expected 1-3 boundary projects on the fixture, got %d", len(rep.Candidates))
	}
	for _, c := range rep.Candidates {
		if c.ProbTopK <= 0.05 || c.ProbTopK >= 0.95 {
			t.Fatalf("%s is not on the boundary (P = %.2f)", c.ProjectID, c.ProbTopK)
		}
	}
	for _, n := range rep.Assign.New {
		if !strings.HasPrefix(n.Reason, "tie-breaker") {
			t.Fatalf("assignment reason %q", n.Reason)
		}
	}
	p.must(p.api("GET", "/api/v1/events/evt_01/progress", orgToken, nil), 200).JSON(t, &after)
	if after.Assignments != before.Assignments+len(rep.Assign.New) {
		t.Fatalf("assignments %d -> %d, new %d", before.Assignments, after.Assignments, len(rep.Assign.New))
	}
	p.must(p.api("POST", "/api/v1/events/evt_01/assignments/tiebreak", judgeA, nil), 403)
}

// The landing page's public endpoints: aggregate counts and the engine demo.
func TestPublicDemoEndpoints(t *testing.T) {
	p := newPortal(t)
	var st core.Stats
	p.must(p.api("GET", "/api/v1/stats", "", nil), 200).JSON(t, &st)
	if st.Events < 1 || st.Projects < 40 || st.Judges != 30 || st.Reviews < 100 {
		t.Fatalf("stats %+v", st)
	}
	var d struct {
		Config  map[string]any   `json:"config"`
		Reviews []map[string]any `json:"reviews"`
		Report  map[string]any   `json:"report"`
	}
	p.must(p.api("GET", "/api/v1/demo/simulate?projects=500&judges=4&coverage=3&seed=9", "", nil), 200).JSON(t, &d)
	if d.Config["projects"].(float64) != 40 || len(d.Reviews) != 120 || d.Report["robustness"] == nil {
		t.Fatalf("simulate: config %v, %d reviews", d.Config, len(d.Reviews))
	}
}

// The organizer's assignment list covers every edge of the review graph with
// a status, and only organizers can read it.
func TestEventAssignmentsListEveryEdge(t *testing.T) {
	p := newPortal(t)
	var before core.Progress
	p.must(p.api("GET", "/api/v1/events/evt_01/progress", orgToken, nil), 200).JSON(t, &before)
	var as []core.EventAssignment
	p.must(p.api("GET", "/api/v1/events/evt_01/assignments", orgToken, nil), 200).JSON(t, &as)
	live, done := 0, 0
	for _, a := range as {
		switch a.Status {
		case "pending":
			live++
		case "done":
			live++
			done++
		case "recused":
		default:
			t.Fatalf("unknown status %q", a.Status)
		}
		if a.Judge == "" || a.Project == "" || a.JudgeName == "" || a.ProjectTitle == "" {
			t.Fatalf("incomplete edge %+v", a)
		}
	}
	if live != before.Assignments || done != before.Done {
		t.Fatalf("list has %d live / %d done edges, progress says %d / %d", live, done, before.Assignments, before.Done)
	}
}
