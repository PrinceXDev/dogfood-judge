package core

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"

	"dogfood/src/store"
)

type Event struct {
	ID                 string     `json:"id"`
	Slug               string     `json:"slug"`
	Name               string     `json:"name"`
	Description        string     `json:"description"`
	SubmissionsOpenAt  time.Time  `json:"submissions_open_at"`
	SubmissionsCloseAt time.Time  `json:"submissions_close_at"`
	JudgingCloseAt     *time.Time `json:"judging_close_at"`
	VotingOpenAt       *time.Time `json:"voting_open_at"`
	VotingCloseAt      *time.Time `json:"voting_close_at"`
	ResultsPublishedAt *time.Time `json:"results_published_at"`
	ReviewsPerProject  int        `json:"reviews_per_project"`
	MaxTeamSize        int        `json:"max_team_size"`
	VotesPerVoter      int        `json:"votes_per_voter"`
	IsPublic           bool       `json:"is_public"`
	CreatedAt          time.Time  `json:"created_at"`

	Tracks   []Track     `json:"tracks,omitempty"`
	Prizes   []Prize     `json:"prizes,omitempty"`
	Criteria []Criterion `json:"criteria,omitempty"`
}

type Track struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Prize struct {
	ID          string `json:"id"`
	TrackID     string `json:"track_id,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Value       string `json:"value"`
}

type Criterion struct {
	ID          string  `json:"id"`
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Weight      float64 `json:"weight"`
	ScaleMin    int     `json:"scale_min"`
	ScaleMax    int     `json:"scale_max"`
}

func (e *Event) SubmissionsOpen(now time.Time) bool {
	return !now.Before(e.SubmissionsOpenAt) && now.Before(e.SubmissionsCloseAt)
}

// JudgingOpen: after submissions close, before the judging deadline (if any),
// and never once results are published.
func (e *Event) JudgingOpen(now time.Time) bool {
	if e.ResultsPublishedAt != nil || now.Before(e.SubmissionsCloseAt) {
		return false
	}
	return e.JudgingCloseAt == nil || now.Before(*e.JudgingCloseAt)
}

func (e *Event) VotingOpen(now time.Time) bool {
	return e.VotingOpenAt != nil && e.VotingCloseAt != nil &&
		!now.Before(*e.VotingOpenAt) && now.Before(*e.VotingCloseAt)
}

func (e *Event) Published() bool { return e.ResultsPublishedAt != nil }

// Phase is a human label for the event's current state.
func (e *Event) Phase(now time.Time) string {
	switch {
	case e.Published():
		return "results published"
	case now.Before(e.SubmissionsOpenAt):
		return "upcoming"
	case e.SubmissionsOpen(now):
		return "submissions open"
	case e.VotingOpen(now):
		return "judging and voting"
	case e.JudgingOpen(now):
		return "judging"
	default:
		return "awaiting results"
	}
}

const eventCols = `id, slug, name, description, submissions_open_at, submissions_close_at, judging_close_at,
	voting_open_at, voting_close_at, results_published_at, reviews_per_project, max_team_size,
	votes_per_voter, is_public, created_at`

func scanEvent(row interface{ Scan(...any) error }) (*Event, error) {
	var e Event
	var open, close, created string
	var jc, vo, vc, rp sql.NullString
	err := row.Scan(&e.ID, &e.Slug, &e.Name, &e.Description, &open, &close, &jc, &vo, &vc, &rp,
		&e.ReviewsPerProject, &e.MaxTeamSize, &e.VotesPerVoter, &e.IsPublic, &created)
	if err != nil {
		return nil, err
	}
	e.SubmissionsOpenAt, e.SubmissionsCloseAt, e.CreatedAt = mustTime(open), mustTime(close), mustTime(created)
	e.JudgingCloseAt, e.VotingOpenAt, e.VotingCloseAt, e.ResultsPublishedAt = nullTime(jc), nullTime(vo), nullTime(vc), nullTime(rp)
	return &e, nil
}

// Event loads an event by id or slug. Private events are only visible to people with a role in them.
func (s *Service) Event(ctx context.Context, a Actor, idOrSlug string) (*Event, error) {
	e, err := s.event(ctx, s.DB, idOrSlug)
	if err != nil {
		return nil, err
	}
	if !e.IsPublic {
		roles, err := s.Roles(ctx, a, e.ID)
		if err != nil {
			return nil, err
		}
		if len(roles) == 0 {
			return nil, errNotFound("event")
		}
	}
	return e, s.loadEventChildren(ctx, e)
}

func (s *Service) event(ctx context.Context, q store.Queryer, idOrSlug string) (*Event, error) {
	e, err := scanEvent(q.QueryRowContext(ctx, `SELECT `+eventCols+` FROM events WHERE id = ? OR slug = ?`, idOrSlug, idOrSlug))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound("event")
	}
	return e, err
}

func (s *Service) loadEventChildren(ctx context.Context, e *Event) error {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, name, description FROM tracks WHERE event_id = ? ORDER BY position, name`, e.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var t Track
		rows.Scan(&t.ID, &t.Name, &t.Description)
		e.Tracks = append(e.Tracks, t)
	}
	rows.Close()
	rows, err = s.DB.QueryContext(ctx, `SELECT id, coalesce(track_id, ''), name, description, value FROM prizes WHERE event_id = ? ORDER BY position, name`, e.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var p Prize
		rows.Scan(&p.ID, &p.TrackID, &p.Name, &p.Description, &p.Value)
		e.Prizes = append(e.Prizes, p)
	}
	rows.Close()
	e.Criteria, err = s.criteria(ctx, s.DB, e.ID)
	return err
}

