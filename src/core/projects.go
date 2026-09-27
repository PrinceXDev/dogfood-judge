package core

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"sort"
	"strings"
	"time"

	"dogfood/src/store"
)

type Project struct {
	ID                 string     `json:"id"`
	EventID            string     `json:"event_id"`
	TeamID             string     `json:"team_id"`
	TeamName           string     `json:"team_name"`
	TrackID            string     `json:"track_id,omitempty"`
	TrackName          string     `json:"track_name,omitempty"`
	Title              string     `json:"title"`
	Summary            string     `json:"summary"`
	Description        string     `json:"description"`
	RepoURL            string     `json:"repo_url"`
	DemoURL            string     `json:"demo_url"`
	Status             string     `json:"status"`
	SubmittedAt        *time.Time `json:"submitted_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	DuplicateOf        string     `json:"duplicate_of,omitempty"`
	DisqualifiedReason string     `json:"disqualified_reason,omitempty"`
}

const projectCols = `p.id, p.event_id, p.team_id, t.name, coalesce(p.track_id, ''), coalesce(k.name, ''), p.title, p.summary,
	p.description, p.repo_url, p.demo_url, p.status, p.submitted_at, p.updated_at, coalesce(p.duplicate_of, ''),
	coalesce(p.disqualified_reason, '')`

const projectFrom = ` FROM projects p JOIN teams t ON t.id = p.team_id LEFT JOIN tracks k ON k.id = p.track_id`

func scanProject(row interface{ Scan(...any) error }) (*Project, error) {
	var p Project
	var submitted sql.NullString
	var updated string
	err := row.Scan(&p.ID, &p.EventID, &p.TeamID, &p.TeamName, &p.TrackID, &p.TrackName, &p.Title, &p.Summary,
		&p.Description, &p.RepoURL, &p.DemoURL, &p.Status, &submitted, &updated, &p.DuplicateOf, &p.DisqualifiedReason)
	if err != nil {
		return nil, err
	}
	p.SubmittedAt, p.UpdatedAt = nullTime(submitted), mustTime(updated)
	return &p, nil
}

func timeMinutes(m int) time.Duration { return time.Duration(m) * time.Minute }

type GalleryFilter struct {
	EventID string // id or slug; empty = all public events
	Query   string
	TrackID string
	Page    int
}

type GalleryPage struct {
	Projects []*Project `json:"projects"`
	Total    int        `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"page_size"`
}

const GalleryPageSize = 60

// Gallery is public: submitted, non-duplicate projects of public events.
func (s *Service) Gallery(ctx context.Context, f GalleryFilter) (*GalleryPage, error) {
	where := []string{"p.status = 'submitted'", "p.duplicate_of IS NULL", "p.disqualified_reason IS NULL",
		"p.event_id IN (SELECT id FROM events WHERE is_public = 1)"}
	var args []any
	if f.EventID != "" {
		where = append(where, "p.event_id IN (SELECT id FROM events WHERE id = ? OR slug = ?)")
		args = append(args, f.EventID, f.EventID)
	}
	if f.TrackID != "" {
		where = append(where, "p.track_id = ?")
		args = append(args, f.TrackID)
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		like := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q) + "%"
		where = append(where, `(p.title LIKE ? ESCAPE '\' OR p.summary LIKE ? ESCAPE '\' OR t.name LIKE ? ESCAPE '\' OR k.name LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like, like)
	}
	cond := " WHERE " + strings.Join(where, " AND ")
	page := &GalleryPage{Page: max(f.Page, 1), PageSize: GalleryPageSize}
	if err := s.DB.QueryRowContext(ctx, `SELECT count(*)`+projectFrom+cond, args...).Scan(&page.Total); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT `+projectCols+projectFrom+cond+` ORDER BY p.title COLLATE NOCASE, p.id LIMIT ? OFFSET ?`,
		append(args, GalleryPageSize, (page.Page-1)*GalleryPageSize)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		page.Projects = append(page.Projects, p)
	}
	return page, rows.Err()
}

// Project returns one project. Submitted projects of public events are public;
// drafts are visible only to the team and the event's organizers.
func (s *Service) Project(ctx context.Context, a Actor, id string) (*Project, error) {
	p, err := scanProject(s.DB.QueryRowContext(ctx, `SELECT `+projectCols+projectFrom+` WHERE p.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound("project")
	}
	if err != nil {
		return nil, err
	}
	e, err := s.event(ctx, s.DB, p.EventID)
	if err != nil {
		return nil, err
	}
	if p.Status == "submitted" && e.IsPublic {
		return p, nil
	}
	if a.LoggedIn() {
		if s.isMember(ctx, s.DB, p.TeamID, a.User.ID) {
			return p, nil
		}
		roles, err := s.Roles(ctx, a, p.EventID)
		if err != nil {
			return nil, err
		}
		if roles[RoleOrganizer] || (roles[RoleJudge] && p.Status == "submitted") {
			return p, nil
		}
	}
	return nil, errNotFound("project")
}

