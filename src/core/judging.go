package core

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand/v2"
	"sort"
	"strings"
	"time"

	"dogfood/src/judging"
	"dogfood/src/store"
)

// ---------------------------------------------------------------------------
// Assignment

type JudgeSummary struct {
	User     User     `json:"user"`
	Tracks   []string `json:"tracks"`
	Assigned int      `json:"assigned"`
	Done     int      `json:"done"`
}

func (s *Service) Judges(ctx context.Context, a Actor, eventID string) ([]JudgeSummary, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT u.id, u.email, u.name,
		(SELECT count(*) FROM assignments x WHERE x.event_id = r.event_id AND x.judge_id = u.id AND x.status <> 'recused'),
		(SELECT count(*) FROM assignments x WHERE x.event_id = r.event_id AND x.judge_id = u.id AND x.status = 'done'),
		coalesce((SELECT group_concat(track_id) FROM judge_tracks t WHERE t.event_id = r.event_id AND t.user_id = u.id), '')
		FROM event_roles r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? AND r.role = 'judge' ORDER BY u.name`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []JudgeSummary
	for rows.Next() {
		var j JudgeSummary
		var tracks string
		if err := rows.Scan(&j.User.ID, &j.User.Email, &j.User.Name, &j.Assigned, &j.Done, &tracks); err != nil {
			return nil, err
		}
		if tracks != "" {
			j.Tracks = strings.Split(tracks, ",")
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// RunAssignment tops every eligible project up to the event's reviews-per-project.
func (s *Service) RunAssignment(ctx context.Context, a Actor, eventID string) (*judging.AssignReport, error) {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleOrganizer); err != nil {
		return nil, err
	}
	var rep *judging.AssignReport
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		in, err := s.assignInput(ctx, tx, e)
		if err != nil {
			return err
		}
		rep = judging.Assign(in)
		for _, n := range rep.New {
			if _, err := tx.ExecContext(ctx, `INSERT INTO assignments (event_id, judge_id, project_id, status, reason, assigned_at)
				VALUES (?, ?, ?, 'pending', ?, ?)`, e.ID, n.Judge, n.Project, n.Reason, s.nowS()); err != nil {
				return err
			}
		}
		return s.audit(ctx, tx, a, e.ID, "assignment.run", e.ID, map[string]any{
			"new": len(rep.New), "components": rep.Components, "load_min": rep.LoadMin, "load_max": rep.LoadMax,
			"underfilled": len(rep.Underfilled), "off_track": rep.OffTrack})
	})
	return rep, err
}

func (s *Service) assignInput(ctx context.Context, tx *sql.Tx, e *Event) (judging.AssignInput, error) {
	in := judging.AssignInput{PerProject: e.ReviewsPerProject, Seed: seedFrom(e.ID)}
	rows, err := tx.QueryContext(ctx, `SELECT r.user_id, coalesce((SELECT group_concat(track_id) FROM judge_tracks t
		WHERE t.event_id = r.event_id AND t.user_id = r.user_id), '')
		FROM event_roles r WHERE r.event_id = ? AND r.role = 'judge' ORDER BY r.user_id`, e.ID)
	if err != nil {
		return in, err
	}
	for rows.Next() {
		var j judging.JudgeInfo
		var tracks string
		rows.Scan(&j.ID, &tracks)
		if tracks != "" {
			j.Tracks = strings.Split(tracks, ",")
		}
		in.Judges = append(in.Judges, j)
	}
	rows.Close()
	// Conflicts: a judge whose email is on a project's team (belt and braces;
	// the event_roles trigger already stops judges joining teams).
	rows, err = tx.QueryContext(ctx, `SELECT r.user_id, p.id FROM event_roles r
		JOIN team_members m ON m.user_id = r.user_id JOIN projects p ON p.team_id = m.team_id
		WHERE r.event_id = ? AND r.role = 'judge' AND p.event_id = ?`, e.ID, e.ID)
	if err != nil {
		return in, err
	}
	conflicts := map[string][]string{}
	for rows.Next() {
		var j, p string
		rows.Scan(&j, &p)
		conflicts[j] = append(conflicts[j], p)
	}
	rows.Close()
	for i := range in.Judges {
		in.Judges[i].Conflict = conflicts[in.Judges[i].ID]
	}
	rows, err = tx.QueryContext(ctx, `SELECT id, coalesce(track_id, '') FROM projects
		WHERE event_id = ? AND status = 'submitted' AND duplicate_of IS NULL AND disqualified_reason IS NULL ORDER BY id`, e.ID)
	if err != nil {
		return in, err
	}
	for rows.Next() {
		var p judging.ProjectInfo
		rows.Scan(&p.ID, &p.Track)
		in.Projects = append(in.Projects, p)
	}
	rows.Close()
	rows, err = tx.QueryContext(ctx, `SELECT judge_id, project_id, status FROM assignments WHERE event_id = ?`, e.ID)
	if err != nil {
		return in, err
	}
	defer rows.Close()
	for rows.Next() {
		var p judging.Pair
		var status string
		rows.Scan(&p.Judge, &p.Project, &status)
		if status == "recused" {
			in.Recused = append(in.Recused, p)
		} else {
			in.Existing = append(in.Existing, p)
		}
	}
	return in, rows.Err()
}

func seedFrom(s string) uint64 {
	var h uint64 = 1469598103934665603
	for i := 0; i < len(s); i++ {
		h = (h ^ uint64(s[i])) * 1099511628211
	}
	return h
}

// Recuse lets a judge decline an assignment (declared conflict). The engine
// will not re-create the pair and the organizer can re-run assignment.
func (s *Service) Recuse(ctx context.Context, a Actor, eventID, projectID, reason string) error {
	if err := s.require(ctx, s.DB, a, eventID, RoleJudge); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE assignments SET status = 'recused' WHERE event_id = ? AND judge_id = ? AND project_id = ? AND status = 'pending'`,
			eventID, a.User.ID, projectID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errNotFound("pending assignment")
		}
		return s.audit(ctx, tx, a, eventID, "assignment.recuse", projectID, map[string]any{"reason": reason})
	})
}