func (s *Service) criteria(ctx context.Context, q store.Queryer, eventID string) ([]Criterion, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, key, name, description, weight, scale_min, scale_max
		FROM criteria WHERE event_id = ? ORDER BY position, key`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Criterion
	for rows.Next() {
		var c Criterion
		if err := rows.Scan(&c.ID, &c.Key, &c.Name, &c.Description, &c.Weight, &c.ScaleMin, &c.ScaleMax); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListEvents returns public events plus any the actor has a role in.
func (s *Service) ListEvents(ctx context.Context, a Actor) ([]*Event, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT `+eventCols+` FROM events
		WHERE is_public = 1 OR ? = 1 OR id IN (SELECT event_id FROM event_roles WHERE user_id = ?)
		ORDER BY submissions_close_at DESC`, a.User != nil && a.User.IsAdmin, a.ID())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Event
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// EventInput is used for create and update. Zero-valued optional times clear the field.
type EventInput struct {
	Name               string     `json:"name"`
	Slug               string     `json:"slug"`
	Description        string     `json:"description"`
	SubmissionsOpenAt  time.Time  `json:"submissions_open_at"`
	SubmissionsCloseAt time.Time  `json:"submissions_close_at"`
	JudgingCloseAt     *time.Time `json:"judging_close_at"`
	VotingOpenAt       *time.Time `json:"voting_open_at"`
	VotingCloseAt      *time.Time `json:"voting_close_at"`
	ReviewsPerProject  int        `json:"reviews_per_project"`
	MaxTeamSize        int        `json:"max_team_size"`
	VotesPerVoter      int        `json:"votes_per_voter"`
	IsPublic           *bool      `json:"is_public"`
	Tracks             []string   `json:"tracks"`   // create only
	Criteria           []string   `json:"criteria"` // create only; names, equal weight
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}$`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	dash := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func (in *EventInput) validate() error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 120 {
		return errInvalid("invalid_name", "event name must be 1 to 120 characters")
	}
	if in.Slug == "" {
		in.Slug = slugify(in.Name)
	}
	if !slugRe.MatchString(in.Slug) {
		return errInvalid("invalid_slug", "slug must be lowercase letters, digits and dashes")
	}
	if in.SubmissionsOpenAt.IsZero() || in.SubmissionsCloseAt.IsZero() || !in.SubmissionsOpenAt.Before(in.SubmissionsCloseAt) {
		return errInvalid("invalid_dates", "submissions must open before they close")
	}
	if in.JudgingCloseAt != nil && !in.JudgingCloseAt.After(in.SubmissionsCloseAt) {
		return errInvalid("invalid_dates", "judging must close after submissions close")
	}
	if (in.VotingOpenAt == nil) != (in.VotingCloseAt == nil) {
		return errInvalid("invalid_dates", "set both voting dates or neither")
	}
	if in.VotingOpenAt != nil && !in.VotingOpenAt.Before(*in.VotingCloseAt) {
		return errInvalid("invalid_dates", "voting must open before it closes")
	}
	if in.ReviewsPerProject == 0 {
		in.ReviewsPerProject = 3
	}
	if in.MaxTeamSize == 0 {
		in.MaxTeamSize = 4
	}
	if in.VotesPerVoter == 0 {
		in.VotesPerVoter = 3
	}
	if in.ReviewsPerProject < 1 || in.ReviewsPerProject > 20 || in.MaxTeamSize < 1 || in.MaxTeamSize > 50 || in.VotesPerVoter < 1 || in.VotesPerVoter > 50 {
		return errInvalid("invalid_limits", "reviews per project 1-20, team size 1-50, votes per voter 1-50")
	}
	return nil
}

// CanCreateEvents: admins only. A self-hosted instance belongs to one organiser;
// admins appoint event organizers by invitation.
func (s *Service) CanCreateEvents(a Actor) bool { return a.User != nil && a.User.IsAdmin }

func (s *Service) CreateEvent(ctx context.Context, a Actor, in EventInput) (*Event, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	if !s.CanCreateEvents(a) {
		return nil, errForbidden("only admins can create events")
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	id := store.NewID("evt")
	public := in.IsPublic == nil || *in.IsPublic
	err := s.DB.Tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO events (id, slug, name, description, submissions_open_at, submissions_close_at,
			judging_close_at, voting_open_at, voting_close_at, reviews_per_project, max_team_size, votes_per_voter, is_public, created_by, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, in.Slug, in.Name, in.Description, store.FormatTime(in.SubmissionsOpenAt), store.FormatTime(in.SubmissionsCloseAt),
			timeOrNil(in.JudgingCloseAt), timeOrNil(in.VotingOpenAt), timeOrNil(in.VotingCloseAt),
			in.ReviewsPerProject, in.MaxTeamSize, in.VotesPerVoter, public, a.User.ID, s.nowS())
		if store.IsConstraint(err, "UNIQUE constraint failed: events.slug") {
			return errConflict("slug_taken", "an event with slug %q already exists", in.Slug)
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO event_roles (event_id, user_id, role) VALUES (?, ?, 'organizer')`, id, a.User.ID); err != nil {
			return err
		}
		for i, t := range in.Tracks {
			if t = strings.TrimSpace(t); t != "" {
				if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO tracks (id, event_id, name, position) VALUES (?, ?, ?, ?)`,
					store.NewID("trk"), id, t, i); err != nil {
					return err
				}
			}
		}
		crit := in.Criteria
		if len(crit) == 0 {
			crit = []string{"Functionality", "Quality", "Innovation"}
		}
		for i, c := range crit {
			if c = strings.TrimSpace(c); c != "" {
				if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO criteria (id, event_id, key, name, weight, position) VALUES (?, ?, ?, ?, 1, ?)`,
					store.NewID("crt"), id, slugify(c), c, i); err != nil {
					return err
				}
			}
		}
		return s.audit(ctx, tx, a, id, "event.create", id, map[string]any{"name": in.Name, "slug": in.Slug})
	})
	if err != nil {
		return nil, err
	}
	return s.Event(ctx, a, id)
}

