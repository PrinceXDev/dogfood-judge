// Package core is the service layer. Every read and write in the portal goes
// through it, and every authorization decision is made here, so the HTML
// pages and the JSON API cannot disagree about who may do what.
package core

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"dogfood/src/judging"
	"dogfood/src/store"
)

// Error is a domain error that the HTTP layer maps to a status code.
type Error struct {
	Kind    Kind
	Code    string // machine readable, e.g. "submissions_closed"
	Message string
}

type Kind int

const (
	KindInvalid Kind = iota + 1
	KindUnauthenticated
	KindForbidden
	KindNotFound
	KindConflict
	KindTooMany
)

func (e *Error) Error() string { return e.Message }

func errInvalid(code, msg string, a ...any) error {
	return &Error{KindInvalid, code, fmt.Sprintf(msg, a...)}
}
func errForbidden(msg string, a ...any) error {
	return &Error{KindForbidden, "forbidden", fmt.Sprintf(msg, a...)}
}
func errNotFound(what string) error {
	return &Error{KindNotFound, "not_found", what + " not found"}
}
func errConflict(code, msg string, a ...any) error {
	return &Error{KindConflict, code, fmt.Sprintf(msg, a...)}
}

var ErrUnauthenticated = &Error{KindUnauthenticated, "unauthenticated", "sign in required"}

// ErrorKind returns the Kind of err, or 0 for unexpected errors.
func ErrorKind(err error) Kind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return 0
}

type Role string

const (
	RoleOrganizer   Role = "organizer"
	RoleJudge       Role = "judge"
	RoleParticipant Role = "participant"
)

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	IsAdmin  bool   `json:"is_admin"`
	CanLogin bool   `json:"-"`
}

// Actor is whoever is making the request. A nil User is a visitor.
type Actor struct {
	User   *User
	IP     string // raw address, only ever stored hashed
	UA     string
	Source string // "web" or "api", for the audit log
}

func (a Actor) LoggedIn() bool { return a.User != nil }
func (a Actor) ID() string {
	if a.User == nil {
		return ""
	}
	return a.User.ID
}

// Clock is injectable for tests; the database triggers use SQLite's own clock.
type Clock func() time.Time

type Service struct {
	DB     *store.DB
	Now    Clock
	secret []byte // HMAC key for CSRF tokens and salting IP hashes
	signer *Signer
	hooks  *hookQueue

	cacheMu sync.Mutex
	cache   map[string]*judging.Report
}

func New(ctx context.Context, db *store.DB) (*Service, error) {
	s := &Service{DB: db, Now: time.Now, cache: map[string]*judging.Report{}}
	secret, err := store.Setting(ctx, db, "instance_secret")
	if err != nil {
		return nil, err
	}
	if secret == "" {
		secret = store.NewToken()
		if err := store.PutSetting(ctx, db, "instance_secret", secret); err != nil {
			return nil, err
		}
	}
	s.secret = []byte(secret)
	if s.signer, err = loadSigner(ctx, db); err != nil {
		return nil, err
	}
	s.hooks = newHookQueue()
	return s, nil
}

func (s *Service) now() time.Time { return s.Now().UTC().Truncate(time.Second) }
func (s *Service) nowS() string   { return store.FormatTime(s.Now()) }

// Hash is a keyed hash used for IPs and user agents so abuse can be correlated
// without storing personal data in the clear.
func (s *Service) Hash(v string) string {
	if v == "" {
		return ""
	}
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(v))
	return hex.EncodeToString(m.Sum(nil))[:24]
}

// CSRFToken derives a per-session token; see web.requireCSRF.
func (s *Service) CSRFToken(sessionToken string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte("csrf:" + sessionToken))
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Service) audit(ctx context.Context, tx *sql.Tx, a Actor, eventID, action, target string, detail map[string]any) error {
	if detail == nil {
		detail = map[string]any{}
	}
	if a.Source != "" {
		detail["via"] = a.Source
	}
	return store.Audit(ctx, tx, store.AuditEntry{
		ActorID: a.ID(), EventID: eventID, Action: action, Target: target,
		Detail: detail, IPHash: s.Hash(a.IP),
	})
}

// ---------------------------------------------------------------------------
// Role checks. These are the only functions that decide access.

func (s *Service) roles(ctx context.Context, q store.Queryer, userID, eventID string) (map[Role]bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT role FROM event_roles WHERE event_id = ? AND user_id = ?`, eventID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[Role]bool{}
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			return nil, err
		}
		out[Role(r)] = true
	}
	return out, rows.Err()
}

// Roles returns the caller's roles in an event (organizer implied for admins).
func (s *Service) Roles(ctx context.Context, a Actor, eventID string) (map[Role]bool, error) {
	if !a.LoggedIn() {
		return map[Role]bool{}, nil
	}
	r, err := s.roles(ctx, s.DB, a.User.ID, eventID)
	if err != nil {
		return nil, err
	}
	if a.User.IsAdmin {
		r[RoleOrganizer] = true
	}
	return r, nil
}

// require fails unless the actor holds at least one of the given roles in the
// event. Admins pass every organizer check.
func (s *Service) require(ctx context.Context, q store.Queryer, a Actor, eventID string, allowed ...Role) error {
	if !a.LoggedIn() {
		return ErrUnauthenticated
	}
	have, err := s.roles(ctx, q, a.User.ID, eventID)
	if err != nil {
		return err
	}
	for _, r := range allowed {
		if have[r] || (r == RoleOrganizer && a.User.IsAdmin) {
			return nil
		}
	}
	names := make([]string, len(allowed))
	for i, r := range allowed {
		names[i] = string(r)
	}
	return errForbidden("requires role %s in this event", strings.Join(names, " or "))
}

func nullStr(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

func nullTime(ns sql.NullString) *time.Time {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	t, err := store.ParseTime(ns.String)
	if err != nil {
		return nil
	}
	return &t
}

func timeOrNil(t *time.Time) any {
	if t == nil {
		return nil
	}
	return store.FormatTime(*t)
}

func mustTime(s string) time.Time {
	t, _ := store.ParseTime(s)
	return t
}
