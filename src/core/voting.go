package core

import (
	"context"
	"database/sql"
	"errors"
	"math/rand/v2"
	"sort"
	"strings"
	"sync"
	"time"

	"dogfood/src/store"
)

// ---------------------------------------------------------------------------
// Community voting (T3)
//
// Authenticated voting with a per-voter budget (default 3 votes per event).
// Defences, all documented in THREAT-MODEL.md:
//   - one account, one budget: enforced by primary key and a trigger;
//   - accounts younger than the voting window's start are held for review
//     (stops "sign up 50 accounts during voting");
//   - many accounts voting from one network are held for review, not dropped;
//   - team members cannot vote for their own project;
//   - tallies are hidden from everyone but organizers until results publish;
//   - ballots are shuffled per voter so position bias averages out.

type Ballot struct {
	EventID   string     `json:"event_id"`
	Projects  []*Project `json:"projects"` // shuffled per voter
	MyVotes   []string   `json:"my_votes"`
	Remaining int        `json:"remaining"`
	Open      bool       `json:"open"`
	ClosesAt  *time.Time `json:"closes_at"`
}

// Ballot returns the voting ballot. Order is a deterministic shuffle keyed on
// the voter, so reloading does not reshuffle but no two voters share an order.
func (s *Service) Ballot(ctx context.Context, a Actor, eventID string) (*Ballot, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	e, err := s.Event(ctx, a, eventID)
	if err != nil {
		return nil, err
	}
	page, err := s.Gallery(ctx, GalleryFilter{EventID: e.ID})
	if err != nil {
		return nil, err
	}
	ps := page.Projects
	for p := 2; len(ps) < page.Total && p < 100; p++ {
		more, err := s.Gallery(ctx, GalleryFilter{EventID: e.ID, Page: p})
		if err != nil {
			return nil, err
		}
		ps = append(ps, more.Projects...)
	}
	sort.Slice(ps, func(i, j int) bool { return ps[i].ID < ps[j].ID })
	rng := rand.New(rand.NewPCG(seedFrom(a.User.ID), seedFrom(e.ID)))
	rng.Shuffle(len(ps), func(i, j int) { ps[i], ps[j] = ps[j], ps[i] })
	b := &Ballot{EventID: e.ID, Projects: ps, Open: e.VotingOpen(s.now()), ClosesAt: e.VotingCloseAt}
	rows, err := s.DB.QueryContext(ctx, `SELECT project_id FROM votes WHERE event_id = ? AND user_id = ?`, e.ID, a.User.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		rows.Scan(&id)
		b.MyVotes = append(b.MyVotes, id)
	}
	b.Remaining = e.VotesPerVoter - len(b.MyVotes)
	return b, rows.Err()
}

// SameNetworkThreshold: more distinct accounts than this voting from one
// hashed IP in an event puts that IP's later votes on hold for review.
const SameNetworkThreshold = 5

func (s *Service) Vote(ctx context.Context, a Actor, projectID string) error {
	if !a.LoggedIn() {
		return ErrUnauthenticated
	}
	p, err := s.Project(ctx, a, projectID)
	if err != nil {
		return err
	}
	e, err := s.event(ctx, s.DB, p.EventID)
	if err != nil {
		return err
	}
	if !e.VotingOpen(s.now()) {
		return &Error{KindForbidden, "voting_closed", "community voting is not open"}
	}
	if p.Status != "submitted" || p.DuplicateOf != "" || p.DisqualifiedReason != "" {
		return errInvalid("not_votable", "this project is not on the ballot")
	}
	if s.isMember(ctx, s.DB, p.TeamID, a.User.ID) {
		return errForbidden("you cannot vote for your own team's project")
	}
	ipHash, uaHash := s.Hash(a.IP), s.Hash(a.UA)
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var flag []string
		var created string
		tx.QueryRowContext(ctx, `SELECT created_at FROM users WHERE id = ?`, a.User.ID).Scan(&created)
		if e.VotingOpenAt != nil && created > store.FormatTime(*e.VotingOpenAt) {
			flag = append(flag, "account created after voting opened")
		}
		if ipHash != "" {
			var accounts int
			tx.QueryRowContext(ctx, `SELECT count(DISTINCT user_id) FROM votes WHERE event_id = ? AND ip_hash = ? AND user_id <> ?`,
				e.ID, ipHash, a.User.ID).Scan(&accounts)
			if accounts >= SameNetworkThreshold {
				flag = append(flag, "many accounts voting from one network")
			}
		}
		var flagged any
		if len(flag) > 0 {
			flagged = strings.Join(flag, "; ")
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO votes (event_id, project_id, user_id, ip_hash, ua_hash, flagged, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, e.ID, p.ID, a.User.ID, ipHash, uaHash, flagged, s.nowS())
		switch {
		case store.IsConstraint(err, "vote_budget_exhausted"):
			return errConflict("vote_budget_exhausted", "you have used all %d of your votes", e.VotesPerVoter)
		case store.IsConstraint(err, "UNIQUE constraint failed: votes"), store.IsConstraint(err, "PRIMARY KEY"):
			return errConflict("already_voted", "you already voted for this project")
		case err != nil:
			return err
		}
		return s.audit(ctx, tx, a, e.ID, "vote.cast", p.ID, map[string]any{"flagged": flagged})
	})
}