func (s *Service) UpdateEvent(ctx context.Context, a Actor, eventID string, in EventInput) (*Event, error) {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleOrganizer); err != nil {
		return nil, err
	}
	if in.Slug == "" {
		in.Slug = e.Slug
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	public := in.IsPublic == nil || *in.IsPublic
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE events SET slug = ?, name = ?, description = ?, submissions_open_at = ?,
			submissions_close_at = ?, judging_close_at = ?, voting_open_at = ?, voting_close_at = ?,
			reviews_per_project = ?, max_team_size = ?, votes_per_voter = ?, is_public = ? WHERE id = ?`,
			in.Slug, in.Name, in.Description, store.FormatTime(in.SubmissionsOpenAt), store.FormatTime(in.SubmissionsCloseAt),
			timeOrNil(in.JudgingCloseAt), timeOrNil(in.VotingOpenAt), timeOrNil(in.VotingCloseAt),
			in.ReviewsPerProject, in.MaxTeamSize, in.VotesPerVoter, public, e.ID)
		if store.IsConstraint(err, "UNIQUE constraint failed: events.slug") {
			return errConflict("slug_taken", "an event with slug %q already exists", in.Slug)
		}
		if err != nil {
			return err
		}
		// Deadline changes are exactly what disputes are made of, so record old and new.
		return s.audit(ctx, tx, a, e.ID, "event.update", e.ID, map[string]any{
			"submissions_close_at": map[string]string{"from": store.FormatTime(e.SubmissionsCloseAt), "to": store.FormatTime(in.SubmissionsCloseAt)},
			"name":                 in.Name,
		})
	})
	if err != nil {
		return nil, err
	}
	return s.Event(ctx, a, e.ID)
}

func (s *Service) AddTrack(ctx context.Context, a Actor, eventID, name, description string) (*Track, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 80 {
		return nil, errInvalid("invalid_name", "track name must be 1 to 80 characters")
	}
	t := &Track{ID: store.NewID("trk"), Name: name, Description: description}
	err := s.DB.Tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO tracks (id, event_id, name, description, position)
			VALUES (?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM tracks WHERE event_id = ?))`, t.ID, eventID, name, description, eventID)
		if store.IsConstraint(err, "UNIQUE") {
			return errConflict("track_exists", "that track already exists")
		}
		if err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "track.create", t.ID, map[string]any{"name": name})
	})
	return t, err
}

