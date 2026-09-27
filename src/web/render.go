package web

import (
	"bytes"
	"fmt"
	"html/template"
	"io/fs"
	"math"
	"net/http"
	"path"
	"strings"
	"time"

	"dogfood/src/core"
)

var notices = map[string]string{
	"saved":       "Saved.",
	"submitted":   "Submitted. You can keep editing until the deadline.",
	"created":     "Created.",
	"joined":      "You joined the team.",
	"left":        "You left the team.",
	"assigned":    "Assignment engine ran.",
	"published":   "Results published.",
	"unpublished": "Results hidden again.",
	"voted":       "Vote recorded.",
	"unvoted":     "Vote withdrawn.",
	"welcome":     "Welcome aboard.",
	"reviewed":    "Review saved.",
	"compared":    "Comparison recorded.",
	"recused":     "Assignment declined.",
	"extended":    "Deadline extended for that team.",
	"marked":      "Project updated.",
	"moderated":   "Done.",
}

func (s *Server) loadTemplates() error {
	funcs := template.FuncMap{
		"date": func(t any) string {
			switch v := t.(type) {
			case time.Time:
				return v.UTC().Format("Mon 2 Jan 2006, 15:04 UTC")
			case *time.Time:
				if v == nil {
					return "not set"
				}
				return v.UTC().Format("Mon 2 Jan 2006, 15:04 UTC")
			}
			return ""
		},
		"inputTime": func(t any) string {
			switch v := t.(type) {
			case time.Time:
				return v.UTC().Format("2006-01-02T15:04")
			case *time.Time:
				if v == nil {
					return ""
				}
				return v.UTC().Format("2006-01-02T15:04")
			}
			return ""
		},
		"ago": func(t time.Time) string {
			d := time.Since(t)
			switch {
			case d < time.Minute:
				return "just now"
			case d < time.Hour:
				return fmt.Sprintf("%dm ago", int(d.Minutes()))
			case d < 48*time.Hour:
				return fmt.Sprintf("%dh ago", int(d.Hours()))
			}
			return fmt.Sprintf("%dd ago", int(d.Hours()/24))
		},
		"f1":  func(v float64) string { return fmt.Sprintf("%.1f", v) },
		"f2":  func(v float64) string { return fmt.Sprintf("%.2f", v) },
		"pct": func(v float64) string { return fmt.Sprintf("%.0f%%", 100*v) },
		"signed": func(v int) string {
			if v > 0 {
				return fmt.Sprintf("+%d", v)
			}
			return fmt.Sprint(v)
		},
		"signedf": func(v float64) string { return fmt.Sprintf("%+.2f", v) },
		"add":     func(a, b int) int { return a + b },
		"percent": func(a, b int) int {
			if b == 0 {
				return 0
			}
			return int(math.Round(100 * float64(a) / float64(b)))
		},
		"join": strings.Join,
		// Rank-interval bar geometry, as percentages of the ranking's length.
		"ciLeft": func(rank, n int) float64 {
			if n == 0 {
				return 0
			}
			return 100 * float64(rank-1) / float64(n)
		},
		"ciWidth": func(low, high, n int) float64 {
			if n == 0 {
				return 0
			}
			return 100 * float64(high-low+1) / float64(n)
		},
		"contains": func(xs []string, x string) bool {
			for _, v := range xs {
				if v == x {
					return true
				}
			}
			return false
		},
		"seq": func(a, b int) []int {
			var out []int
			for i := a; i <= b; i++ {
				out = append(out, i)
			}
			return out
		},
		"truncate": func(n int, s string) string {
			r := []rune(s)
			if len(r) <= n {
				return s
			}
			return string(r[:n-1]) + "…"
		},
		"dict": func(kv ...any) map[string]any {
			m := map[string]any{}
			for i := 0; i+1 < len(kv); i += 2 {
				m[fmt.Sprint(kv[i])] = kv[i+1]
			}
			return m
		},
	}
	layout, err := assets.ReadFile("templates/layout.html")
	if err != nil {
		return err
	}
	partials, err := assets.ReadFile("templates/partials.html")
	if err != nil {
		return err
	}
	files, err := fs.Glob(assets, "templates/*.html")
	if err != nil {
		return err
	}
	s.pages = map[string]*template.Template{}
	for _, f := range files {
		name := strings.TrimSuffix(path.Base(f), ".html")
		if name == "layout" || name == "partials" {
			continue
		}
		body, err := assets.ReadFile(f)
		if err != nil {
			return err
		}
		t := template.New(name).Funcs(funcs)
		for _, src := range [][]byte{layout, partials, body} {
			if _, err := t.Parse(string(src)); err != nil {
				return fmt.Errorf("template %s: %w", name, err)
			}
		}
		s.pages[name] = t
	}
	return nil
}

// render executes a page inside the layout. Rendering into a buffer first
// means a template error produces a clean 500 instead of half a page.
func (s *Server) render(w http.ResponseWriter, r *http.Request, name string, data map[string]any) {
	t, ok := s.pages[name]
	if !ok {
		http.Error(w, "unknown template "+name, http.StatusInternalServerError)
		return
	}
	if data == nil {
		data = map[string]any{}
	}
	a := actorOf(r)
	data["Me"] = a.User
	data["CSRF"] = s.csrfToken(r)
	data["Path"] = r.URL.Path
	data["Notice"] = notices[r.URL.Query().Get("msg")]
	data["CanCreateEvents"] = s.svc.CanCreateEvents(a)
	var buf bytes.Buffer
	entry := "layout"
	if bare, _ := data["Bare"].(bool); bare {
		entry = "content"
	}
	if err := t.ExecuteTemplate(&buf, entry, data); err != nil {
		s.log.Error("render", "template", name, "err", err)
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(buf.Bytes())
}

// actorRoles is a small helper for templates that vary by role.
func (s *Server) roleFlags(r *http.Request, eventID string) map[string]bool {
	roles, err := s.svc.Roles(r.Context(), actorOf(r), eventID)
	out := map[string]bool{}
	if err != nil {
		return out
	}
	for k, v := range roles {
		out[string(k)] = v
	}
	return out
}

func (s *Server) now() time.Time { return s.svc.Now().UTC() }

var _ = core.RoleJudge