// ---------------------------------------------------------------------------
// Reviews

type Assignment struct {
	EventID   string   `json:"event_id"`
	EventName string   `json:"event_name"`
	EventSlug string   `json:"event_slug"`
	Project   *Project `json:"project"`
	Status    string   `json:"status"`
	Reason    string   `json:"reason"`
	Review    *Review  `json:"review,omitempty"`
}

type Review struct {
	JudgeID   string         `json:"judge_id"`
	JudgeName string         `json:"judge_name,omitempty"`
	ProjectID string         `json:"project_id"`
	EventID   string         `json:"event_id"`
	Scores    map[string]int `json:"scores"` // criterion key -> value
	Composite float64        `json:"composite"`
	Comment   string         `json:"comment"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// MyAssignments lists the caller's assignments (optionally for one event).
func (s *Service) MyAssignments(ctx context.Context, a Actor, eventID string) ([]Assignment, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	q := `SELECT x.event_id, e.name, e.slug, x.status, x.reason, ` + projectCols + projectFrom + `
		JOIN assignments x ON x.project_id = p.id JOIN events e ON e.id = x.event_id
		WHERE x.judge_id = ? AND x.status <> 'recused'`
	args := []any{a.User.ID}
	if eventID != "" {
		q += ` AND (e.id = ? OR e.slug = ?)`
		args = append(args, eventID, eventID)
	}
	rows, err := s.DB.QueryContext(ctx, q+` ORDER BY e.submissions_close_at DESC, x.status DESC, p.title`, args...)
	if err != nil {
		return nil, err
	}
	var out []Assignment
	for rows.Next() {
		var as Assignment
		var p Project
		var submitted sql.NullString
		var updated string
		if err := rows.Scan(&as.EventID, &as.EventName, &as.EventSlug, &as.Status, &as.Reason,
			&p.ID, &p.EventID, &p.TeamID, &p.TeamName, &p.TrackID, &p.TrackName, &p.Title, &p.Summary,
			&p.Description, &p.RepoURL, &p.DemoURL, &p.Status, &submitted, &updated, &p.DuplicateOf, &p.DisqualifiedReason); err != nil {
			rows.Close()
			return nil, err
		}
		p.SubmittedAt, p.UpdatedAt = nullTime(submitted), mustTime(updated)
		as.Project = &p
		out = append(out, as)
	}
	rows.Close()
	reviews, err := s.reviews(ctx, s.DB, "rv.judge_id = ?", a.User.ID)
	if err != nil {
		return nil, err
	}
	byProject := map[string]*Review{}
	for _, r := range reviews {
		byProject[r.ProjectID] = r
	}
	for i := range out {
		out[i].Review = byProject[out[i].Project.ID]
	}
	return out, nil
}

// reviews loads reviews matching a WHERE fragment on the reviews table (alias rv).
func (s *Service) reviews(ctx context.Context, q store.Queryer, where string, args ...any) ([]*Review, error) {
	rows, err := q.QueryContext(ctx, `SELECT rv.judge_id, u.name, rv.project_id, rv.event_id, rv.comment, rv.updated_at,
		c.key, c.weight, rs.value
		FROM reviews rv JOIN users u ON u.id = rv.judge_id
		JOIN review_scores rs ON rs.judge_id = rv.judge_id AND rs.project_id = rv.project_id
		JOIN criteria c ON c.id = rs.criterion_id
		WHERE `+where+` ORDER BY rv.event_id, rv.project_id, rv.judge_id, c.position`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Review
	idx := map[[2]string]*Review{}
	weights := map[*Review][2]float64{}
	for rows.Next() {
		var jid, jname, pid, eid, comment, updated, key string
		var w float64
		var v int
		if err := rows.Scan(&jid, &jname, &pid, &eid, &comment, &updated, &key, &w, &v); err != nil {
			return nil, err
		}
		r := idx[[2]string{jid, pid}]
		if r == nil {
			r = &Review{JudgeID: jid, JudgeName: jname, ProjectID: pid, EventID: eid, Comment: comment,
				UpdatedAt: mustTime(updated), Scores: map[string]int{}}
			idx[[2]string{jid, pid}] = r
			out = append(out, r)
		}
		r.Scores[key] = v
		acc := weights[r]
		weights[r] = [2]float64{acc[0] + w*float64(v), acc[1] + w}
	}
	for r, acc := range weights {
		if acc[1] > 0 {
			r.Composite = acc[0] / acc[1]
		}
	}
	return out, rows.Err()
}

// SubmitReview creates or updates the caller's review of an assigned project.
func (s *Service) SubmitReview(ctx context.Context, a Actor, eventID, projectID string, scores map[string]int, comment string) (*Review, error) {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleJudge); err != nil {
		return nil, err
	}
	if !e.JudgingOpen(s.now()) {
		return nil, &Error{KindForbidden, "judging_closed", "judging is not open for this event"}
	}
	// Authorization before validation: an unassigned judge learns nothing about the rubric.
	var status string
	err = s.DB.QueryRowContext(ctx, `SELECT status FROM assignments WHERE event_id = ? AND judge_id = ? AND project_id = ?`,
		e.ID, a.User.ID, projectID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) || status == "recused" {
		return nil, errForbidden("this project is not assigned to you")
	}
	if err != nil {
		return nil, err
	}
	if len(comment) > 5000 {
		return nil, errInvalid("invalid_comment", "comment must be at most 5000 characters")
	}
	crit, err := s.criteria(ctx, s.DB, e.ID)
	if err != nil {
		return nil, err
	}
	for _, c := range crit {
		v, ok := scores[c.Key]
		if !ok {
			return nil, errInvalid("missing_score", "missing score for %q", c.Name)
		}
		if v < c.ScaleMin || v > c.ScaleMax {
			return nil, errInvalid("score_out_of_range", "%s must be between %d and %d", c.Name, c.ScaleMin, c.ScaleMax)
		}
	}
	for k := range scores {
		found := false
		for _, c := range crit {
			found = found || c.Key == k
		}
		if !found {
			return nil, errInvalid("unknown_criterion", "unknown criterion %q", k)
		}
	}
	now := s.nowS()
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var status string
		err := tx.QueryRowContext(ctx, `SELECT status FROM assignments WHERE event_id = ? AND judge_id = ? AND project_id = ?`,
			e.ID, a.User.ID, projectID).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) || status == "recused" {
			return errForbidden("this project is not assigned to you")
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO reviews (event_id, judge_id, project_id, comment, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(judge_id, project_id) DO UPDATE SET comment = excluded.comment, updated_at = excluded.updated_at`,
			e.ID, a.User.ID, projectID, strings.TrimSpace(comment), now, now); err != nil {
			return err
		}
		for _, c := range crit {
			if _, err := tx.ExecContext(ctx, `INSERT INTO review_scores (judge_id, project_id, criterion_id, value) VALUES (?, ?, ?, ?)
				ON CONFLICT(judge_id, project_id, criterion_id) DO UPDATE SET value = excluded.value`,
				a.User.ID, projectID, c.ID, scores[c.Key]); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE assignments SET status = 'done', completed_at = coalesce(completed_at, ?)
			WHERE judge_id = ? AND project_id = ?`, now, a.User.ID, projectID); err != nil {
			return err
		}
		action := "review.submit"
		if status == "done" {
			action = "review.update"
		}
		// Values go in the audit trail so a later edit is visible to the organizer.
		if err := s.audit(ctx, tx, a, e.ID, action, projectID, map[string]any{"scores": scores}); err != nil {
			return err
		}
		s.enqueueHook(ctx, tx, e.ID, "review.submitted", map[string]any{"project_id": projectID, "judge_id": a.User.ID})
		return nil
	})
	if err != nil {
		return nil, err
	}
	rs, err := s.reviews(ctx, s.DB, "rv.judge_id = ? AND rv.project_id = ?", a.User.ID, projectID)
	if err != nil || len(rs) == 0 {
		return nil, err
	}
	return rs[0], nil
}

// JudgeScores is the endpoint the acceptance checker probes. A judge may read
// only their own reviews. Asking for anyone else's is refused outright (403),
// not filtered to an empty list, unless the caller organizes an event, in
// which case they see that judge's reviews for the events they organize.
func (s *Service) JudgeScores(ctx context.Context, a Actor, judgeID, eventID string) ([]*Review, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	if judgeID == "" || judgeID == a.User.ID {
		var n int
		if err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM event_roles WHERE user_id = ? AND role = 'judge'`, a.User.ID).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			return nil, errForbidden("only judges have scores")
		}
		where, args := "rv.judge_id = ?", []any{a.User.ID}
		if eventID != "" {
			where += " AND rv.event_id IN (SELECT id FROM events WHERE id = ? OR slug = ?)"
			args = append(args, eventID, eventID)
		}
		return s.reviews(ctx, s.DB, where, args...)
	}
	// A different judge was requested: organizers only, and only for their events.
	where := "rv.judge_id = ?"
	args := []any{judgeID}
	if !a.User.IsAdmin {
		where += " AND rv.event_id IN (SELECT event_id FROM event_roles WHERE user_id = ? AND role = 'organizer')"
		args = append(args, a.User.ID)
		var n int
		if err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM event_roles WHERE user_id = ? AND role = 'organizer'`, a.User.ID).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			return nil, errForbidden("judges can only read their own scores")
		}
	}
	if eventID != "" {
		where += " AND rv.event_id IN (SELECT id FROM events WHERE id = ? OR slug = ?)"
		args = append(args, eventID, eventID)
	}
	return s.reviews(ctx, s.DB, where, args...)
}

// EventReviews returns every review in an event: organizers always; everyone
// else only after results are published, and then without judge identities.
func (s *Service) EventReviews(ctx context.Context, a Actor, eventID string) ([]*Review, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	return s.reviews(ctx, s.DB, "rv.event_id = ?", eventID)
}

// ---------------------------------------------------------------------------
// Progress dashboard

type Progress struct {
	EventID         string          `json:"event_id"`
	Phase           string          `json:"phase"`
	Projects        int             `json:"projects"`
	Drafts          int             `json:"drafts"`
	Assignments     int             `json:"assignments"`
	Done            int             `json:"done"`
	Percent         float64         `json:"percent"`
	FullyReviewed   int             `json:"fully_reviewed"`
	Unassigned      int             `json:"unassigned"` // submitted projects below the review target
	Judges          []JudgeProgress `json:"judges"`
	ReviewHistogram map[int]int     `json:"review_histogram"` // completed reviews -> number of projects
	Comparisons     int             `json:"comparisons"`
	Votes           int             `json:"votes"`
	FlaggedVotes    int             `json:"flagged_votes"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type JudgeProgress struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Assigned int        `json:"assigned"`
	Done     int        `json:"done"`
	LastSeen *time.Time `json:"last_review_at"`
}

