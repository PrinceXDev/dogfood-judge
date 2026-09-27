// Package store owns the SQLite connection, schema migrations, and the
// append-only audit log. Domain logic lives in package core.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// TimeFormat is the only timestamp format written to the database. Fixed width
// and UTC, so lexical order equals chronological order (the triggers rely on it).
const TimeFormat = "2006-01-02T15:04:05Z"

func FormatTime(t time.Time) string { return t.UTC().Truncate(time.Second).Format(TimeFormat) }

// ParseTime accepts any RFC 3339 timestamp and normalises it to UTC.
func ParseTime(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

// Queryer is satisfied by *sql.DB and *sql.Tx.
type Queryer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type DB struct {
	*sql.DB
}

// Open opens (creating if needed) the database at path and applies migrations.
// Use ":memory:" for tests.
func Open(path string) (*DB, error) {
	name := path
	if path != ":memory:" {
		name = filepath.ToSlash(path)
	}
	dsn := name + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_txlock=immediate"
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows one writer at a time. A single connection makes every
	// transaction serialisable, which the audit hash chain depends on, and is
	// comfortably fast at hackathon scale (thousands of users, not millions).
	sqldb.SetMaxOpenConns(1)
	sqldb.SetMaxIdleConns(1)
	sqldb.SetConnMaxLifetime(0)
	db := &DB{sqldb}
	if err := db.migrate(context.Background()); err != nil {
		sqldb.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

func (db *DB) migrate(ctx context.Context) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return err
	}
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)
	for _, f := range files {
		version := strings.TrimSuffix(filepath.Base(f), ".sql")
		var n int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM schema_migrations WHERE version = ?`, version).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		body, err := migrations.ReadFile(f)
		if err != nil {
			return err
		}
		err = db.Tx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, string(body)); err != nil {
				return fmt.Errorf("%s: %w", version, err)
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
				version, FormatTime(time.Now()))
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// Tx runs fn inside a transaction, committing on nil and rolling back otherwise.
func (db *DB) Tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// NewID returns a prefixed random id such as "prj_4k2m9x0q7w".
func NewID(prefix string) string {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz"
	b := make([]byte, 10)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return prefix + "_" + string(b)
}

// NewToken returns a 256-bit random token, hex encoded.
func NewToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// IsConstraint reports whether err is an SQLite constraint or trigger abort
// whose message contains substr.
func IsConstraint(err error, substr string) bool {
	return err != nil && strings.Contains(err.Error(), substr)
}

// Setting reads a key from the settings table, returning "" if absent.
func Setting(ctx context.Context, q Queryer, key string) (string, error) {
	var v string
	err := q.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func PutSetting(ctx context.Context, q Queryer, key, value string) error {
	_, err := q.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// ---------------------------------------------------------------------------
// Audit log

type AuditEntry struct {
	Seq      int64          `json:"seq"`
	At       string         `json:"at"`
	ActorID  string         `json:"actor_id"`
	EventID  string         `json:"event_id"`
	Action   string         `json:"action"`
	Target   string         `json:"target"`
	Detail   map[string]any `json:"detail"`
	IPHash   string         `json:"-"`
	PrevHash string         `json:"prev_hash"`
	Hash     string         `json:"hash"`
}

const genesisHash = "0000000000000000000000000000000000000000000000000000000000000000"

func chainHash(prev, at, actor, event, action, target, detail string) string {
	h := sha256.New()
	for _, part := range []string{prev, at, actor, event, action, target, detail} {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Audit appends one entry. Must be called inside the transaction that made the
// change, so the record and the change commit or fail together.
func Audit(ctx context.Context, tx *sql.Tx, e AuditEntry) error {
	detail := "{}"
	if e.Detail != nil {
		b, err := json.Marshal(e.Detail)
		if err != nil {
			return err
		}
		detail = string(b)
	}
	prev := genesisHash
	err := tx.QueryRowContext(ctx, `SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1`).Scan(&prev)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	at := e.At
	if at == "" {
		at = FormatTime(time.Now())
	}
	hash := chainHash(prev, at, e.ActorID, e.EventID, e.Action, e.Target, detail)
	_, err = tx.ExecContext(ctx, `INSERT INTO audit_log
		(at, actor_id, event_id, action, target, detail, ip_hash, prev_hash, hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		at, e.ActorID, e.EventID, e.Action, e.Target, detail, e.IPHash, prev, hash)
	return err
}

// AuditVerification is the result of re-walking the hash chain.
type AuditVerification struct {
	OK       bool  `json:"ok"`
	Entries  int   `json:"entries"`
	BrokenAt int64 `json:"broken_at,omitempty"`
}

// VerifyAudit recomputes every hash in order. Any edit made behind the
// application's back (the table is append-only via triggers, but a determined
// operator can drop them) breaks the chain at the first tampered row.
func VerifyAudit(ctx context.Context, q Queryer) (AuditVerification, error) {
	rows, err := q.QueryContext(ctx, `SELECT seq, at, actor_id, event_id, action, target, detail, prev_hash, hash
		FROM audit_log ORDER BY seq`)
	if err != nil {
		return AuditVerification{}, err
	}
	defer rows.Close()
	res := AuditVerification{OK: true}
	prev := genesisHash
	for rows.Next() {
		var seq int64
		var at, actor, event, action, target, detail, prevHash, hash string
		if err := rows.Scan(&seq, &at, &actor, &event, &action, &target, &detail, &prevHash, &hash); err != nil {
			return res, err
		}
		res.Entries++
		if !res.OK {
			continue
		}
		if prevHash != prev || chainHash(prev, at, actor, event, action, target, detail) != hash {
			res.OK = false
			res.BrokenAt = seq
		}
		prev = hash
	}
	return res, rows.Err()
}

// AuditEntries lists entries for one event (or all when eventID is ""), newest first.
func AuditEntries(ctx context.Context, q Queryer, eventID string, limit int) ([]AuditEntry, error) {
	query := `SELECT seq, at, actor_id, event_id, action, target, detail, prev_hash, hash FROM audit_log`
	args := []any{}
	if eventID != "" {
		query += ` WHERE event_id = ?`
		args = append(args, eventID)
	}
	query += ` ORDER BY seq DESC LIMIT ?`
	args = append(args, limit)
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		var detail string
		if err := rows.Scan(&e.Seq, &e.At, &e.ActorID, &e.EventID, &e.Action, &e.Target, &detail, &e.PrevHash, &e.Hash); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(detail), &e.Detail)
		out = append(out, e)
	}
	return out, rows.Err()
}
