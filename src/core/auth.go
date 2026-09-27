package core

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"dogfood/src/store"
)

// PBKDF2-SHA256 at OWASP's 2023 recommendation, from the standard library so
// the portal carries no third-party crypto.
const pbkdf2Iterations = 600_000

const SessionTTL = 14 * 24 * time.Hour

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	rand.Read(salt)
	key, err := pbkdf2.Key(sha256.New, password, salt, pbkdf2Iterations, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", pbkdf2Iterations,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func checkPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// dummyHash keeps login timing the same whether or not the email exists.
var dummyHash, _ = HashPassword("timing-equaliser")

func normEmail(e string) (string, error) {
	e = strings.TrimSpace(strings.ToLower(e))
	addr, err := mail.ParseAddress(e)
	if err != nil || addr.Address != e {
		return "", errInvalid("invalid_email", "that does not look like an email address")
	}
	return e, nil
}

// SignUp creates a new account. Existing emails, including password-less
// imported ones, are refused: without email verification, letting sign-up
// claim an imported judge's address would hand a stranger that judge's role.
// Imported people activate through a link an organizer gives them.
func (s *Service) SignUp(ctx context.Context, a Actor, email, name, password string) (*User, error) {
	email, err := normEmail(email)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 80 {
		return nil, errInvalid("invalid_name", "name must be 1 to 80 characters")
	}
	if err := checkPasswordPolicy(password); err != nil {
		return nil, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	u := &User{ID: store.NewID("usr"), Email: email, Name: name, CanLogin: true}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
			u.ID, email, name, hash, s.nowS())
		if store.IsConstraint(err, "UNIQUE constraint failed: users.email") {
			return errConflict("email_taken", "an account with that email already exists; if you were imported as a judge or participant, ask an organizer for your activation link")
		}
		if err != nil {
			return err
		}
		return s.audit(ctx, tx, Actor{User: u, IP: a.IP, Source: a.Source}, "", "user.signup", u.ID, nil)
	})
	if err != nil {
		return nil, err
	}
	return u, nil
}

func checkPasswordPolicy(password string) error {
	if len(password) < 10 || len(password) > 200 {
		return errInvalid("weak_password", "password must be 10 to 200 characters")
	}
	return nil
}

// ActivationLink issues a one-time link for an account that has no password
// yet (imported judges and team members). Organizers may issue links only for
// people who hold a role in an event they organize.
func (s *Service) ActivationLink(ctx context.Context, a Actor, eventID, userID string) (string, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return "", err
	}
	var hasPassword bool
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT password_hash IS NOT NULL,
		(SELECT count(*) FROM event_roles WHERE event_id = ? AND user_id = users.id AND role IN ('judge', 'participant'))
		FROM users WHERE id = ?`, eventID, userID).Scan(&hasPassword, &n)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && n == 0) {
		return "", errNotFound("judge or participant")
	}
	if err != nil {
		return "", err
	}
	if hasPassword {
		return "", errConflict("already_active", "this account already has a password")
	}
	token, err := s.issueCredential(ctx, userID, "activation", "", s.now().Add(7*24*time.Hour))
	if err != nil {
		return "", err
	}
	return token, s.DB.Tx(ctx, func(tx *sql.Tx) error {
		return s.audit(ctx, tx, a, eventID, "user.activation_link", userID, nil)
	})
}

// ActivationInfo returns the account an activation token belongs to.
func (s *Service) ActivationInfo(ctx context.Context, token string) (*User, error) {
	var u User
	var expires string
	err := s.DB.QueryRowContext(ctx, `SELECT u.id, u.email, u.name, c.expires_at FROM credentials c JOIN users u ON u.id = c.user_id
		WHERE c.token_hash = ? AND c.kind = 'activation'`, store.HashToken(token)).Scan(&u.ID, &u.Email, &u.Name, &expires)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && expires <= s.nowS()) {
		return nil, errNotFound("activation link")
	}
	return &u, err
}

// Activate sets the password for an activation token and signs the user in.
func (s *Service) Activate(ctx context.Context, a Actor, token, password string) (string, *User, error) {
	u, err := s.ActivationInfo(ctx, token)
	if err != nil {
		return "", nil, err
	}
	if err := checkPasswordPolicy(password); err != nil {
		return "", nil, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return "", nil, err
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM credentials WHERE token_hash = ? AND kind = 'activation'`, store.HashToken(token))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errNotFound("activation link")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, hash, u.ID); err != nil {
			return err
		}
		return s.audit(ctx, tx, Actor{User: u, IP: a.IP, Source: a.Source}, "", "user.activate", u.ID, nil)
	})
	if err != nil {
		return "", nil, err
	}
	session, err := s.issueCredential(ctx, u.ID, "session", "", s.now().Add(SessionTTL))
	u.CanLogin = true
	return session, u, err
}

