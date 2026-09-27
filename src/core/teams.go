package core

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"dogfood/src/store"
)

type Team struct {
	ID          string   `json:"id"`
	EventID     string   `json:"event_id"`
	Name        string   `json:"name"`
	InviteToken string   `json:"invite_token,omitempty"` // only shown to members
	Members     []User   `json:"members"`
	Project     *Project `json:"project,omitempty"`
}

func (s *Service) CreateTeam(ctx context.Context, a Actor, eventID, name string) (*Team, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, err
	}
	if !s.now().Before(e.SubmissionsCloseAt) {
		return nil, &Error{KindForbidden, "submissions_closed", "this event is closed to new teams"}
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 60 {
		return nil, errInvalid("invalid_name", "team name must be 1 to 60 characters")
	}
	t := &Team{ID: store.NewID("tm"), EventID: e.ID, Name: name, InviteToken: store.NewToken()[:24]}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if err := s.addParticipant(ctx, tx, e.ID, a.User.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO teams (id, event_id, name, invite_token, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			t.ID, e.ID, name, t.InviteToken, a.User.ID, s.nowS()); err != nil {
			return err
		}
		if err := s.joinTeam(ctx, tx, t.ID, e.ID, a.User.ID); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, e.ID, "team.create", t.ID, map[string]any{"name": name})
	})
	if err != nil {
		return nil, err
	}
	return s.MyTeam(ctx, a, e.ID)
}

func (s *Service) addParticipant(ctx context.Context, tx *sql.Tx, eventID, userID string) error {
	_, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO event_roles (event_id, user_id, role) VALUES (?, ?, 'participant')`, eventID, userID)
	if store.IsConstraint(err, "conflict_of_interest") {
		return errConflict("conflict_of_interest", "judges cannot join a team in the event they judge")
	}
	return err
}

func (s *Service) joinTeam(ctx context.Context, tx *sql.Tx, teamID, eventID, userID string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO team_members (team_id, event_id, user_id, joined_at) VALUES (?, ?, ?, ?)`,
		teamID, eventID, userID, s.nowS())
	if store.IsConstraint(err, "UNIQUE constraint failed: team_members") {
		return errConflict("already_on_team", "you are already on a team in this event")
	}
	return err
}

// TeamByInvite resolves an invite link for the join page.
func (s *Service) TeamByInvite(ctx context.Context, token string) (*Team, *Event, error) {
	var t Team
	err := s.DB.QueryRowContext(ctx, `SELECT id, event_id, name FROM teams WHERE invite_token = ?`, token).Scan(&t.ID, &t.EventID, &t.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, errNotFound("team invite")
	}
	if err != nil {
		return nil, nil, err
	}
	e, err := s.event(ctx, s.DB, t.EventID)
	if err != nil {
		return nil, nil, err
	}
	t.Members, err = s.teamMembers(ctx, t.ID)
	return &t, e, err
}

func (s *Service) JoinTeam(ctx context.Context, a Actor, token string) (*Team, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	t, e, err := s.TeamByInvite(ctx, token)
	if err != nil {
		return nil, err
	}
	if !s.now().Before(e.SubmissionsCloseAt) {
		return nil, &Error{KindForbidden, "submissions_closed", "teams are locked after submissions close"}
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM team_members WHERE team_id = ?`, t.ID).Scan(&n); err != nil {
			return err
		}
		if n >= e.MaxTeamSize {
			return errConflict("team_full", "this team already has %d members, the event maximum", e.MaxTeamSize)
		}
		if err := s.addParticipant(ctx, tx, e.ID, a.User.ID); err != nil {
			return err
		}
		if err := s.joinTeam(ctx, tx, t.ID, e.ID, a.User.ID); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, e.ID, "team.join", t.ID, nil)
	})
	if err != nil {
		return nil, err
	}
	return s.MyTeam(ctx, a, e.ID)
}

func (s *Service) LeaveTeam(ctx context.Context, a Actor, eventID string) error {
	t, err := s.MyTeam(ctx, a, eventID)
	if err != nil {
		return err
	}
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return err
	}
	if !s.now().Before(e.SubmissionsCloseAt) {
		return &Error{KindForbidden, "submissions_closed", "teams are locked after submissions close"}
	}
	if len(t.Members) == 1 && t.Project != nil {
		return errConflict("last_member", "you are the last member of a team with a project; delete the draft first or invite someone")
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, t.ID, a.User.ID); err != nil {
			return err
		}
		if len(t.Members) == 1 {
			if _, err := tx.ExecContext(ctx, `DELETE FROM teams WHERE id = ?`, t.ID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM event_roles WHERE event_id = ? AND user_id = ? AND role = 'participant'`, eventID, a.User.ID); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "team.leave", t.ID, nil)
	})
}

