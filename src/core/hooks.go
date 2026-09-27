package core

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"dogfood/src/store"
)

// Webhooks (T4). Deliveries are written in the same transaction as the change
// that caused them (a transactional outbox), so a rolled-back change never
// fires a webhook and a committed one is never lost. A background worker
// POSTs them with an HMAC-SHA256 signature and retries with backoff.

var HookTopics = []string{"project.submitted", "review.submitted", "results.published"}

type hookQueue struct{ wake chan struct{} }

func newHookQueue() *hookQueue { return &hookQueue{wake: make(chan struct{}, 1)} }

func (s *Service) enqueueHook(ctx context.Context, tx *sql.Tx, eventID, topic string, data map[string]any) {
	rows, err := tx.QueryContext(ctx, `SELECT id, topics FROM webhooks WHERE event_id = ? AND active = 1`, eventID)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id, topics string
		rows.Scan(&id, &topics)
		for _, t := range strings.Split(topics, ",") {
			if t = strings.TrimSpace(t); t == "*" || t == topic {
				ids = append(ids, id)
				break
			}
		}
	}
	rows.Close()
	if len(ids) == 0 {
		return
	}
	payload, _ := json.Marshal(map[string]any{"topic": topic, "event_id": eventID, "at": s.nowS(), "data": data})
	for _, id := range ids {
		tx.ExecContext(ctx, `INSERT INTO webhook_deliveries (webhook_id, topic, payload, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?)`,
			id, topic, string(payload), s.nowS(), s.nowS())
	}
	select {
	case s.hooks.wake <- struct{}{}:
	default:
	}
}

type Webhook struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	Secret    string    `json:"secret,omitempty"`
	Topics    []string  `json:"topics"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Service) CreateWebhook(ctx context.Context, a Actor, eventID, rawURL string, topics []string) (*Webhook, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	u, err := cleanURL(rawURL)
	if err != nil || u == "" {
		return nil, errInvalid("invalid_url", "webhook URL must be http(s)")
	}
	if len(topics) == 0 {
		topics = []string{"*"}
	}
	for _, t := range topics {
		ok := t == "*"
		for _, known := range HookTopics {
			ok = ok || t == known
		}
		if !ok {
			return nil, errInvalid("invalid_topic", "unknown topic %q", t)
		}
	}
	w := &Webhook{ID: store.NewID("whk"), URL: u, Secret: store.NewToken()[:32], Topics: topics, Active: true, CreatedAt: s.now()}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO webhooks (id, event_id, url, secret, topics, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			w.ID, eventID, w.URL, w.Secret, strings.Join(topics, ","), a.User.ID, s.nowS()); err != nil {
			return err
		}
		return s.audit(ctx, tx, a, eventID, "webhook.create", w.ID, map[string]any{"url": w.URL, "topics": topics})
	})
	return w, err
}

func (s *Service) Webhooks(ctx context.Context, a Actor, eventID string) ([]Webhook, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id, url, topics, active, created_at FROM webhooks WHERE event_id = ? ORDER BY created_at`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Webhook
	for rows.Next() {
		var w Webhook
		var topics, created string
		rows.Scan(&w.ID, &w.URL, &topics, &w.Active, &created)
		w.Topics, w.CreatedAt = strings.Split(topics, ","), mustTime(created)
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Service) DeleteWebhook(ctx context.Context, a Actor, eventID, id string) error {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM webhooks WHERE id = ? AND event_id = ?`, id, eventID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errNotFound("webhook")
		}
		return s.audit(ctx, tx, a, eventID, "webhook.delete", id, nil)
	})
}

type Delivery struct {
	ID        int64     `json:"id"`
	WebhookID string    `json:"webhook_id"`
	Topic     string    `json:"topic"`
	Status    string    `json:"status"`
	Attempts  int       `json:"attempts"`
	LastError string    `json:"last_error"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Service) Deliveries(ctx context.Context, a Actor, eventID string) ([]Delivery, error) {
	if err := s.require(ctx, s.DB, a, eventID, RoleOrganizer); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT d.id, d.webhook_id, d.topic, d.status, d.attempts, d.last_error, d.created_at
		FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE w.event_id = ? ORDER BY d.id DESC LIMIT 50`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Delivery
	for rows.Next() {
		var d Delivery
		var created string
		rows.Scan(&d.ID, &d.WebhookID, &d.Topic, &d.Status, &d.Attempts, &d.LastError, &created)
		d.CreatedAt = mustTime(created)
		out = append(out, d)
	}
	return out, rows.Err()
}

// SignPayload is the value of the X-Dogfood-Signature header: "sha256=" + hex HMAC of the body.
func SignPayload(secret string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return "sha256=" + hex.EncodeToString(m.Sum(nil))
}

const maxHookAttempts = 8

// RunWebhookWorker delivers due webhooks until ctx is cancelled.
func (s *Service) RunWebhookWorker(ctx context.Context, log *slog.Logger) {
	client := &http.Client{Timeout: 10 * time.Second}
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		s.deliverDue(ctx, client, log)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		case <-s.hooks.wake:
		}
	}
}

func (s *Service) deliverDue(ctx context.Context, client *http.Client, log *slog.Logger) {
	type due struct {
		id                   int64
		url, secret, payload string
		topic                string
		attempts             int
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT d.id, w.url, w.secret, d.payload, d.topic, d.attempts
		FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
		WHERE d.status = 'pending' AND d.next_attempt_at <= ? AND w.active = 1 ORDER BY d.id LIMIT 20`, s.nowS())
	if err != nil {
		return
	}
	var batch []due
	for rows.Next() {
		var d due
		rows.Scan(&d.id, &d.url, &d.secret, &d.payload, &d.topic, &d.attempts)
		batch = append(batch, d)
	}
	rows.Close()
	for _, d := range batch {
		body := []byte(d.payload)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, d.url, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "dogfood-webhooks/1")
		req.Header.Set("X-Dogfood-Topic", d.topic)
		req.Header.Set("X-Dogfood-Delivery", fmt.Sprint(d.id))
		req.Header.Set("X-Dogfood-Signature", SignPayload(d.secret, body))
		resp, err := client.Do(req)
		errText := ""
		if err != nil {
			errText = err.Error()
		} else {
			resp.Body.Close()
			if resp.StatusCode >= 300 {
				errText = fmt.Sprintf("HTTP %d", resp.StatusCode)
			}
		}
		attempts := d.attempts + 1
		switch {
		case errText == "":
			s.DB.ExecContext(ctx, `UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, last_error = '' WHERE id = ?`, attempts, d.id)
		case attempts >= maxHookAttempts:
			s.DB.ExecContext(ctx, `UPDATE webhook_deliveries SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?`, attempts, errText, d.id)
			log.Warn("webhook failed permanently", "delivery", d.id, "error", errText)
		default:
			next := s.now().Add(time.Duration(1<<attempts) * 15 * time.Second) // 30s, 60s, 2m ... ~32m
			s.DB.ExecContext(ctx, `UPDATE webhook_deliveries SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`,
				attempts, errText, store.FormatTime(next), d.id)
		}
	}
}