func (s *Service) isMember(ctx context.Context, q store.Queryer, teamID, userID string) bool {
	var n int
	q.QueryRowContext(ctx, `SELECT count(*) FROM team_members WHERE team_id = ? AND user_id = ?`, teamID, userID).Scan(&n)
	return n > 0
}

// deadlineFor is the team's effective deadline: the event close or a granted extension.
func (s *Service) deadlineFor(ctx context.Context, q store.Queryer, e *Event, teamID string) time.Time {
	var until string
	if q.QueryRowContext(ctx, `SELECT until FROM deadline_extensions WHERE event_id = ? AND team_id = ?`, e.ID, teamID).Scan(&until) == nil {
		if t := mustTime(until); t.After(e.SubmissionsCloseAt) {
			return t
		}
	}
	return e.SubmissionsCloseAt
}

var errSubmissionsClosed = &Error{KindForbidden, "submissions_closed", "submissions for this event are closed"}

type ProjectInput struct {
	Title       string `json:"title"`
	Summary     string `json:"summary"`
	Description string `json:"description"`
	RepoURL     string `json:"repo_url"`
	DemoURL     string `json:"demo_url"`
	TrackID     string `json:"track_id"`
	Submit      bool   `json:"submit"` // true: submit now; false: save as draft
}

func cleanURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(raw) > 500 {
		return "", errInvalid("invalid_url", "links must be http(s) URLs")
	}
	return u.String(), nil
}