func (s *Service) AddPrize(ctx context.Context, a Actor, eventID string, p Prize) (*Prize, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" || len(p.Name) > 120 {
		return nil, errInvalid("invalid_name", "prize name must be 1 to 120 characters")
	}
	p.ID = store.NewID("prz")
	var track any
	if p.TrackID != "" {
		track = p.TrackID
	}
	err := s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if track != nil {
			var n int
			tx.QueryRowContext(ctx, `SELECT count(*) FROM tracks WHERE id = ? AND event_id = ?`, p.TrackID, eventID).Scan(&n)
			if n == 0 {
				return errInvalid("invalid_track", "track does not belong to this event")
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO prizes (id, event_id, track_id, name, description, value, position)
			VALUES (?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM prizes WHERE event_id = ?))`,
			p.ID, eventID, track, p.Name, p.Description, p.Value, eventID); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "prize.create", p.ID, map[string]any{"name": p.Name, "value": p.Value})
	})
	return &p, err
}

// SetCriteria replaces the rubric weights. Criteria cannot be removed once a
// review references them, only re-weighted, so no score is ever orphaned.
func (s *Service) SetCriterionWeights(ctx context.Context, a Actor, eventID string, weights map[string]float64) error {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		for id, w := range weights {
			if w <= 0 || w > 100 {
				return errInvalid("invalid_weight", "weights must be between 0 (exclusive) and 100")
			}
			res, err := tx.ExecContext(ctx, `UPDATE criteria SET weight = ? WHERE id = ? AND event_id = ?`, w, id, eventID)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return errNotFound("criterion")
			}
		}
		return s.audit(ctx, tx, a, eventID, "rubric.reweight", eventID, map[string]any{"weights": weights})
	})
}

func (s *Service) AddCriterion(ctx context.Context, a Actor, eventID string, c Criterion) (*Criterion, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return nil, errInvalid("invalid_name", "criterion needs a name")
	}
	if c.Key == "" {
		c.Key = slugify(c.Name)
	}
	if c.Weight <= 0 {
		c.Weight = 1
	}
	if c.ScaleMin == 0 && c.ScaleMax == 0 {
		c.ScaleMin, c.ScaleMax = 1, 5
	}
	if c.ScaleMin >= c.ScaleMax {
		return nil, errInvalid("invalid_scale", "scale minimum must be below maximum")
	}
	c.ID = store.NewID("crt")
	err := s.DB.Tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO criteria (id, event_id, key, name, description, weight, scale_min, scale_max, position)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM criteria WHERE event_id = ?))`,
			c.ID, eventID, c.Key, c.Name, c.Description, c.Weight, c.ScaleMin, c.ScaleMax, eventID)
		if store.IsConstraint(err, "UNIQUE") {
			return errConflict("criterion_exists", "a criterion with key %q exists", c.Key)
		}
		if err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "rubric.add", c.ID, map[string]any{"key": c.Key, "weight": c.Weight})
	})
	return &c, err
}

// ---------------------------------------------------------------------------
// Invitations (judges and co-organizers). There is no mail server offline, so
// the organizer copies the link; the token is single use and expires.