func (s *Service) Progress(ctx context.Context, a Actor, eventID string) (*Progress, error) {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleOrganizer); err != nil {
		return nil, err
	}
	p := &Progress{EventID: e.ID, Phase: e.Phase(s.now()), ReviewHistogram: map[int]int{}, UpdatedAt: s.now()}
	live := `event_id = ? AND status = 'submitted' AND duplicate_of IS NULL AND disqualified_reason IS NULL`
	s.DB.QueryRowContext(ctx, `SELECT count(*) FROM projects WHERE `+live, e.ID).Scan(&p.Projects)
	s.DB.QueryRowContext(ctx, `SELECT count(*) FROM projects WHERE event_id = ? AND status = 'draft'`, e.ID).Scan(&p.Drafts)
	s.DB.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(status = 'done'), 0) FROM assignments WHERE event_id = ? AND status <> 'recused'`, e.ID).Scan(&p.Assignments, &p.Done)
	s.DB.QueryRowContext(ctx, `SELECT count(*) FROM comparisons WHERE event_id = ?`, e.ID).Scan(&p.Comparisons)
	s.DB.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(flagged IS NOT NULL), 0) FROM votes WHERE event_id = ?`, e.ID).Scan(&p.Votes, &p.FlaggedVotes)
	if p.Assignments > 0 {
		p.Percent = 100 * float64(p.Done) / float64(p.Assignments)
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT p.id,
		(SELECT count(*) FROM assignments x WHERE x.project_id = p.id AND x.status = 'done'),
		(SELECT count(*) FROM assignments x WHERE x.project_id = p.id AND x.status <> 'recused')
		FROM projects p WHERE p.event_id = ? AND p.status = 'submitted' AND p.duplicate_of IS NULL AND p.disqualified_reason IS NULL`, e.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var done, assigned int
		rows.Scan(&id, &done, &assigned)
		p.ReviewHistogram[done]++
		if done >= e.ReviewsPerProject {
			p.FullyReviewed++
		}
		if assigned < e.ReviewsPerProject {
			p.Unassigned++
		}
	}
	rows.Close()
	rows, err = s.DB.QueryContext(ctx, `SELECT u.id, u.name,
		(SELECT count(*) FROM assignments x WHERE x.event_id = r.event_id AND x.judge_id = u.id AND x.status <> 'recused'),
		(SELECT count(*) FROM assignments x WHERE x.event_id = r.event_id AND x.judge_id = u.id AND x.status = 'done'),
		(SELECT max(updated_at) FROM reviews v WHERE v.event_id = r.event_id AND v.judge_id = u.id)
		FROM event_roles r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? AND r.role = 'judge'
		ORDER BY u.name`, e.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var j JudgeProgress
		var last sql.NullString
		rows.Scan(&j.ID, &j.Name, &j.Assigned, &j.Done, &last)
		j.LastSeen = nullTime(last)
		p.Judges = append(p.Judges, j)
	}
	sort.SliceStable(p.Judges, func(x, y int) bool {
		return completion(p.Judges[x]) < completion(p.Judges[y])
	})
	return p, rows.Err()
}

func completion(j JudgeProgress) float64 {
	if j.Assigned == 0 {
		return 2
	}
	return float64(j.Done) / float64(j.Assigned)
}

// ---------------------------------------------------------------------------
// Results

type ResultRow struct {
	Project *Project `json:"project"`
	*judging.ProjectResult
}

type JudgeRow struct {
	Name string `json:"name"`
	*judging.JudgeResult
}

type Results struct {
	Event     *Event          `json:"event"`
	Report    *judging.Report `json:"report"`
	Rows      []ResultRow     `json:"rows"`
	Judges    []JudgeRow      `json:"judges"`
	Pairwise  []PairwiseRow   `json:"pairwise"`
	Votes     []VoteTally     `json:"votes,omitempty"`
	Excluded  []*Project      `json:"excluded"` // duplicates and disqualified, with reasons
	Published bool            `json:"published"`
}

type PairwiseRow struct {
	Project     *Project `json:"project"`
	Strength    float64  `json:"strength"`
	SE          float64  `json:"se"`
	Comparisons int      `json:"comparisons"`
	Rank        int      `json:"rank"`
}

// Results computes the full judging analysis. Organizers can see it at any
// time; everyone else only after publication, and never with judge identities.
func (s *Service) Results(ctx context.Context, a Actor, eventID string, bootstrap int) (*Results, error) {
	e, err := s.Event(ctx, a, eventID)
	if err != nil {
		return nil, err
	}
	roles, err := s.Roles(ctx, a, e.ID)
	if err != nil {
		return nil, err
	}
	organizer := roles[RoleOrganizer]
	if !organizer && !e.Published() {
		if !a.LoggedIn() {
			return nil, ErrUnauthenticated
		}
		return nil, errForbidden("results are not published yet")
	}
	projects := map[string]*Project{}
	rows, err := s.DB.QueryContext(ctx, `SELECT `+projectCols+projectFrom+` WHERE p.event_id = ? AND p.status = 'submitted'`, e.ID)
	if err != nil {
		return nil, err
	}
	res := &Results{Event: e, Published: e.Published()}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		if p.DuplicateOf != "" || p.DisqualifiedReason != "" {
			res.Excluded = append(res.Excluded, p)
			continue
		}
		projects[p.ID] = p
	}
	rows.Close()
	all, err := s.reviews(ctx, s.DB, "rv.event_id = ?", e.ID)
	if err != nil {
		return nil, err
	}
	var input []judging.Review
	names := map[string]string{}
	for _, r := range all {
		if projects[r.ProjectID] == nil {
			continue
		}
		input = append(input, judging.Review{Judge: r.JudgeID, Project: r.ProjectID, Score: r.Composite})
		names[r.JudgeID] = r.JudgeName
	}
	res.Report = s.analyze(e, input, bootstrap)
	ranked := map[string]bool{}
	for _, pr := range res.Report.Projects {
		ranked[pr.Project] = true
		res.Rows = append(res.Rows, ResultRow{Project: projects[pr.Project], ProjectResult: pr})
	}
	// Projects nobody has reviewed yet are listed last rather than silently
	// missing, so an organizer can see the gap before publishing.
	var unreviewed []string
	for id := range projects {
		if !ranked[id] {
			unreviewed = append(unreviewed, id)
		}
	}
	sort.Strings(unreviewed)
	for _, id := range unreviewed {
		res.Rows = append(res.Rows, ResultRow{Project: projects[id], ProjectResult: &judging.ProjectResult{
			Project: id, Scores: map[string]float64{}, Ranks: map[string]int{}, Provisional: true}})
	}
	if organizer {
		for _, j := range res.Report.Judges {
			res.Judges = append(res.Judges, JudgeRow{Name: names[j.Judge], JudgeResult: j})
		}
	} else {
		res.Report.Judges = nil // judge diagnostics are for organizers only
	}
	res.Pairwise, err = s.pairwiseRanking(ctx, e.ID, projects)
	if err != nil {
		return nil, err
	}
	res.Votes, err = s.voteTally(ctx, e.ID, projects)
	return res, err
}

func (s *Service) Publish(ctx context.Context, a Actor, eventID string, publish bool) error {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleOrganizer); err != nil {
		return err
	}
	if publish && e.VotingOpen(s.now()) {
		return errConflict("voting_open", "cannot publish while community voting is open")
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var v any
		action := "results.unpublish"
		if publish {
			v, action = s.nowS(), "results.publish"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE events SET results_published_at = ? WHERE id = ?`, v, e.ID); err != nil {
			return err
		}
		if publish {
			s.enqueueHook(ctx, tx, e.ID, "results.published", map[string]any{"event_id": e.ID})
		}
		return s.audit(ctx, tx, a, e.ID, action, e.ID, nil)
	})
}