func (in *ProjectInput) validate(e *Event) error {
	in.Title, in.Summary = strings.TrimSpace(in.Title), strings.TrimSpace(in.Summary)
	if in.Title == "" || len([]rune(in.Title)) > 120 {
		return errInvalid("invalid_title", "title must be 1 to 120 characters")
	}
	if len([]rune(in.Summary)) > 280 {
		return errInvalid("invalid_summary", "summary must be at most 280 characters")
	}
	if len(in.Description) > 20000 {
		return errInvalid("invalid_description", "description must be at most 20000 characters")
	}
	var err error
	if in.RepoURL, err = cleanURL(in.RepoURL); err != nil {
		return err
	}
	if in.DemoURL, err = cleanURL(in.DemoURL); err != nil {
		return err
	}
	if in.TrackID != "" {
		ok := false
		for _, t := range e.Tracks {
			ok = ok || t.ID == in.TrackID
		}
		if !ok {
			return errInvalid("invalid_track", "track does not belong to this event")
		}
	}
	if in.Submit && len(e.Tracks) > 0 && in.TrackID == "" {
		return errInvalid("track_required", "choose a track before submitting")
	}
	return nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// CreateProject creates the team's project. The deadline is checked before
// anything that depends on the caller's team, so a late request is always
// refused as late, whatever else is wrong with it.
func (s *Service) CreateProject(ctx context.Context, a Actor, eventID string, in ProjectInput) (*Project, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleParticipant); err != nil {
		return nil, err
	}
	team, err := s.MyTeam(ctx, a, e.ID)
	if err != nil && ErrorKind(err) != KindNotFound {
		return nil, err
	}
	deadline := e.SubmissionsCloseAt
	if team != nil {
		deadline = s.deadlineFor(ctx, s.DB, e, team.ID)
	}
	if !s.now().Before(deadline) {
		return nil, errSubmissionsClosed
	}
	if s.now().Before(e.SubmissionsOpenAt) {
		return nil, &Error{KindForbidden, "submissions_not_open", "submissions have not opened yet"}
	}
	if team == nil {
		return nil, errConflict("no_team", "create or join a team first")
	}
	if team.Project != nil {
		return nil, errConflict("project_exists", "your team already has a project; edit it instead")
	}
	if err := s.loadEventChildren(ctx, e); err != nil {
		return nil, err
	}
	if err := in.validate(e); err != nil {
		return nil, err
	}
	id := store.NewID("prj")
	now := s.nowS()
	status, submitted := "draft", any(nil)
	if in.Submit {
		status, submitted = "submitted", now
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO projects (id, event_id, team_id, track_id, title, summary, description,
			repo_url, demo_url, status, submitted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, e.ID, team.ID, nullIfEmpty(in.TrackID), in.Title, in.Summary, in.Description, in.RepoURL, in.DemoURL,
			status, submitted, now, now)
		if err != nil {
			return mapProjectErr(err)
		}
		if err := s.audit(ctx, tx, a, e.ID, "project.create", id, map[string]any{"title": in.Title, "status": status}); err != nil {
			return err
		}
		if in.Submit {
			s.enqueueHook(ctx, tx, e.ID, "project.submitted", map[string]any{"project_id": id, "title": in.Title})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Project(ctx, a, id)
}

func mapProjectErr(err error) error {
	switch {
	case store.IsConstraint(err, "submissions_closed"):
		return errSubmissionsClosed
	case store.IsConstraint(err, "projects_one_per_team"), store.IsConstraint(err, "UNIQUE constraint failed: projects.team_id"):
		return errConflict("project_exists", "your team already has a project")
	}
	return err
}

// UpdateProject edits a draft or submitted project until the team's deadline.
func (s *Service) UpdateProject(ctx context.Context, a Actor, projectID string, in ProjectInput) (*Project, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	p, err := s.Project(ctx, a, projectID)
	if err != nil {
		return nil, err
	}
	if !s.isMember(ctx, s.DB, p.TeamID, a.User.ID) {
		return nil, errForbidden("only team members can edit this project")
	}
	e, err := s.event(ctx, s.DB, p.EventID)
	if err != nil {
		return nil, err
	}
	if !s.now().Before(s.deadlineFor(ctx, s.DB, e, p.TeamID)) {
		return nil, errSubmissionsClosed
	}
	if err := s.loadEventChildren(ctx, e); err != nil {
		return nil, err
	}
	if err := in.validate(e); err != nil {
		return nil, err
	}
	now := s.nowS()
	status := p.Status
	var submittedAt any
	if p.SubmittedAt != nil {
		submittedAt = store.FormatTime(*p.SubmittedAt)
	}
	newlySubmitted := in.Submit && p.Status == "draft"
	if newlySubmitted {
		status, submittedAt = "submitted", now
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE projects SET title = ?, summary = ?, description = ?, repo_url = ?, demo_url = ?,
			track_id = ?, status = ?, submitted_at = ?, updated_at = ? WHERE id = ?`,
			in.Title, in.Summary, in.Description, in.RepoURL, in.DemoURL, nullIfEmpty(in.TrackID), status, submittedAt, now, p.ID)
		if err != nil {
			return mapProjectErr(err)
		}
		action := "project.update"
		if newlySubmitted {
			action = "project.submit"
			s.enqueueHook(ctx, tx, e.ID, "project.submitted", map[string]any{"project_id": p.ID, "title": in.Title})
		}
		return s.audit(ctx, tx, a, e.ID, action, p.ID, map[string]any{"title": in.Title, "status": status})
	})
	if err != nil {
		return nil, err
	}
	return s.Project(ctx, a, p.ID)
}

// DuplicateCandidates finds projects in the same event that share a
// normalised repository URL or title: the usual shape of a double submission.
func (s *Service) DuplicateCandidates(ctx context.Context, a Actor, eventID string) ([][2]*Project, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT `+projectCols+projectFrom+` WHERE p.event_id = ? ORDER BY p.submitted_at, p.id`, eventID)
	if err != nil {
		return nil, err
	}
	var all []*Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, p)
	}
	rows.Close()
	return findDuplicates(all), nil
}

