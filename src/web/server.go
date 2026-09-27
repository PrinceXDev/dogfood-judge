// Package web is the HTTP layer: server-rendered pages and a JSON API over
// the same core.Service. Handlers translate HTTP to service calls and back;
// they make no authorization decisions of their own.
package web

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"dogfood/src/core"
)

//go:embed templates/*.html static/*
var assets embed.FS

const sessionCookie = "dogfood_session"

type Config struct {
	SecureCookies bool // set when served over HTTPS
	TrustProxy    bool // honour X-Forwarded-For (only behind a proxy you control)
	PublicURL     string
}

type Server struct {
	svc     *core.Service
	cfg     Config
	log     *slog.Logger
	limiter *core.RateLimiter
	pages   map[string]*template.Template
}

func New(svc *core.Service, cfg Config, log *slog.Logger) (*Server, error) {
	s := &Server{svc: svc, cfg: cfg, log: log, limiter: core.NewRateLimiter()}
	if err := s.loadTemplates(); err != nil {
		return nil, err
	}
	return s, nil
}

type ctxKey int

const (
	actorKey ctxKey = iota
	tokenKey
)

func actorOf(r *http.Request) core.Actor {
	a, _ := r.Context().Value(actorKey).(core.Actor)
	return a
}

func tokenOf(r *http.Request) (token string, fromCookie bool) {
	t, _ := r.Context().Value(tokenKey).([2]string)
	return t[0], t[1] == "cookie"
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.htmlRoutes(mux)
	s.apiRoutes(mux)
	static, _ := fs.Sub(assets, "static")
	mux.Handle("GET /static/", http.StripPrefix("/static/", cacheFor(http.FileServerFS(static), time.Hour)))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.svc.DB.PingContext(r.Context()); err != nil {
			http.Error(w, "db unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok\n"))
	})
	return s.recoverer(s.logRequests(s.securityHeaders(s.authenticate(s.globalRateLimit(mux)))))
}

func cacheFor(h http.Handler, d time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", int(d.Seconds())))
		h.ServeHTTP(w, r)
	})
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// authenticate resolves the caller from a bearer token or the session cookie.
// An invalid token is treated as anonymous, never as an error page, so the
// service layer answers 401/403 consistently.
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a := core.Actor{IP: s.clientIP(r), UA: r.UserAgent(), Source: "web"}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			a.Source = "api"
		}
		var token, via string
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token, via = strings.TrimSpace(strings.TrimPrefix(h, "Bearer ")), "bearer"
		} else if c, err := r.Cookie(sessionCookie); err == nil {
			token, via = c.Value, "cookie"
		}
		if token != "" {
			u, err := s.svc.Authenticate(r.Context(), token)
			if err != nil {
				s.fail(w, r, err)
				return
			}
			a.User = u
		}
		ctx := context.WithValue(r.Context(), actorKey, a)
		ctx = context.WithValue(ctx, tokenKey, [2]string{token, via})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) globalRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/static/") {
			next.ServeHTTP(w, r)
			return
		}
		if !s.limiter.Allow("global:"+s.clientIP(r), 600, time.Minute) {
			s.fail(w, r, &core.Error{Kind: core.KindTooMany, Code: "rate_limited", Message: "too many requests; slow down"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// limit applies a named, tighter bucket keyed on user (or IP when anonymous).
func (s *Server) limit(w http.ResponseWriter, r *http.Request, name string, capacity int, period time.Duration) error {
	key := name + ":" + s.clientIP(r)
	if a := actorOf(r); a.LoggedIn() {
		key = name + ":" + a.User.ID
	}
	if s.limiter.Allow(key, capacity, period) {
		return nil
	}
	w.Header().Set("Retry-After", fmt.Sprint(int(period.Seconds()/float64(capacity))+1))
	return &core.Error{Kind: core.KindTooMany, Code: "rate_limited", Message: "too many attempts; try again shortly"}
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/embed/") {
			// The gallery widget is meant to be framed by other sites.
			h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors *")
		} else {
			h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'")
			h.Set("X-Frame-Options", "DENY")
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r)
		if strings.HasPrefix(r.URL.Path, "/static/") {
			return
		}
		s.log.Info("http", "method", r.Method, "path", r.URL.Path, "status", sw.status, "ms", time.Since(start).Milliseconds())
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic", "path", r.URL.Path, "err", v)
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// Errors

func statusFor(err error) int {
	switch core.ErrorKind(err) {
	case core.KindInvalid:
		return http.StatusBadRequest
	case core.KindUnauthenticated:
		return http.StatusUnauthorized
	case core.KindForbidden:
		return http.StatusForbidden
	case core.KindNotFound:
		return http.StatusNotFound
	case core.KindConflict:
		return http.StatusConflict
	case core.KindTooMany:
		return http.StatusTooManyRequests
	}
	return http.StatusInternalServerError
}

func errorBody(err error) (code, msg string) {
	var e *core.Error
	if errors.As(err, &e) {
		return e.Code, e.Message
	}
	return "internal", "something went wrong"
}

// fail reports err as JSON for /api/ paths and as a page otherwise.
func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	status := statusFor(err)
	if status == http.StatusInternalServerError {
		s.log.Error("request failed", "path", r.URL.Path, "err", err)
	}
	if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/.well-known/") {
		code, msg := errorBody(err)
		writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
		return
	}
	if status == http.StatusUnauthorized {
		http.Redirect(w, r, "/login?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	_, msg := errorBody(err)
	w.WriteHeader(status)
	s.render(w, r, "error", map[string]any{"Status": status, "StatusText": http.StatusText(status), "Message": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(v)
}

// ---------------------------------------------------------------------------
// CSRF: pages use cookie sessions, so every state-changing form carries a
// token derived from the session (HMAC). Bearer-token API calls are immune to
// CSRF and skip the check; cookie-authenticated API calls must send the token
// in X-CSRF-Token. SameSite=Lax on the cookie is a second layer.

func (s *Server) csrfToken(r *http.Request) string {
	token, fromCookie := tokenOf(r)
	if !fromCookie || token == "" {
		return ""
	}
	return s.svc.CSRFToken(token)
}

func (s *Server) checkCSRF(r *http.Request) bool {
	token, fromCookie := tokenOf(r)
	if !fromCookie || token == "" {
		// Bearer or anonymous. Anonymous state-changing requests (login,
		// signup) are protected by SameSite and carry no session to ride.
		return true
	}
	want := s.svc.CSRFToken(token)
	got := r.Header.Get("X-CSRF-Token")
	if got == "" {
		got = r.PostFormValue("csrf")
	}
	return got != "" && got == want
}

var errCSRF = &core.Error{Kind: core.KindForbidden, Code: "csrf", Message: "form expired or was submitted from another site; reload and try again"}

func (s *Server) setSession(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode, MaxAge: int(core.SessionTTL.Seconds())})
}

func (s *Server) clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode, MaxAge: -1})
}

// safeNext only allows local redirect targets.
func safeNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, "/\\") {
		return "/"
	}
	return next
}
