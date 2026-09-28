package web

import (
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

// The Go server is the edge: it answers /api, /.well-known and /healthz
// itself and reverse-proxies every other path to the Next.js frontend.
//
// Why Go and not Next at the edge: Next only sets X-Forwarded-For when the
// client did not send one, so behind Next a client could claim any IP and
// dodge the per-IP rate limits and the vote network-clustering rule. Here Go
// strips client-supplied forwarding headers, sets its own, and only trusts
// X-Forwarded-For on requests that come from the frontend's own address
// (server-side calls that forward the real client, as set by us).

func (s *Server) frontendProxy() (http.Handler, error) {
	target, err := url.Parse(s.cfg.FrontendURL)
	if err != nil {
		return nil, err
	}
	s.trusted = newHostSet(target.Hostname())
	rp := &httputil.ReverseProxy{
		// Rewrite (unlike Director) starts from an outbound request with the
		// client's X-Forwarded-* headers already removed.
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = pr.In.Host
			pr.SetXForwarded()
			pr.Out.Header.Set("X-Forwarded-For", s.clientIP(pr.In))
			if s.cfg.TrustProxy {
				if proto := pr.In.Header.Get("X-Forwarded-Proto"); proto != "" {
					pr.Out.Header.Set("X-Forwarded-Proto", proto)
				}
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			s.log.Warn("frontend unavailable", "path", r.URL.Path, "err", err)
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Retry-After", "2")
			w.WriteHeader(http.StatusBadGateway)
			w.Write([]byte(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Starting</title>` +
				`<p style="font:16px system-ui;margin:3rem">The interface is starting up; this page will retry in a moment. ` +
				`The API is already available at <a href="/api/v1/openapi.yaml">/api/v1</a>.</p>`))
		},
	}
	return rp, nil
}

// hostSet resolves a hostname to its IPs and refreshes them periodically, so
// a container that restarts with a new address stays trusted.
type hostSet struct {
	host string
	mu   sync.Mutex
	ips  map[string]bool
	at   time.Time
}

func newHostSet(host string) *hostSet { return &hostSet{host: host} }

func (h *hostSet) contains(ip string) bool {
	if h == nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if time.Since(h.at) > 30*time.Second {
		h.ips = map[string]bool{}
		if addrs, err := net.LookupHost(h.host); err == nil {
			for _, a := range addrs {
				h.ips[a] = true
			}
		}
		h.at = time.Now()
	}
	return h.ips[ip]
}

// clientIP is the address rate limits and abuse rules key on. Forwarded
// headers are honoured only from the frontend or, when configured, from an
// operator's own reverse proxy; the rightmost entry is the one that proxy added.
func (s *Server) clientIP(r *http.Request) string {
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remote = r.RemoteAddr
	}
	if s.cfg.TrustProxy || s.trusted.contains(remote) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
	}
	return remote
}
