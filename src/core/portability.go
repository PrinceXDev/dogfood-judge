package core

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"dogfood/src/judging"
	"dogfood/src/store"
)

// Doc is the interchange format: a superset of the DOGFOOD fixtures.json
// shape. Import accepts the organisers' fixture file unchanged; Export writes
// the same shape back out (plus optional fields), so a portal's data can be
// moved to another instance, or to another team's portal, with one file.
type Doc struct {
	Event    DocEvent       `json:"event"`
	Tracks   []DocTrack     `json:"tracks"`
	Criteria []DocCriterion `json:"criteria,omitempty"`
	Judges   []DocJudge     `json:"judges"`
	Teams    []DocTeam      `json:"teams"`
	Projects []DocProject   `json:"projects"`
	Scores   []DocScore     `json:"scores"`
}

type DocEvent struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Slug               string `json:"slug,omitempty"`
	Description        string `json:"description,omitempty"`
	SubmissionsOpen    string `json:"submissions_open,omitempty"`
	SubmissionsClose   string `json:"submissions_close"`
	JudgingClose       string `json:"judging_close,omitempty"`
	ReviewsPerProject  int    `json:"reviews_per_project,omitempty"`
	ResultsPublishedAt string `json:"results_published_at,omitempty"`
}

type DocTrack struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type DocCriterion struct {
	Key      string  `json:"key"`
	Name     string  `json:"name"`
	Weight   float64 `json:"weight"`
	ScaleMin int     `json:"scale_min"`
	ScaleMax int     `json:"scale_max"`
}

type DocJudge struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Email  string   `json:"email"`
	Tracks []string `json:"tracks"`
}

type DocTeam struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Members []string `json:"members"`
}

type DocProject struct {
	ID          string `json:"id"`
	Team        string `json:"team"`
	Track       string `json:"track"`
	Title       string `json:"title"`
	Summary     string `json:"summary"`
	Description string `json:"description,omitempty"`
	RepoURL     string `json:"repo_url"`
	DemoURL     string `json:"demo_url,omitempty"`
	SubmittedAt string `json:"submitted_at"`
	DuplicateOf string `json:"duplicate_of,omitempty"`
}

type DocScore struct {
	Judge    string         `json:"judge"`
	Project  string         `json:"project"`
	Criteria map[string]int `json:"criteria"`
	Comment  string         `json:"comment"`
}

// ImportResult reports what an import did, including the data problems it
// found and how it handled each one.
type ImportResult struct {
	EventID    string   `json:"event_id"`
	Users      int      `json:"users_created"`
	Projects   int      `json:"projects"`
	Reviews    int      `json:"reviews"`
	Duplicates []string `json:"duplicates"` // "prj_41 duplicates prj_07 (same title)"
	Warnings   []string `json:"warnings"`
}

