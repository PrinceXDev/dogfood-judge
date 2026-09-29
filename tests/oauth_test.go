package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"dogfood/src/core"
	"dogfood/src/web"
)

// fakeIdP is an OpenID Connect provider in miniature: it issues one code per
// authorize request, checks the PKCE verifier and client secret at the token
// endpoint, and answers userinfo for whoever it is told is signing in.
type fakeIdP struct {
	srv       *httptest.Server
	mu        sync.Mutex
	challenge map[string]string // code -> PKCE challenge
	who       map[string]any    // userinfo for the next sign-in
}

func newFakeIdP(t *testing.T) *fakeIdP {
	f := &fakeIdP{challenge: map[string]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		f.mu.Lock()
		want, ok := f.challenge[r.PostForm.Get("code")]
		delete(f.challenge, r.PostForm.Get("code"))
		f.mu.Unlock()
		if !ok || r.PostForm.Get("client_secret") != "shh" || core.PKCEChallenge(r.PostForm.Get("code_verifier")) != want {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"access_token": "at-" + r.PostForm.Get("code")})
	})
	mux.HandleFunc("GET /userinfo", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer at-") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(f.who)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

// authorize plays the provider's consent screen: it reads the challenge from
// the authorize URL and returns the code and state it would redirect with.
func (f *fakeIdP) authorize(t *testing.T, location string) (code, state string) {
	t.Helper()
	u, err := url.Parse(location)
	if err != nil || !strings.HasPrefix(location, f.srv.URL+"/authorize") {
		t.Fatalf("start redirected to %q, want the provider", location)
	}
	q := u.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("client_id") != "cid" || !strings.HasSuffix(q.Get("redirect_uri"), "/api/v1/auth/google/callback") {
		t.Fatalf("authorize request missing PKCE, client id or redirect: %s", location)
	}
	code = "code" + q.Get("state")[:8]
	f.mu.Lock()
	f.challenge[code] = q.Get("code_challenge")
	f.mu.Unlock()
	return code, q.Get("state")
}

// noRedirect is a client that stops at redirects and keeps cookies per host.
func noRedirect() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func cookieFrom(res *http.Response, name string) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func TestSocialSignIn(t *testing.T) {
	idp := newFakeIdP(t)
	p := newPortalWith(t, web.Config{OAuth: []*core.OAuthProvider{{
		ID: "google", Name: "Google", ClientID: "cid", ClientSecret: "shh", PKCE: true,
		AuthURL: idp.srv.URL + "/authorize", TokenURL: idp.srv.URL + "/token", UserURL: idp.srv.URL + "/userinfo",
		Scopes: []string{"openid", "email"},
	}}})
	client := noRedirect()

	var providers []map[string]string
	p.must(p.api("GET", "/api/v1/auth/providers", "", nil), 200).JSON(t, &providers)
	if len(providers) != 1 || providers[0]["id"] != "google" {
		t.Fatalf("providers = %v", providers)
	}

	// signIn runs the whole browser round trip and returns the redirect target
	// and the session cookie, if any.
	signIn := func(who map[string]any, tamper bool, next string) (string, *http.Cookie) {
		t.Helper()
		idp.mu.Lock()
		idp.who = who
		idp.mu.Unlock()
		res, err := client.Get(p.srv.URL + "/api/v1/auth/google/start?next=" + url.QueryEscape(next))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		state := cookieFrom(res, "dogfood_oauth")
		if res.StatusCode != http.StatusFound || state == nil || !state.HttpOnly {
			t.Fatalf("start: %d, state cookie %v", res.StatusCode, state)
		}
		code, st := idp.authorize(t, res.Header.Get("Location"))
		if tamper {
			st = strings.Repeat("0", len(st))
		}
		req, _ := http.NewRequest("GET", p.srv.URL+"/api/v1/auth/google/callback?code="+code+"&state="+st, nil)
		req.AddCookie(state)
		res, err = client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.Header.Get("Location"), cookieFrom(res, "dogfood_session")
	}
	type meResp struct {
		User  core.User
		Roles map[string][]string
	}
	me := func(c *http.Cookie) meResp {
		t.Helper()
		req, _ := http.NewRequest("GET", p.srv.URL+"/api/v1/me", nil)
		req.AddCookie(c)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var m meResp
		json.NewDecoder(res.Body).Decode(&m)
		return m
	}

	// A new person gets a new account and lands where they were going.
	to, sess := signIn(map[string]any{"sub": "g-1", "email": "new.person@test.local", "email_verified": true, "name": "New Person"}, false, "/dashboard")
	if to != "/dashboard" || sess == nil {
		t.Fatalf("new sign-in went to %q with session %v", to, sess)
	}
	first := me(sess)
	if first.User.Email != "new.person@test.local" || first.User.Name != "New Person" {
		t.Fatalf("me = %+v", first.User)
	}
	// Same provider identity later, even with a changed email: same account.
	_, sess = signIn(map[string]any{"sub": "g-1", "email": "renamed@test.local", "email_verified": true}, false, "/dashboard")
	if m := me(sess); m.User.ID != first.User.ID {
		t.Fatalf("returning identity got account %s, want %s", m.User.ID, first.User.ID)
	}

	// A verified email that matches an imported judge links to that judge.
	_, sess = signIn(map[string]any{"sub": "g-2", "email": "Jonas.Vogel@example.org", "email_verified": "true"}, false, "/dashboard")
	if m := me(sess); m.User.ID != "jdg_26" || len(m.Roles["evt_01"]) == 0 {
		t.Fatalf("linked account = %+v roles %v, want jdg_26 with its event roles", m.User, m.Roles)
	}

	// An unverified email is never matched to anyone.
	to, sess = signIn(map[string]any{"sub": "g-3", "email": "organizer@dogfood.local", "email_verified": false}, false, "/dashboard")
	if sess != nil || !strings.Contains(to, "error=oauth_email_google") {
		t.Fatalf("unverified email: redirect %q, session %v", to, sess)
	}

	// A callback whose state does not match the cookie is refused.
	to, sess = signIn(map[string]any{"sub": "g-1", "email": "x@test.local", "email_verified": true}, true, "/dashboard")
	if sess != nil || !strings.Contains(to, "error=oauth_state") {
		t.Fatalf("forged state: redirect %q, session %v", to, sess)
	}

	// next= can't be used to bounce a signed-in user to another site.
	if to, _ := signIn(map[string]any{"sub": "g-1", "email": "x@test.local", "email_verified": true}, false, "//evil.example"); to != "/" {
		t.Fatalf("next=//evil.example redirected to %q, want /", to)
	}

	// Unknown or unconfigured providers send the browser back to sign-in.
	res, _ := client.Get(p.srv.URL + "/api/v1/auth/github/start")
	res.Body.Close()
	if !strings.Contains(res.Header.Get("Location"), "error=oauth_unavailable") {
		t.Fatalf("unconfigured provider redirected to %q", res.Header.Get("Location"))
	}
}

// With no provider configured the instance lists none and makes no request.
func TestNoSocialProvidersByDefault(t *testing.T) {
	p := newPortal(t)
	r := p.must(p.api("GET", "/api/v1/auth/providers", "", nil), 200)
	if strings.TrimSpace(r.Body) != "[]" {
		t.Fatalf("providers = %s, want []", r.Body)
	}
}