func normRepo(u string) string {
	u = strings.ToLower(strings.TrimSpace(u))
	u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
	u = strings.TrimPrefix(u, "www.")
	return strings.TrimSuffix(strings.TrimSuffix(u, "/"), ".git")
}

func normTitle(t string) string {
	return strings.Join(strings.Fields(strings.ToLower(t)), " ")
}

// findDuplicates pairs each later project with the earliest one it matches.
func findDuplicates(ps []*Project) [][2]*Project {
	var out [][2]*Project
	firstByKey := map[string]*Project{}
	for _, p := range ps {
		keys := []string{"t:" + p.EventID + ":" + normTitle(p.Title)}
		if r := normRepo(p.RepoURL); r != "" {
			keys = append(keys, "r:"+p.EventID+":"+r)
		}
		var orig *Project
		for _, k := range keys {
			if f, ok := firstByKey[k]; ok && orig == nil {
				orig = f
			}
		}
		if orig != nil {
			out = append(out, [2]*Project{orig, p})
			continue
		}
		for _, k := range keys {
			firstByKey[k] = p
		}
	}
	return out
}

// MarkDuplicate hides a project from the gallery and rankings as a duplicate
// of another (or clears the flag when ofID is ""). Scores are kept, not deleted.
func (s *Service) MarkDuplicate(ctx context.Context, a Actor, projectID, ofID string) error {
	p, err := s.Project(ctx, a, projectID)
	if err != nil {
		return err
	}
	if err := s.require(ctx, s.DB, a, p.EventID, RoleOrganizer); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if ofID != "" {
			var n int
			tx.QueryRowContext(ctx, `SELECT count(*) FROM projects WHERE id = ? AND event_id = ? AND id <> ?`, ofID, p.EventID, p.ID).Scan(&n)
			if n == 0 {
				return errInvalid("invalid_original", "the original must be another project in the same event")
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE projects SET duplicate_of = ? WHERE id = ?`, nullIfEmpty(ofID), p.ID)
		if err != nil {
			return mapProjectErr(err)
		}
		return s.audit(ctx, tx, a, p.EventID, "project.duplicate", p.ID, map[string]any{"duplicate_of": ofID})
	})
}

func (s *Service) Disqualify(ctx context.Context, a Actor, projectID, reason string) error {
	p, err := s.Project(ctx, a, projectID)
	if err != nil {
		return err
	}
	if err := s.require(ctx, s.DB, a, p.EventID, RoleOrganizer); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE projects SET disqualified_reason = ? WHERE id = ?`, nullIfEmpty(strings.TrimSpace(reason)), p.ID); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, p.EventID, "project.disqualify", p.ID, map[string]any{"reason": reason})
	})
}

// EventProjects lists every project of an event for organizers (drafts included).
func (s *Service) EventProjects(ctx context.Context, a Actor, eventID string) ([]*Project, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT `+projectCols+projectFrom+` WHERE p.event_id = ? ORDER BY p.title COLLATE NOCASE`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// FindDuplicatesForReport runs duplicate detection over projects that are not
// in the database (the offline proof CLI), earliest submission first.
func FindDuplicatesForReport(ps []*Project) [][2]*Project {
	sorted := append([]*Project(nil), ps...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i].SubmittedAt, sorted[j].SubmittedAt
		return a != nil && (b == nil || a.Before(*b))
	})
	return findDuplicates(sorted)
}
