package tests

import "testing"

// isolationSetup adds an organizer who runs evt_01 only, and returns their
// token plus the id of the seeded second event (which they do not run).
func isolationSetup(t *testing.T, p *portal) (orgA, other string) {
	t.Helper()
	orgA = p.signup("org-a@example.org", "Org A")
	db := p.svc.DB
	if _, err := db.Exec(`INSERT INTO event_roles (event_id, user_id, role)
		SELECT 'evt_01', id, 'organizer' FROM users WHERE email = 'org-a@example.org'`); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT id FROM events WHERE id <> 'evt_01' LIMIT 1`).Scan(&other); err != nil {
		t.Fatal(err)
	}
	return orgA, other
}

// addUser creates an imported account (no password) that judges evt_01.
func addUser(t *testing.T, p *portal, id string) {
	t.Helper()
	db := p.svc.DB
	if _, err := db.Exec(`INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z')`, id, id+"@example.org", id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO event_roles (event_id, user_id, role) VALUES ('evt_01', ?, 'judge')`, id); err != nil {
		t.Fatal(err)
	}
}

// An activation link sets a password, so it hands over the whole account. An
// organizer may only mint one for an account whose every role is in events
// they run, which has never signed in any other way, and which is not an admin.
func TestActivationLinkCannotTakeOverAccounts(t *testing.T) {
	p := newPortal(t)
	orgA, other := isolationSetup(t, p)
	db := p.svc.DB

	addUser(t, p, "usr_plain")
	addUser(t, p, "usr_social")
	db.Exec(`INSERT INTO user_identities (provider, subject, user_id, email, created_at, last_used)
		VALUES ('github', '4242', 'usr_social', 'usr_social@example.org', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	addUser(t, p, "usr_elsewhere")
	if _, err := db.Exec(`INSERT INTO event_roles (event_id, user_id, role) VALUES (?, 'usr_elsewhere', 'organizer')`, other); err != nil {
		t.Fatal(err)
	}
	addUser(t, p, "usr_admin")
	db.Exec(`UPDATE users SET is_admin = 1 WHERE id = 'usr_admin'`)

	cases := []struct {
		user, token string
		want        int
	}{
		{"usr_plain", orgA, 201},     // the intended use: an imported judge of my event
		{"usr_social", orgA, 409},    // signs in with GitHub: a password would be a second key
		{"usr_elsewhere", orgA, 403}, // organizes an event I don't run
		{"usr_elsewhere", adminTok, 201},
		{"usr_admin", orgA, 403}, // never mint a password for an admin
	}
	for _, c := range cases {
		r := p.api("POST", "/api/v1/events/evt_01/users/"+c.user+"/activation", c.token, map[string]any{})
		if r.Status != c.want {
			t.Errorf("activation link for %s: got %d, want %d (%s)", c.user, r.Status, c.want, r.Body)
		}
	}
}

// An activation link minted while an account was unclaimed stops working once
// the owner signs in another way.
func TestActivationLinkDiesOnceAccountIsClaimed(t *testing.T) {
	p := newPortal(t)
	addUser(t, p, "usr_late")
	var link struct{ URL string }
	p.must(p.api("POST", "/api/v1/events/evt_01/users/usr_late/activation", orgToken, map[string]any{}), 201).JSON(t, &link)
	p.svc.DB.Exec(`INSERT INTO user_identities (provider, subject, user_id, email, created_at, last_used)
		VALUES ('google', '99', 'usr_late', 'usr_late@example.org', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	i := len(link.URL) - 1
	for i >= 0 && link.URL[i] != '/' {
		i--
	}
	tok := link.URL[i+1:]
	r := p.api("POST", "/api/v1/activate/"+tok, "", map[string]string{"password": "correct horse battery"})
	if r.Status == 200 || r.Status == 201 {
		t.Fatalf("stale activation link still sets a password: %d", r.Status)
	}
}

// Organizer powers stop at the edge of the organizer's own events.
func TestOrganizerCannotReachAnotherEvent(t *testing.T) {
	p := newPortal(t)
	orgA, other := isolationSetup(t, p)
	var projectInOther, teamInOther string
	p.svc.DB.QueryRow(`SELECT id FROM projects WHERE event_id = ? LIMIT 1`, other).Scan(&projectInOther)
	p.svc.DB.QueryRow(`SELECT id FROM teams WHERE event_id = ? LIMIT 1`, other).Scan(&teamInOther)
	cases := []struct{ method, path string }{
		{"GET", "/api/v1/events/" + other + "/results"},
		{"GET", "/api/v1/events/" + other + "/reviews"},
		{"GET", "/api/v1/events/" + other + "/audit"},
		{"GET", "/api/v1/events/" + other + "/judges"},
		{"GET", "/api/v1/events/" + other + "/assignments"},
		{"GET", "/api/v1/events/" + other + "/export.json"},
		{"GET", "/api/v1/events/" + other + "/webhooks"},
		{"PATCH", "/api/v1/events/" + other},
		{"POST", "/api/v1/events/" + other + "/publish"},
		{"POST", "/api/v1/events/" + other + "/invitations"},
		{"PUT", "/api/v1/events/" + other + "/criteria/weights"},
	}
	if projectInOther != "" {
		cases = append(cases,
			struct{ method, path string }{"POST", "/api/v1/projects/" + projectInOther + "/disqualify"},
			struct{ method, path string }{"POST", "/api/v1/projects/" + projectInOther + "/duplicate"})
	}
	if teamInOther != "" {
		cases = append(cases, struct{ method, path string }{"POST", "/api/v1/events/" + other + "/teams/" + teamInOther + "/extension"})
	}
	for _, c := range cases {
		var body any
		if c.method != "GET" {
			body = map[string]any{}
		}
		if r := p.api(c.method, c.path, orgA, body); r.Status != 403 {
			t.Errorf("%s %s as organizer of evt_01 only: got %d, want 403", c.method, c.path, r.Status)
		}
	}
	// Resource ids from evt_01 cannot be driven through another event's URL either.
	var team string
	p.svc.DB.QueryRow(`SELECT id FROM teams WHERE event_id = 'evt_01' LIMIT 1`).Scan(&team)
	if r := p.api("POST", "/api/v1/events/"+other+"/teams/"+team+"/extension", orgToken, map[string]any{"minutes": 30, "reason": "x"}); r.Status != 404 {
		t.Errorf("extension for an evt_01 team via %s: got %d, want 404", other, r.Status)
	}
}

// Judges never see other judges' data through side channels.
func TestJudgeSideChannels(t *testing.T) {
	p := newPortal(t)
	for _, path := range []string{
		"/api/v1/events/evt_01/audit",
		"/api/v1/events/evt_01/results/bundle",
		"/api/v1/events/evt_01/export/scores.csv",
		"/api/v1/events/evt_01/assignments",
		"/api/v1/events/evt_01/progress",
		"/api/v1/judge/scores?judge=jdg_24",
	} {
		if r := p.api("GET", path, judgeA, nil); r.Status != 403 {
			t.Errorf("judge GET %s: got %d, want 403", path, r.Status)
		}
	}
}