func (s *Service) RotateInvite(ctx context.Context, a Actor, eventID string) (*Team, error) {
	t, err := s.MyTeam(ctx, a, eventID)
	if err != nil {
		return nil, err
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE teams SET invite_token = ? WHERE id = ?`, store.NewToken()[:24], t.ID); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "team.rotate_invite", t.ID, nil)
	})
	if err != nil {
		return nil, err
	}
	return s.MyTeam(ctx, a, eventID)
}

// MyTeam returns the caller's team in an event, including the invite link and draft project.
func (s *Service) MyTeam(ctx context.Context, a Actor, eventID string) (*Team, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	var t Team
	err := s.DB.QueryRowContext(ctx, `SELECT t.id, t.event_id, t.name, t.invite_token FROM teams t
		JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? AND (t.event_id = ? OR t.event_id IN (SELECT id FROM events WHERE slug = ?))`,
		a.User.ID, eventID, eventID).Scan(&t.ID, &t.EventID, &t.Name, &t.InviteToken)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound("team")
	}
	if err != nil {
		return nil, err
	}
	if t.Members, err = s.teamMembers(ctx, t.ID); err != nil {
		return nil, err
	}
	p, err := scanProject(s.DB.QueryRowContext(ctx, `SELECT `+projectCols+` FROM projects p JOIN teams t ON t.id = p.team_id
		LEFT JOIN tracks k ON k.id = p.track_id WHERE p.team_id = ? AND p.duplicate_of IS NULL`, t.ID))
	if err == nil {
		t.Project = p
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return &t, nil
}

func (s *Service) teamMembers(ctx context.Context, teamID string) ([]User, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT u.id, u.email, u.name FROM team_members m JOIN users u ON u.id = m.user_id
		WHERE m.team_id = ? ORDER BY m.joined_at, u.name`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// GrantExtension lets an organizer extend one team's deadline (the database
// triggers honour it too). Audited, because this is where favouritism would hide.
func (s *Service) GrantExtension(ctx context.Context, a Actor, eventID, teamID string, minutes int, reason string) error {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return err
	}
	if minutes < 1 || minutes > 7*24*60 {
		return errInvalid("invalid_extension", "extension must be between 1 minute and 7 days")
	}
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return err
	}
	until := e.SubmissionsCloseAt
	if n := s.now(); n.After(until) {
		until = n
	}
	until = until.Add(timeMinutes(minutes))
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		tx.QueryRowContext(ctx, `SELECT count(*) FROM teams WHERE id = ? AND event_id = ?`, teamID, eventID).Scan(&n)
		if n == 0 {
			return errNotFound("team")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO deadline_extensions (event_id, team_id, until, reason, granted_by, granted_at)
			VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, team_id) DO UPDATE SET until = excluded.until, reason = excluded.reason,
			granted_by = excluded.granted_by, granted_at = excluded.granted_at`,
			eventID, teamID, store.FormatTime(until), reason, a.User.ID, s.nowS()); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "deadline.extend", teamID, map[string]any{"until": store.FormatTime(until), "reason": reason})
	})
}
