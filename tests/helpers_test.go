// Package tests is the black-box suite: it boots the whole portal (real
// SQLite, real seed, real HTTP handlers) and drives it the way a browser or
// curl would. Unit tests for the maths live next to the code in src/judging.
package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"dogfood/src/core"
	"dogfood/src/seed"
	"dogfood/src/store"
	"dogfood/src/web"
)

const (
	orgToken  = "demo-organizer-4f2a81"
	adminTok  = "demo-admin-7c1e9b"
	judgeA    = "demo-judge-a-91bc3d"
	judgeB    = "demo-judge-b-44de5f"
	partToken = "demo-participant-2e88a0"
)

type portal struct {
	t   *testing.T
	srv *httptest.Server
	svc *core.Service
}

// newPortal boots a fresh, seeded portal on an in-memory database.
func newPortal(t *testing.T) *portal {
	t.Helper()
	return newPortalWith(t, web.Config{})
}

// newPortalWith is newPortal with a server configuration (e.g. sign-in providers).
func newPortalWith(t *testing.T, cfg web.Config) *portal {
	t.Helper()
	db, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	svc, err := core.New(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if err := seed.Run(ctx, svc, seed.Options{FixturesPath: "../fixtures.json", Demo: true, Out: io.Discard}); err != nil {
		t.Fatal(err)
	}
	h, err := web.New(svc, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h.Handler())
	t.Cleanup(func() { srv.Close(); db.Close() })
	return &portal{t: t, srv: srv, svc: svc}
}

type resp struct {
	Status int
	Body   string
	Header http.Header
}

func (r resp) JSON(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal([]byte(r.Body), v); err != nil {
		t.Fatalf("bad JSON (%d): %v\n%s", r.Status, err, r.Body)
	}
}

// api sends a JSON request with an optional bearer token.
func (p *portal) api(method, path, token string, body any) resp {
	p.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, p.srv.URL+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		p.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{res.StatusCode, string(b), res.Header}
}

func (p *portal) must(r resp, want int) resp {
	p.t.Helper()
	if r.Status != want {
		p.t.Fatalf("status %d, want %d: %s", r.Status, want, r.Body)
	}
	return r
}

// login returns a bearer token for a seeded or newly created account.
func (p *portal) login(email, password string) string {
	p.t.Helper()
	var out struct{ Token string }
	p.must(p.api("POST", "/api/v1/auth/login", "", map[string]string{"email": email, "password": password}), 200).JSON(p.t, &out)
	return out.Token
}

func (p *portal) signup(email, name string) string {
	p.t.Helper()
	var out struct{ Token string }
	p.must(p.api("POST", "/api/v1/auth/signup", "", map[string]string{"email": email, "name": name, "password": "correct horse battery"}), 201).JSON(p.t, &out)
	return out.Token
}

// openEvent creates an event (as admin) whose submissions are open now.
func (p *portal) openEvent(slug string, extra map[string]any) map[string]any {
	p.t.Helper()
	now := time.Now().UTC()
	body := map[string]any{
		"name": "Test " + slug, "slug": slug,
		"submissions_open_at":  now.Add(-time.Hour).Format(time.RFC3339),
		"submissions_close_at": now.Add(48 * time.Hour).Format(time.RFC3339),
		"tracks":               []string{"Tools", "Data"},
		"reviews_per_project":  2,
	}
	for k, v := range extra {
		body[k] = v
	}
	var e map[string]any
	p.must(p.api("POST", "/api/v1/events", adminTok, body), 201).JSON(p.t, &e)
	return e
}

func trackID(e map[string]any, i int) string {
	return e["tracks"].([]any)[i].(map[string]any)["id"].(string)
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