type Invitation struct {
	Token     string    `json:"token,omitempty"`
	EventID   string    `json:"event_id"`
	Email     string    `json:"email"`
	Role      Role      `json:"role"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Service) Invite(ctx context.Context, a Actor, eventID, email string, role Role) (*Invitation, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	if role != RoleJudge && role != RoleOrganizer {
		return nil, errInvalid("invalid_role", "can only invite judges or organizers")
	}
	if email != "" {
		var err error
		if email, err = normEmail(email); err != nil {
			return nil, err
		}
	}
	inv := &Invitation{Token: store.NewToken(), EventID: eventID, Email: email, Role: role, ExpiresAt: s.now().Add(14 * 24 * time.Hour)}
	err := s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO invitations (token_hash, event_id, email, role, created_by, created_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, store.HashToken(inv.Token), eventID, email, role, a.User.ID, s.nowS(), store.FormatTime(inv.ExpiresAt)); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "invitation.create", email, map[string]any{"role": role})
	})
	return inv, err
}

func (s *Service) InvitationInfo(ctx context.Context, token string) (*Invitation, *Event, error) {
	var inv Invitation
	var expires string
	var accepted sql.NullString
	err := s.DB.QueryRowContext(ctx, `SELECT event_id, email, role, expires_at, accepted_at FROM invitations WHERE token_hash = ?`,
		store.HashToken(token)).Scan(&inv.EventID, &inv.Email, &inv.Role, &expires, &accepted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, errNotFound("invitation")
	}
	if err != nil {
		return nil, nil, err
	}
	inv.ExpiresAt = mustTime(expires)
	if accepted.Valid {
		return nil, nil, errConflict("invitation_used", "this invitation has already been used")
	}
	if !s.now().Before(inv.ExpiresAt) {
		return nil, nil, errConflict("invitation_expired", "this invitation has expired")
	}
	e, err := s.event(ctx, s.DB, inv.EventID)
	return &inv, e, err
}

func (s *Service) AcceptInvitation(ctx context.Context, a Actor, token string) (*Event, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	inv, e, err := s.InvitationInfo(ctx, token)
	if err != nil {
		return nil, err
	}
	if inv.Email != "" && !strings.EqualFold(inv.Email, a.User.Email) {
		return nil, errForbidden("this invitation was issued to %s", inv.Email)
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE invitations SET accepted_by = ?, accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL`,
			a.User.ID, s.nowS(), store.HashToken(token))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errConflict("invitation_used", "this invitation has already been used")
		}
		_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO event_roles (event_id, user_id, role) VALUES (?, ?, ?)`, e.ID, a.User.ID, inv.Role)
		if store.IsConstraint(err, "conflict_of_interest") {
			return errConflict("conflict_of_interest", "you are a participant in this event and cannot judge it")
		}
		if err != nil {
			return err
		}
		return s.audit(ctx, tx, a, e.ID, "invitation.accept", a.User.ID, map[string]any{"role": inv.Role})
	})
	return e, err
}

// SetJudgeTracks records a judge's expertise for the assignment engine.
func (s *Service) SetJudgeTracks(ctx context.Context, a Actor, eventID, judgeID string, trackIDs []string) error {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		roles, err := s.roles(ctx, tx, judgeID, eventID)
		if err != nil {
			return err
		}
		if !roles[RoleJudge] {
			return errInvalid("not_a_judge", "that user is not a judge in this event")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM judge_tracks WHERE event_id = ? AND user_id = ?`, eventID, judgeID); err != nil {
			return err
		}
		for _, t := range trackIDs {
			if _, err := tx.ExecContext(ctx, `INSERT INTO judge_tracks (event_id, user_id, track_id)
				SELECT ?, ?, id FROM tracks WHERE id = ? AND event_id = ?`, eventID, judgeID, t, eventID); err != nil {
				return err
			}
		}
		return s.audit(ctx, tx, a, eventID, "judge.tracks", judgeID, map[string]any{"tracks": trackIDs})
	})
}

// EventID resolves an id or slug to the event id (existence only, no visibility check).
func (s *Service) EventID(ctx context.Context, idOrSlug string) (string, error) {
	var id string
	err := s.DB.QueryRowContext(ctx, `SELECT id FROM events WHERE id = ? OR slug = ?`, idOrSlug, idOrSlug).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound("event")
	}
	return id, err
}