// ---------------------------------------------------------------------------
// Pairwise mode

type PairOffer struct {
	EventID string   `json:"event_id"`
	A       *Project `json:"a"`
	B       *Project `json:"b"`
	Done    int      `json:"done"` // comparisons this judge has made
}

// NextPair returns the judge's current pair, choosing a new informative one if needed.
func (s *Service) NextPair(ctx context.Context, a Actor, eventID string) (*PairOffer, error) {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleJudge); err != nil {
		return nil, err
	}
	if !e.JudgingOpen(s.now()) {
		return nil, &Error{KindForbidden, "judging_closed", "judging is not open for this event"}
	}
	var offer PairOffer
	offer.EventID = e.ID
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		tx.QueryRowContext(ctx, `SELECT count(*) FROM comparisons WHERE event_id = ? AND judge_id = ?`, e.ID, a.User.ID).Scan(&offer.Done)
		var pa, pb string
		err := tx.QueryRowContext(ctx, `SELECT project_a, project_b FROM pairwise_offers WHERE event_id = ? AND judge_id = ?`, e.ID, a.User.ID).Scan(&pa, &pb)
		if err == nil {
			offer.A, offer.B = &Project{ID: pa}, &Project{ID: pb}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		cands, err := s.pairCandidates(ctx, tx, e.ID, a.User.ID)
		if err != nil {
			return err
		}
		cs, err := s.comparisons(ctx, tx, e.ID)
		if err != nil {
			return err
		}
		seen := map[[2]string]bool{}
		pairCount := map[[2]string]int{}
		for _, c := range cs {
			k := judging.PairKey(c.A, c.B)
			pairCount[k]++
			if c.Judge == a.User.ID {
				seen[k] = true
			}
		}
		fit := judging.FitBT(cs, cands)
		rng := rand.New(rand.NewPCG(seedFrom(a.User.ID), uint64(s.now().UnixNano())))
		x, y, ok := judging.NextPair(fit, cands, seen, pairCount, rng)
		if !ok {
			return nil
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO pairwise_offers (event_id, judge_id, project_a, project_b, offered_at) VALUES (?, ?, ?, ?, ?)`,
			e.ID, a.User.ID, x, y, s.nowS()); err != nil {
			return err
		}
		offer.A, offer.B = &Project{ID: x}, &Project{ID: y}
		return nil
	})
	if err != nil || offer.A == nil {
		return &offer, err
	}
	if offer.A, err = s.Project(ctx, a, offer.A.ID); err != nil {
		return nil, err
	}
	if offer.B, err = s.Project(ctx, a, offer.B.ID); err != nil {
		return nil, err
	}
	return &offer, nil
}

// pairCandidates: live projects in the judge's tracks (all tracks if the judge
// has none), excluding any the judge has a team conflict with.
func (s *Service) pairCandidates(ctx context.Context, tx *sql.Tx, eventID, judgeID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT p.id FROM projects p WHERE p.event_id = ? AND p.status = 'submitted'
		AND p.duplicate_of IS NULL AND p.disqualified_reason IS NULL
		AND (NOT EXISTS (SELECT 1 FROM judge_tracks t WHERE t.event_id = p.event_id AND t.user_id = ?)
		     OR p.track_id IN (SELECT track_id FROM judge_tracks t WHERE t.event_id = p.event_id AND t.user_id = ?))
		AND p.team_id NOT IN (SELECT team_id FROM team_members WHERE user_id = ?)
		AND p.id NOT IN (SELECT project_id FROM assignments WHERE judge_id = ? AND status = 'recused')
		ORDER BY p.id`, eventID, judgeID, judgeID, judgeID, judgeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Service) comparisons(ctx context.Context, q store.Queryer, eventID string) ([]judging.Comparison, error) {
	rows, err := q.QueryContext(ctx, `SELECT judge_id, project_a, project_b, outcome FROM comparisons WHERE event_id = ? ORDER BY id`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []judging.Comparison
	for rows.Next() {
		var c judging.Comparison
		var outcome string
		rows.Scan(&c.Judge, &c.A, &c.B, &outcome)
		switch outcome {
		case "a":
			c.Outcome = 1
		case "b":
			c.Outcome = 0
		default:
			c.Outcome = 0.5
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SubmitComparison records a verdict on the judge's current offer only.
func (s *Service) SubmitComparison(ctx context.Context, a Actor, eventID, projectA, projectB, outcome string) error {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleJudge); err != nil {
		return err
	}
	if !e.JudgingOpen(s.now()) {
		return &Error{KindForbidden, "judging_closed", "judging is not open for this event"}
	}
	if outcome != "a" && outcome != "b" && outcome != "tie" {
		return errInvalid("invalid_outcome", "outcome must be a, b or tie")
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var pa, pb string
		err := tx.QueryRowContext(ctx, `SELECT project_a, project_b FROM pairwise_offers WHERE event_id = ? AND judge_id = ?`, e.ID, a.User.ID).Scan(&pa, &pb)
		if errors.Is(err, sql.ErrNoRows) || pa != projectA || pb != projectB {
			return errConflict("stale_pair", "that is not the pair you were offered; fetch the next pair")
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO comparisons (event_id, judge_id, project_a, project_b, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			e.ID, a.User.ID, pa, pb, outcome, s.nowS()); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM pairwise_offers WHERE event_id = ? AND judge_id = ?`, e.ID, a.User.ID); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, e.ID, "pairwise.compare", pa+","+pb, map[string]any{"outcome": outcome})
	})
}

func (s *Service) pairwiseRanking(ctx context.Context, eventID string, projects map[string]*Project) ([]PairwiseRow, error) {
	cs, err := s.comparisons(ctx, s.DB, eventID)
	if err != nil || len(cs) == 0 {
		return nil, err
	}
	var live []judging.Comparison
	for _, c := range cs {
		if projects[c.A] != nil && projects[c.B] != nil {
			live = append(live, c)
		}
	}
	ids := make([]string, 0, len(projects))
	for id := range projects {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	fit := judging.FitBT(live, ids)
	ranks := judging.RankOf(fit.Strength)
	var out []PairwiseRow
	for _, id := range ids {
		out = append(out, PairwiseRow{Project: projects[id], Strength: fit.Strength[id], SE: fit.SE[id],
			Comparisons: fit.Comparisons[id], Rank: ranks[id]})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rank < out[j].Rank })
	return out, nil
}

// analyze memoises judging.Analyze by a hash of its exact inputs, so the
// results page and exports recompute only when a score, weight or exclusion
// actually changes. The cached report is copied before callers modify it.
func (s *Service) analyze(e *Event, input []judging.Review, bootstrap int) *judging.Report {
	h := sha256.New()
	fmt.Fprintf(h, "%s|%d|%d|", e.ID, e.ReviewsPerProject, bootstrap)
	sorted := append([]judging.Review(nil), input...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Project != sorted[j].Project {
			return sorted[i].Project < sorted[j].Project
		}
		return sorted[i].Judge < sorted[j].Judge
	})
	for _, r := range sorted {
		fmt.Fprintf(h, "%s,%s,%.9f;", r.Judge, r.Project, r.Score)
	}
	key := hex.EncodeToString(h.Sum(nil))
	s.cacheMu.Lock()
	cached, ok := s.cache[key]
	s.cacheMu.Unlock()
	if !ok {
		cached = judging.Analyze(sorted, e.ReviewsPerProject, judging.Options{Bootstrap: bootstrap, Seed: seedFrom(e.ID)})
		s.cacheMu.Lock()
		if len(s.cache) >= 64 {
			s.cache = map[string]*judging.Report{}
		}
		s.cache[key] = cached
		s.cacheMu.Unlock()
	}
	cp := *cached
	return &cp
}
