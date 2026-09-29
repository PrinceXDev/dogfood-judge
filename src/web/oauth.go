package web

import (
	"crypto/subtle"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"dogfood/src/core"
	"dogfood/src/store"
)

// Browser side of social sign-in. /start sends the browser to the provider
// with a random state and PKCE challenge, remembered in a short-lived sealed
// cookie; /callback checks both, exchanges the code, and signs the person in
// with the same session cookie a password login sets. Failures come back to
// /login?error=<code>, where the page explains them.

const oauthCookie = "dogfood_oauth"

type oauthState struct {
	Provider string `json:"p"`
	State    string `json:"s"`
	Verifier string `json:"v"`
	Next     string `json:"n"`
}

func (s *Server) oauthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/auth/providers", s.api(func(w http.ResponseWriter, r *http.Request) (any, error) {
		out := []map[string]string{}
		for _, p := range s.cfg.OAuth {
			out = append(out, map[string]string{"id": p.ID, "name": p.Name})
		}
		return out, nil
	}))
	mux.HandleFunc("GET /api/v1/auth/{provider}/start", s.oauthStart)
	mux.HandleFunc("GET /api/v1/auth/{provider}/callback", s.oauthCallback)
}

func (s *Server) provider(id string) *core.OAuthProvider {
	for _, p := range s.cfg.OAuth {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// callbackURL must match the redirect URI registered with the provider
// exactly, so set DOGFOOD_PUBLIC_URL whenever a provider is enabled.
func (s *Server) callbackURL(r *http.Request, p *core.OAuthProvider) string {
	path := "/api/v1/auth/" + p.ID + "/callback"
	if s.cfg.PublicURL == "" {
		// Reached through our own frontend (or the operator's proxy): the
		// browser's host is the forwarded one, not ours.
		remote, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			remote = r.RemoteAddr
		}
		if host := r.Header.Get("X-Forwarded-Host"); host != "" && (s.cfg.TrustProxy || s.trusted.contains(remote)) {
			proto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
			if proto != "https" {
				proto = "http"
			}
			return proto + "://" + strings.TrimSpace(strings.Split(host, ",")[0]) + path
		}
	}
	return s.absURL(r, path)
}

func loginError(w http.ResponseWriter, r *http.Request, code, next string) {
	q := url.Values{"error": {code}}
	if next != "" && next != "/" {
		q.Set("next", next)
	}
	http.Redirect(w, r, "/login?"+q.Encode(), http.StatusSeeOther)
}

func (s *Server) oauthStart(w http.ResponseWriter, r *http.Request) {
	next := safeNext(r.URL.Query().Get("next"))
	p := s.provider(r.PathValue("provider"))
	if p == nil {
		loginError(w, r, "oauth_unavailable", next)
		return
	}
	if err := s.limit(w, r, "oauth", 20, time.Minute); err != nil {
		loginError(w, r, "rate_limited", next)
		return
	}
	st := oauthState{Provider: p.ID, State: store.NewToken(), Verifier: store.NewToken() + store.NewToken(), Next: next}
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Value: s.svc.Seal("oauth", st, 10*time.Minute),
		Path: "/api/v1/auth/", HttpOnly: true, Secure: s.cfg.SecureCookies,
		// Lax, not Strict: the provider sends the browser back with a top-level
		// cross-site navigation, and the cookie must come along.
		SameSite: http.SameSiteLaxMode, MaxAge: 600})
	http.Redirect(w, r, p.AuthCodeURL(st.State, core.PKCEChallenge(st.Verifier), s.callbackURL(r, p)), http.StatusFound)
}

func (s *Server) oauthCallback(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Value: "", Path: "/api/v1/auth/", HttpOnly: true,
		Secure: s.cfg.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	p := s.provider(r.PathValue("provider"))
	if p == nil {
		loginError(w, r, "oauth_unavailable", "")
		return
	}
	q := r.URL.Query()
	var st oauthState
	c, err := r.Cookie(oauthCookie)
	if err != nil || s.svc.Open("oauth", c.Value, &st) != nil || st.Provider != p.ID ||
		subtle.ConstantTimeCompare([]byte(st.State), []byte(q.Get("state"))) != 1 {
		// Missing, expired or mismatched state: a stale tab, or a forged callback.
		loginError(w, r, "oauth_state", "")
		return
	}
	if e := q.Get("error"); e != "" {
		if e == "access_denied" {
			loginError(w, r, "oauth_denied", st.Next)
		} else {
			loginError(w, r, "oauth_failed", st.Next)
		}
		return
	}
	id, err := p.Exchange(r.Context(), q.Get("code"), st.Verifier, s.callbackURL(r, p))
	if err != nil {
		s.log.Warn("oauth exchange failed", "provider", p.ID, "err", err)
		loginError(w, r, "oauth_failed", st.Next)
		return
	}
	tok, _, err := s.svc.SocialLogin(r.Context(), actorOf(r), id)
	if err != nil {
		var ce *core.Error
		if errors.As(err, &ce) && ce.Code == "unverified_email" {
			loginError(w, r, "oauth_email_"+p.ID, st.Next)
			return
		}
		s.log.Warn("social login failed", "provider", p.ID, "err", err)
		loginError(w, r, "oauth_failed", st.Next)
		return
	}
	s.setSession(w, tok)
	http.Redirect(w, r, st.Next, http.StatusSeeOther)
}

// OAuthCallbackPaths lists the redirect URIs an operator registers with each
// enabled provider, for the startup log.
func OAuthCallbackPaths(base string, ps []*core.OAuthProvider) []string {
	var out []string
	for _, p := range ps {
		out = append(out, strings.TrimRight(base, "/")+"/api/v1/auth/"+p.ID+"/callback")
	}
	return out
}