// Import loads a Doc as a new event. The caller becomes (or the given user
// becomes) its organizer. Imported rows keep their original ids and
// timestamps and are marked origin='import' in the audit log.
func (s *Service) Import(ctx context.Context, a Actor, d *Doc) (*ImportResult, error) {
	if !s.CanCreateEvents(a) {
		if !a.LoggedIn() {
			return nil, ErrUnauthenticated
		}
		return nil, errForbidden("only admins can import events")
	}
	if d.Event.ID == "" || d.Event.Name == "" || d.Event.SubmissionsClose == "" {
		return nil, errInvalid("invalid_doc", "event.id, event.name and event.submissions_close are required")
	}
	closeAt, err := store.ParseTime(d.Event.SubmissionsClose)
	if err != nil {
		return nil, errInvalid("invalid_doc", "event.submissions_close is not an ISO 8601 timestamp")
	}
	res := &ImportResult{EventID: d.Event.ID}
	now := s.nowS()

	// Submission window: explicit, or three days before the earliest submission.
	openAt := closeAt.Add(-72 * time.Hour)
	if d.Event.SubmissionsOpen != "" {
		if openAt, err = store.ParseTime(d.Event.SubmissionsOpen); err != nil {
			return nil, errInvalid("invalid_doc", "event.submissions_open is not an ISO 8601 timestamp")
		}
	} else {
		for _, p := range d.Projects {
			if t, err := store.ParseTime(p.SubmittedAt); err == nil && t.Add(-24*time.Hour).Before(openAt) {
				openAt = t.Add(-24 * time.Hour).Truncate(24 * time.Hour)
			}
		}
	}
	slug := d.Event.Slug
	if slug == "" {
		slug = slugify(d.Event.Name)
	}
	perProject := d.Event.ReviewsPerProject
	if perProject == 0 {
		perProject = 3
	}

	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		tx.QueryRowContext(ctx, `SELECT count(*) FROM events WHERE id = ? OR slug = ?`, d.Event.ID, slug).Scan(&n)
		if n > 0 {
			return errConflict("event_exists", "event %s (%s) already exists", d.Event.ID, slug)
		}
		var judgingClose, published any
		if d.Event.JudgingClose != "" {
			judgingClose = d.Event.JudgingClose
		}
		if d.Event.ResultsPublishedAt != "" {
			published = d.Event.ResultsPublishedAt
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO events (id, slug, name, description, submissions_open_at, submissions_close_at,
			judging_close_at, results_published_at, reviews_per_project, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			d.Event.ID, slug, d.Event.Name, d.Event.Description, store.FormatTime(openAt), store.FormatTime(closeAt),
			judgingClose, published, perProject, a.User.ID, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO event_roles (event_id, user_id, role) VALUES (?, ?, 'organizer')`, d.Event.ID, a.User.ID); err != nil {
			return err
		}
		// Ids are kept when free and remapped when the instance already uses
		// them (importing a second copy of an event, or another portal's export).
		remap := map[string]string{}
		fresh := func(table, prefix, id string) string {
			var taken int
			tx.QueryRowContext(ctx, `SELECT count(*) FROM `+table+` WHERE id = ?`, id).Scan(&taken)
			if taken == 0 && id != "" {
				remap[id] = id
				return id
			}
			nid := store.NewID(prefix)
			remap[id] = nid
			res.Warnings = append(res.Warnings, fmt.Sprintf("id %s already in use; imported as %s", id, nid))
			return nid
		}
		mapped := func(id string) string {
			if v, ok := remap[id]; ok {
				return v
			}
			return id
		}
		for i, t := range d.Tracks {
			if _, err := tx.ExecContext(ctx, `INSERT INTO tracks (id, event_id, name, position) VALUES (?, ?, ?, ?)`,
				fresh("tracks", "trk", t.ID), d.Event.ID, t.Name, i); err != nil {
				return fmt.Errorf("track %s: %w", t.ID, err)
			}
		}

		// Criteria: declared, or inferred from the score keys in first-seen order.
		crit := d.Criteria
		if len(crit) == 0 {
			seen := map[string]bool{}
			for _, sc := range d.Scores {
				keys := make([]string, 0, len(sc.Criteria))
				for k := range sc.Criteria {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				for _, k := range keys {
					if !seen[k] {
						seen[k] = true
						crit = append(crit, DocCriterion{Key: k, Name: strings.ToUpper(k[:1]) + k[1:], Weight: 1, ScaleMin: 1, ScaleMax: 5})
					}
				}
			}
			// Keep the canonical order used by the fixtures when present.
			order := map[string]int{"functionality": 0, "quality": 1, "innovation": 2}
			sort.SliceStable(crit, func(i, j int) bool {
				oi, iok := order[crit[i].Key]
				oj, jok := order[crit[j].Key]
				if iok && jok {
					return oi < oj
				}
				return iok && !jok
			})
		}
		critID := map[string]string{}
		for i, c := range crit {
			if c.Weight <= 0 {
				c.Weight = 1
			}
			if c.ScaleMin == 0 && c.ScaleMax == 0 {
				c.ScaleMin, c.ScaleMax = 1, 5
			}
			id := store.NewID("crt")
			critID[c.Key] = id
			if _, err := tx.ExecContext(ctx, `INSERT INTO criteria (id, event_id, key, name, weight, scale_min, scale_max, position)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, d.Event.ID, c.Key, c.Name, c.Weight, c.ScaleMin, c.ScaleMax, i); err != nil {
				return err
			}
		}

		userCount := func() int {
			var c int
			tx.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&c)
			return c
		}
		before := userCount()

		judgeUser := map[string]string{}
		for _, j := range d.Judges {
			email, err := normEmail(j.Email)
			if err != nil {
				res.Warnings = append(res.Warnings, fmt.Sprintf("judge %s: invalid email %q, skipped", j.ID, j.Email))
				continue
			}
			var uid string
			if tx.QueryRowContext(ctx, `SELECT id FROM users WHERE email = ?`, email).Scan(&uid) != nil {
				uid = j.ID
				var taken int
				tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE id = ?`, uid).Scan(&taken)
				if taken > 0 || uid == "" {
					uid = store.NewID("usr")
				}
				if _, err := tx.ExecContext(ctx, `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`, uid, email, j.Name, now); err != nil {
					return err
				}
			}
			judgeUser[j.ID] = uid
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO event_roles (event_id, user_id, role) VALUES (?, ?, 'judge')`, d.Event.ID, uid); err != nil {
				return fmt.Errorf("judge %s: %w", j.ID, err)
			}
			for _, t := range j.Tracks {
				tx.ExecContext(ctx, `INSERT OR IGNORE INTO judge_tracks (event_id, user_id, track_id) VALUES (?, ?, ?)`, d.Event.ID, uid, mapped(t))
			}
		}

		for _, t := range d.Teams {
			tid := fresh("teams", "tm", t.ID)
			if _, err := tx.ExecContext(ctx, `INSERT INTO teams (id, event_id, name, invite_token, created_at) VALUES (?, ?, ?, ?, ?)`,
				tid, d.Event.ID, t.Name, store.NewToken()[:24], now); err != nil {
				return fmt.Errorf("team %s: %w", t.ID, err)
			}
			for _, m := range t.Members {
				email, err := normEmail(m)
				if err != nil {
					res.Warnings = append(res.Warnings, fmt.Sprintf("team %s: invalid member email %q, skipped", t.ID, m))
					continue
				}
				uid, err := ensureUser(ctx, tx, email, "", now)
				if err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO event_roles (event_id, user_id, role) VALUES (?, ?, 'participant')`, d.Event.ID, uid); err != nil {
					if store.IsConstraint(err, "conflict_of_interest") {
						res.Warnings = append(res.Warnings, fmt.Sprintf("%s is both a judge and on team %s; kept as judge, not added to team", email, t.ID))
						continue
					}
					return err
				}
				if _, err := tx.ExecContext(ctx, `INSERT INTO team_members (team_id, event_id, user_id, joined_at) VALUES (?, ?, ?, ?)`,
					tid, d.Event.ID, uid, now); err != nil {
					if store.IsConstraint(err, "UNIQUE") {
						res.Warnings = append(res.Warnings, fmt.Sprintf("%s is on more than one team; kept on the first", email))
						continue
					}
					return err
				}
			}
		}
		res.Users = userCount() - before

		// Projects, oldest submission first, so the original of a duplicate
		// pair is the one that stays live.
		projects := append([]DocProject(nil), d.Projects...)
		sort.SliceStable(projects, func(i, j int) bool { return projects[i].SubmittedAt < projects[j].SubmittedAt })
		for i := range projects {
			projects[i].ID = fresh("projects", "prj", projects[i].ID)
			projects[i].Team, projects[i].Track = mapped(projects[i].Team), mapped(projects[i].Track)
		}
		for i := range projects {
			if projects[i].DuplicateOf != "" {
				projects[i].DuplicateOf = mapped(projects[i].DuplicateOf)
			}
		}
		asProjects := make([]*Project, len(projects))
		for i, p := range projects {
			asProjects[i] = &Project{ID: p.ID, EventID: d.Event.ID, Title: p.Title, RepoURL: p.RepoURL}
		}
		dupOf := map[string]string{}
		for _, pair := range findDuplicates(asProjects) {
			dupOf[pair[1].ID] = pair[0].ID
			why := "same title"
			if normRepo(pair[0].RepoURL) != "" && normRepo(pair[0].RepoURL) == normRepo(pair[1].RepoURL) {
				why = "same repository"
				if normTitle(pair[0].Title) == normTitle(pair[1].Title) {
					why = "same title and repository"
				}
			}
			res.Duplicates = append(res.Duplicates, fmt.Sprintf("%s duplicates %s (%s)", pair[1].ID, pair[0].ID, why))
		}
		liveByTeam := map[string]string{}
		for _, p := range projects {
			if p.DuplicateOf != "" {
				dupOf[p.ID] = p.DuplicateOf
			}
			if _, isDup := dupOf[p.ID]; !isDup {
				if first, ok := liveByTeam[p.Team]; ok {
					dupOf[p.ID] = first
					res.Duplicates = append(res.Duplicates, fmt.Sprintf("%s is a second project from team %s; treated as a duplicate of %s", p.ID, p.Team, first))
				} else {
					liveByTeam[p.Team] = p.ID
				}
			}
			status, submitted := "draft", any(nil)
			if p.SubmittedAt != "" {
				t, err := store.ParseTime(p.SubmittedAt)
				if err != nil {
					return errInvalid("invalid_doc", "project %s: submitted_at is not ISO 8601", p.ID)
				}
				status, submitted = "submitted", store.FormatTime(t)
				if !t.Before(closeAt) {
					res.Warnings = append(res.Warnings, fmt.Sprintf("%s was submitted at or after the deadline", p.ID))
				}
			}
			var track any
			if p.Track != "" {
				track = p.Track
			}
			updated := now
			if s, ok := submitted.(string); ok {
				updated = s
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO projects (id, event_id, team_id, track_id, title, summary, description, repo_url,
				demo_url, status, origin, submitted_at, created_at, updated_at, duplicate_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?)`,
				p.ID, d.Event.ID, p.Team, track, p.Title, p.Summary, p.Description, p.RepoURL, p.DemoURL, status, submitted, updated, updated,
				nullIfEmpty(dupOf[p.ID])); err != nil {
				return fmt.Errorf("project %s: %w", p.ID, err)
			}
			res.Projects++
		}

		for _, sc := range d.Scores {
			sc.Project = mapped(sc.Project)
			uid, ok := judgeUser[sc.Judge]
			if !ok {
				res.Warnings = append(res.Warnings, fmt.Sprintf("score by unknown judge %s on %s skipped", sc.Judge, sc.Project))
				continue
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO assignments (event_id, judge_id, project_id, status, reason, assigned_at, completed_at)
				VALUES (?, ?, ?, 'done', 'imported', ?, ?) ON CONFLICT(judge_id, project_id) DO NOTHING`, d.Event.ID, uid, sc.Project, now, now); err != nil {
				return fmt.Errorf("score %s/%s: %w", sc.Judge, sc.Project, err)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO reviews (event_id, judge_id, project_id, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(judge_id, project_id) DO NOTHING`, d.Event.ID, uid, sc.Project, sc.Comment, now, now); err != nil {
				return err
			}
			for k, v := range sc.Criteria {
				cid, ok := critID[k]
				if !ok {
					res.Warnings = append(res.Warnings, fmt.Sprintf("score %s/%s: unknown criterion %q ignored", sc.Judge, sc.Project, k))
					continue
				}
				if _, err := tx.ExecContext(ctx, `INSERT INTO review_scores (judge_id, project_id, criterion_id, value) VALUES (?, ?, ?, ?)
					ON CONFLICT DO NOTHING`, uid, sc.Project, cid, v); err != nil {
					return fmt.Errorf("score %s/%s %s=%d: %w", sc.Judge, sc.Project, k, v, err)
				}
			}
			res.Reviews++
		}
		return s.audit(ctx, tx, a, d.Event.ID, "event.import", d.Event.ID, map[string]any{
			"projects": res.Projects, "reviews": res.Reviews, "duplicates": res.Duplicates, "warnings": len(res.Warnings)})
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}