// SetPassword is the operator escape hatch used by `dogfood set-password`.
func (s *Service) SetPassword(ctx context.Context, email, password string) error {
	if err := checkPasswordPolicy(password); err != nil {
		return err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE email = ?`, hash, strings.ToLower(strings.TrimSpace(email)))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errNotFound("user")
	}
	return nil
}

// Login checks credentials and returns a new session token.
func (s *Service) Login(ctx context.Context, a Actor, email, password string) (string, *User, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	var u User
	var hash sql.NullString
	err := s.DB.QueryRowContext(ctx, `SELECT id, email, name, is_admin, password_hash FROM users WHERE email = ?`, email).
		Scan(&u.ID, &u.Email, &u.Name, &u.IsAdmin, &hash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", nil, err
	}
	if err != nil || !hash.Valid {
		checkPassword(dummyHash, password)
		return "", nil, &Error{KindUnauthenticated, "bad_credentials", "email or password is incorrect"}
	}
	if !checkPassword(hash.String, password) {
		return "", nil, &Error{KindUnauthenticated, "bad_credentials", "email or password is incorrect"}
	}
	u.CanLogin = true
	token, err := s.issueCredential(ctx, u.ID, "session", "", s.now().Add(SessionTTL))
	return token, &u, err
}

func (s *Service) issueCredential(ctx context.Context, userID, kind, label string, expires time.Time) (string, error) {
	token := store.NewToken()
	var exp any
	if !expires.IsZero() {
		exp = store.FormatTime(expires)
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO credentials (token_hash, user_id, kind, label, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?)`, store.HashToken(token), userID, kind, label, s.nowS(), exp)
	return token, err
}

// PutFixedCredential installs a known token. Only used by the demo seed so the
// acceptance checker has stable headers; see README "Demo mode".
func (s *Service) PutFixedCredential(ctx context.Context, userID, token, label string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO credentials (token_hash, user_id, kind, label, created_at)
		VALUES (?, ?, 'api', ?, ?) ON CONFLICT(token_hash) DO NOTHING`, store.HashToken(token), userID, label, s.nowS())
	return err
}

// CreateAPIToken issues a non-expiring bearer token for scripts.
func (s *Service) CreateAPIToken(ctx context.Context, a Actor, label string) (string, error) {
	if !a.LoggedIn() {
		return "", ErrUnauthenticated
	}
	if label = strings.TrimSpace(label); label == "" {
		label = "api token"
	}
	token, err := s.issueCredential(ctx, a.User.ID, "api", label, time.Time{})
	if err != nil {
		return "", err
	}
	return token, s.DB.Tx(ctx, func(tx *sql.Tx) error {
		return s.audit(ctx, tx, a, "", "token.create", a.User.ID, map[string]any{"label": label})
	})
}

// Authenticate resolves a session or API token to its user.
func (s *Service) Authenticate(ctx context.Context, token string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	var u User
	var expires sql.NullString
	err := s.DB.QueryRowContext(ctx, `SELECT u.id, u.email, u.name, u.is_admin, c.expires_at
		FROM credentials c JOIN users u ON u.id = c.user_id
		WHERE c.token_hash = ? AND c.kind IN ('session', 'api')`, store.HashToken(token)).
		Scan(&u.ID, &u.Email, &u.Name, &u.IsAdmin, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if expires.Valid && expires.String <= s.nowS() {
		return nil, nil
	}
	u.CanLogin = true
	return &u, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM credentials WHERE token_hash = ? AND kind = 'session'`, store.HashToken(token))
	return err
}

func (s *Service) UserByID(ctx context.Context, id string) (*User, error) {
	var u User
	var hash sql.NullString
	err := s.DB.QueryRowContext(ctx, `SELECT id, email, name, is_admin, password_hash FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Email, &u.Name, &u.IsAdmin, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound("user")
	}
	u.CanLogin = hash.Valid
	return &u, err
}

// EnsureUser returns the id for email, creating a password-less account if needed.
func ensureUser(ctx context.Context, tx *sql.Tx, email, name, now string) (string, error) {
	var id string
	err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE email = ?`, email).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	id = store.NewID("usr")
	if name == "" {
		name = strings.SplitN(email, "@", 2)[0]
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`, id, email, name, now)
	return id, err
}