func (s *Service) Unvote(ctx context.Context, a Actor, projectID string) error {
	if !a.LoggedIn() {
		return ErrUnauthenticated
	}
	p, err := s.Project(ctx, a, projectID)
	if err != nil {
		return err
	}
	e, err := s.event(ctx, s.DB, p.EventID)
	if err != nil {
		return err
	}
	if !e.VotingOpen(s.now()) {
		return &Error{KindForbidden, "voting_closed", "community voting is not open"}
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM votes WHERE event_id = ? AND user_id = ? AND project_id = ?`, e.ID, a.User.ID, p.ID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errNotFound("vote")
		}
		return s.audit(ctx, tx, a, e.ID, "vote.retract", p.ID, nil)
	})
}

type VoteTally struct {
	Project *Project `json:"project"`
	Counted int      `json:"counted"`
	Held    int      `json:"held"` // flagged, excluded from the count pending review
}

func (s *Service) voteTally(ctx context.Context, eventID string, projects map[string]*Project) ([]VoteTally, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT project_id, sum(flagged IS NULL), sum(flagged IS NOT NULL)
		FROM votes WHERE event_id = ? GROUP BY project_id`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VoteTally
	for rows.Next() {
		var id string
		var t VoteTally
		rows.Scan(&id, &t.Counted, &t.Held)
		if t.Project = projects[id]; t.Project != nil {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Counted != out[j].Counted {
			return out[i].Counted > out[j].Counted
		}
		return out[i].Project.Title < out[j].Project.Title
	})
	return out, rows.Err()
}

type FlaggedVote struct {
	ProjectID string    `json:"project_id"`
	Title     string    `json:"title"`
	UserID    string    `json:"user_id"`
	UserName  string    `json:"user_name"`
	IPHash    string    `json:"ip_hash"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Service) FlaggedVotes(ctx context.Context, a Actor, eventID string) ([]FlaggedVote, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT v.project_id, p.title, v.user_id, u.name, v.ip_hash, v.flagged, v.created_at
		FROM votes v JOIN projects p ON p.id = v.project_id JOIN users u ON u.id = v.user_id
		WHERE v.event_id = ? AND v.flagged IS NOT NULL ORDER BY v.ip_hash, v.created_at`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FlaggedVote
	for rows.Next() {
		var f FlaggedVote
		var created string
		rows.Scan(&f.ProjectID, &f.Title, &f.UserID, &f.UserName, &f.IPHash, &f.Reason, &created)
		f.CreatedAt = mustTime(created)
		out = append(out, f)
	}
	return out, rows.Err()
}

// ReviewVote lets an organizer count (approve) or discard a held vote.
func (s *Service) ReviewVote(ctx context.Context, a Actor, eventID, userID, projectID string, approve bool) error {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var res sql.Result
		var err error
		if approve {
			res, err = tx.ExecContext(ctx, `UPDATE votes SET flagged = NULL WHERE event_id = ? AND user_id = ? AND project_id = ? AND flagged IS NOT NULL`, eventID, userID, projectID)
		} else {
			res, err = tx.ExecContext(ctx, `DELETE FROM votes WHERE event_id = ? AND user_id = ? AND project_id = ? AND flagged IS NOT NULL`, eventID, userID, projectID)
		}
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errNotFound("held vote")
		}
		return s.audit(ctx, tx, a, eventID, "vote.review", projectID, map[string]any{"voter": userID, "approved": approve})
	})
}