// Export writes an event in the interchange format. Organizer only: it
// contains every score and every judge's identity.
func (s *Service) Export(ctx context.Context, a Actor, eventID string) (*Doc, error) {
	e, err := s.Event(ctx, a, eventID)
	if err != nil {
		return nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleOrganizer); err != nil {
		return nil, err
	}
	d := &Doc{Event: DocEvent{ID: e.ID, Name: e.Name, Slug: e.Slug, Description: e.Description,
		SubmissionsOpen: store.FormatTime(e.SubmissionsOpenAt), SubmissionsClose: store.FormatTime(e.SubmissionsCloseAt),
		ReviewsPerProject: e.ReviewsPerProject}}
	if e.JudgingCloseAt != nil {
		d.Event.JudgingClose = store.FormatTime(*e.JudgingCloseAt)
	}
	if e.ResultsPublishedAt != nil {
		d.Event.ResultsPublishedAt = store.FormatTime(*e.ResultsPublishedAt)
	}
	d.Tracks = []DocTrack{}
	for _, t := range e.Tracks {
		d.Tracks = append(d.Tracks, DocTrack{t.ID, t.Name})
	}
	for _, c := range e.Criteria {
		d.Criteria = append(d.Criteria, DocCriterion{c.Key, c.Name, c.Weight, c.ScaleMin, c.ScaleMax})
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT u.id, u.name, u.email,
		coalesce((SELECT group_concat(track_id) FROM judge_tracks t WHERE t.event_id = r.event_id AND t.user_id = u.id), '')
		FROM event_roles r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? AND r.role = 'judge' ORDER BY u.id`, e.ID)
	if err != nil {
		return nil, err
	}
	d.Judges = []DocJudge{}
	for rows.Next() {
		var j DocJudge
		var tracks string
		rows.Scan(&j.ID, &j.Name, &j.Email, &tracks)
		j.Tracks = []string{}
		if tracks != "" {
			j.Tracks = strings.Split(tracks, ",")
		}
		d.Judges = append(d.Judges, j)
	}
	rows.Close()
	rows, err = s.DB.QueryContext(ctx, `SELECT t.id, t.name, coalesce(group_concat(u.email), '') FROM teams t
		LEFT JOIN team_members m ON m.team_id = t.id LEFT JOIN users u ON u.id = m.user_id
		WHERE t.event_id = ? GROUP BY t.id ORDER BY t.id`, e.ID)
	if err != nil {
		return nil, err
	}
	d.Teams = []DocTeam{}
	for rows.Next() {
		var t DocTeam
		var members string
		rows.Scan(&t.ID, &t.Name, &members)
		t.Members = []string{}
		if members != "" {
			t.Members = strings.Split(members, ",")
		}
		d.Teams = append(d.Teams, t)
	}
	rows.Close()
	ps, err := s.EventProjects(ctx, a, e.ID)
	if err != nil {
		return nil, err
	}
	d.Projects = []DocProject{}
	for _, p := range ps {
		dp := DocProject{ID: p.ID, Team: p.TeamID, Track: p.TrackID, Title: p.Title, Summary: p.Summary, Description: p.Description,
			RepoURL: p.RepoURL, DemoURL: p.DemoURL, DuplicateOf: p.DuplicateOf}
		if p.SubmittedAt != nil {
			dp.SubmittedAt = store.FormatTime(*p.SubmittedAt)
		}
		d.Projects = append(d.Projects, dp)
	}
	rs, err := s.reviews(ctx, s.DB, "rv.event_id = ?", e.ID)
	if err != nil {
		return nil, err
	}
	d.Scores = []DocScore{}
	for _, r := range rs {
		d.Scores = append(d.Scores, DocScore{Judge: r.JudgeID, Project: r.ProjectID, Criteria: r.Scores, Comment: r.Comment})
	}
	return d, nil
}

// ---------------------------------------------------------------------------
// CSV

// csvSafe neutralises spreadsheet formula injection: a project title of
// "=HYPERLINK(...)" must not execute when an organizer opens the export.
func csvSafe(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}

func f2(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }

// ScoresCSV writes one row per review with one column per criterion.
func (s *Service) ScoresCSV(ctx context.Context, a Actor, eventID string, w io.Writer) error {
	e, err := s.Event(ctx, a, eventID)
	if err != nil {
		return err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleOrganizer); err != nil {
		return err
	}
	rs, err := s.reviews(ctx, s.DB, "rv.event_id = ?", e.ID)
	if err != nil {
		return err
	}
	titles := map[string][2]string{}
	rows, err := s.DB.QueryContext(ctx, `SELECT p.id, p.title, coalesce(k.name, '') FROM projects p LEFT JOIN tracks k ON k.id = p.track_id WHERE p.event_id = ?`, e.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, title, track string
		rows.Scan(&id, &title, &track)
		titles[id] = [2]string{title, track}
	}
	rows.Close()
	cw := csv.NewWriter(w)
	head := []string{"event_id", "project_id", "project_title", "track", "judge_id", "judge_name"}
	for _, c := range e.Criteria {
		head = append(head, c.Key)
	}
	cw.Write(append(head, "weighted_score", "comment", "updated_at"))
	for _, r := range rs {
		row := []string{e.ID, r.ProjectID, csvSafe(titles[r.ProjectID][0]), csvSafe(titles[r.ProjectID][1]), r.JudgeID, csvSafe(r.JudgeName)}
		for _, c := range e.Criteria {
			if v, ok := r.Scores[c.Key]; ok {
				row = append(row, strconv.Itoa(v))
			} else {
				row = append(row, "")
			}
		}
		cw.Write(append(row, f2(r.Composite), csvSafe(r.Comment), store.FormatTime(r.UpdatedAt)))
	}
	cw.Flush()
	return cw.Error()
}

// ResultsCSV writes the normalized ranking with every method side by side.
func (s *Service) ResultsCSV(ctx context.Context, a Actor, eventID string, w io.Writer) error {
	res, err := s.Results(ctx, a, eventID, 300)
	if err != nil {
		return err
	}
	cw := csv.NewWriter(w)
	cw.Write([]string{"rank", "project_id", "title", "team", "track", "reviews", "adjusted_score", "adjusted_se",
		"rank_90_low", "rank_90_high", fmt.Sprintf("prob_top_%d", res.Report.TopK), "raw_mean", "raw_rank",
		"rank_change_vs_raw", "zscore_rank", "bias_only_rank", "pairwise_induced_rank", "provisional"})
	for _, r := range res.Rows {
		cw.Write([]string{
			strconv.Itoa(r.Ranks[judging.MethodBiasScale]), r.Project.ID, csvSafe(r.Project.Title), csvSafe(r.Project.TeamName),
			csvSafe(r.Project.TrackName), strconv.Itoa(r.Reviews), f2(r.Scores[judging.MethodBiasScale]), f2(r.SE),
			strconv.Itoa(r.RankLow), strconv.Itoa(r.RankHigh), f2(r.ProbTopK), f2(r.Scores[judging.MethodRaw]),
			strconv.Itoa(r.Ranks[judging.MethodRaw]), strconv.Itoa(r.RankChange), strconv.Itoa(r.Ranks[judging.MethodZScore]),
			strconv.Itoa(r.Ranks[judging.MethodBias]), strconv.Itoa(r.Ranks[judging.MethodPairwise]), strconv.FormatBool(r.Provisional),
		})
	}
	cw.Flush()
	return cw.Error()
}

// AuditLog returns entries for an organizer's event plus the chain verification.
func (s *Service) AuditLog(ctx context.Context, a Actor, eventID string, limit int) ([]store.AuditEntry, store.AuditVerification, error) {
	var v store.AuditVerification
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, v, err
	}
	entries, err := store.AuditEntries(ctx, s.DB, eventID, limit)
	if err != nil {
		return nil, v, err
	}
	v, err = store.VerifyAudit(ctx, s.DB)
	return entries, v, err
}

// UserNames maps user ids to display names (for the audit view).
func (s *Service) UserNames(ctx context.Context, ids []string) map[string]string {
	out := map[string]string{}
	for _, id := range ids {
		if id == "" || out[id] != "" {
			continue
		}
		var name string
		if s.DB.QueryRowContext(ctx, `SELECT name FROM users WHERE id = ?`, id).Scan(&name) == nil {
			out[id] = name
		}
	}
	return out
}