// ---------------------------------------------------------------------------
// Comments

type Comment struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	UserID    string    `json:"user_id"`
	UserName  string    `json:"user_name"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
	Hidden    bool      `json:"hidden"`
}

// Comments lists visible comments; organizers also see hidden ones (marked).
func (s *Service) Comments(ctx context.Context, a Actor, projectID string) ([]Comment, error) {
	p, err := s.Project(ctx, a, projectID)
	if err != nil {
		return nil, err
	}
	roles, err := s.Roles(ctx, a, p.EventID)
	if err != nil {
		return nil, err
	}
	q := `SELECT c.id, c.project_id, c.user_id, u.name, c.body, c.created_at, c.hidden_at IS NOT NULL
		FROM comments c JOIN users u ON u.id = c.user_id WHERE c.project_id = ?`
	if !roles[RoleOrganizer] {
		q += ` AND c.hidden_at IS NULL`
	}
	rows, err := s.DB.QueryContext(ctx, q+` ORDER BY c.created_at, c.id`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Comment
	for rows.Next() {
		var c Comment
		var created string
		rows.Scan(&c.ID, &c.ProjectID, &c.UserID, &c.UserName, &c.Body, &created, &c.Hidden)
		c.CreatedAt = mustTime(created)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Service) AddComment(ctx context.Context, a Actor, projectID, body string) (*Comment, error) {
	if !a.LoggedIn() {
		return nil, ErrUnauthenticated
	}
	p, err := s.Project(ctx, a, projectID)
	if err != nil {
		return nil, err
	}
	if p.Status != "submitted" {
		return nil, errInvalid("not_commentable", "comments open once a project is submitted")
	}
	body = strings.TrimSpace(body)
	if body == "" || len([]rune(body)) > 2000 {
		return nil, errInvalid("invalid_body", "comment must be 1 to 2000 characters")
	}
	c := &Comment{ID: store.NewID("cmt"), ProjectID: p.ID, UserID: a.User.ID, UserName: a.User.Name, Body: body, CreatedAt: s.now()}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		// Exact repeat of your own recent comment is almost always a double post or spam.
		var dup int
		tx.QueryRowContext(ctx, `SELECT count(*) FROM comments WHERE user_id = ? AND body = ? AND created_at > ?`,
			a.User.ID, body, store.FormatTime(s.now().Add(-24*time.Hour))).Scan(&dup)
		if dup > 0 {
			return errConflict("duplicate_comment", "you already posted that comment")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO comments (id, event_id, project_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			c.ID, p.EventID, p.ID, a.User.ID, body, s.nowS()); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, p.EventID, "comment.create", c.ID, map[string]any{"project_id": p.ID})
	})
	return c, err
}

func (s *Service) HideComment(ctx context.Context, a Actor, commentID string, hide bool) error {
	var eventID string
	err := s.DB.QueryRowContext(ctx, `SELECT event_id FROM comments WHERE id = ?`, commentID).Scan(&eventID)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound("comment")
	}
	if err != nil {
		return err
	}
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if hide {
			_, err = tx.ExecContext(ctx, `UPDATE comments SET hidden_at = ?, hidden_by = ? WHERE id = ?`, s.nowS(), a.User.ID, commentID)
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE comments SET hidden_at = NULL, hidden_by = NULL WHERE id = ?`, commentID)
		}
		if err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "comment.moderate", commentID, map[string]any{"hidden": hide})
	})
}

// ---------------------------------------------------------------------------
// Rate limiting: in-memory token buckets keyed by (bucket, identity). Good for
// one process, which is how the portal is deployed; state resets on restart.

type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	now     func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{buckets: map[string]*bucket{}, now: time.Now}
}

// Allow consumes one token from key's bucket of the given capacity that
// refills fully over period.
func (r *RateLimiter) Allow(key string, capacity int, period time.Duration) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	b := r.buckets[key]
	if b == nil {
		b = &bucket{tokens: float64(capacity), last: now}
		r.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * float64(capacity) / period.Seconds()
	if b.tokens > float64(capacity) {
		b.tokens = float64(capacity)
	}
	b.last = now
	if len(r.buckets) > 100_000 { // crude memory bound under attack
		r.buckets = map[string]*bucket{key: b}
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
