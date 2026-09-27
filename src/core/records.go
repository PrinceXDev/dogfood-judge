package core

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"

	"dogfood/src/store"
)

// Signed participation records (T4). Each instance holds an Ed25519 key,
// generated on first boot and published at /.well-known/dogfood-signing-key.
// A record is a small JSON document plus a detached signature over its exact
// bytes; anyone with the public key can verify it offline, with no call back
// to the portal (see `dogfood verify-record`).

type Signer struct {
	priv  ed25519.PrivateKey
	Pub   ed25519.PublicKey
	KeyID string
}

func loadSigner(ctx context.Context, db *store.DB) (*Signer, error) {
	enc, err := store.Setting(ctx, db, "signing_key")
	if err != nil {
		return nil, err
	}
	var priv ed25519.PrivateKey
	if enc == "" {
		_, priv, err = ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		if err := store.PutSetting(ctx, db, "signing_key", base64.StdEncoding.EncodeToString(priv.Seed())); err != nil {
			return nil, err
		}
	} else {
		seed, err := base64.StdEncoding.DecodeString(enc)
		if err != nil || len(seed) != ed25519.SeedSize {
			return nil, errors.New("corrupt signing_key setting")
		}
		priv = ed25519.NewKeyFromSeed(seed)
	}
	pub := priv.Public().(ed25519.PublicKey)
	return &Signer{priv: priv, Pub: pub, KeyID: KeyID(pub)}, nil
}

func KeyID(pub ed25519.PublicKey) string {
	sum := sha256.Sum256(pub)
	return hex.EncodeToString(sum[:8])
}

func (s *Service) SigningKey() *Signer { return s.signer }

type RecordPayload struct {
	Type         string `json:"type"` // "dogfood.participation/v1"
	Role         string `json:"role"` // judge | participant
	EventID      string `json:"event_id"`
	EventName    string `json:"event_name"`
	Name         string `json:"name"`
	Reviews      int    `json:"reviews_completed,omitempty"`
	Comparisons  int    `json:"comparisons,omitempty"`
	ProjectTitle string `json:"project_title,omitempty"`
	Team         string `json:"team,omitempty"`
	IssuedAt     string `json:"issued_at"`
	KeyID        string `json:"key_id"`
}

// SignedRecord carries the payload as the exact bytes that were signed, so
// verification never depends on re-serialising JSON identically.
type SignedRecord struct {
	Payload   string `json:"payload"`   // base64 of the signed JSON bytes
	Signature string `json:"signature"` // base64 Ed25519 signature
	KeyID     string `json:"key_id"`
}

func (s *Service) sign(p RecordPayload) (*SignedRecord, *RecordPayload) {
	p.Type, p.KeyID = "dogfood.participation/v1", s.signer.KeyID
	body, _ := json.Marshal(p)
	sig := ed25519.Sign(s.signer.priv, body)
	return &SignedRecord{Payload: base64.StdEncoding.EncodeToString(body), Signature: base64.StdEncoding.EncodeToString(sig), KeyID: p.KeyID}, &p
}

// JudgeRecord issues a signed record of the caller's judging in an event.
// Only issued once results are published, so it cannot leak progress early.
func (s *Service) JudgeRecord(ctx context.Context, a Actor, eventID string) (*SignedRecord, *RecordPayload, error) {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleJudge); err != nil {
		return nil, nil, err
	}
	if !e.Published() {
		return nil, nil, errConflict("not_published", "records are issued after results are published")
	}
	p := RecordPayload{Role: "judge", EventID: e.ID, EventName: e.Name, Name: a.User.Name, IssuedAt: s.nowS()}
	s.DB.QueryRowContext(ctx, `SELECT count(*) FROM reviews WHERE event_id = ? AND judge_id = ?`, e.ID, a.User.ID).Scan(&p.Reviews)
	s.DB.QueryRowContext(ctx, `SELECT count(*) FROM comparisons WHERE event_id = ? AND judge_id = ?`, e.ID, a.User.ID).Scan(&p.Comparisons)
	if p.Reviews == 0 && p.Comparisons == 0 {
		return nil, nil, errConflict("nothing_to_certify", "no completed reviews in this event")
	}
	rec, payload := s.sign(p)
	return rec, payload, nil
}

// ParticipantRecord issues a certificate for a member of a submitted project.
func (s *Service) ParticipantRecord(ctx context.Context, a Actor, eventID string) (*SignedRecord, *RecordPayload, error) {
	t, err := s.MyTeam(ctx, a, eventID)
	if err != nil {
		return nil, nil, err
	}
	e, err := s.event(ctx, s.DB, t.EventID)
	if err != nil {
		return nil, nil, err
	}
	if t.Project == nil || t.Project.Status != "submitted" {
		return nil, nil, errConflict("nothing_to_certify", "your team has no submitted project")
	}
	if s.now().Before(e.SubmissionsCloseAt) {
		return nil, nil, errConflict("event_running", "certificates are issued after submissions close")
	}
	rec, payload := s.sign(RecordPayload{Role: "participant", EventID: e.ID, EventName: e.Name, Name: a.User.Name,
		ProjectTitle: t.Project.Title, Team: t.Name, IssuedAt: s.nowS()})
	return rec, payload, nil
}

// VerifyRecord checks a record against a public key and returns its payload.
func VerifyRecord(pub ed25519.PublicKey, rec SignedRecord) (*RecordPayload, error) {
	body, err := base64.StdEncoding.DecodeString(rec.Payload)
	if err != nil {
		return nil, errInvalid("bad_record", "payload is not base64")
	}
	sig, err := base64.StdEncoding.DecodeString(rec.Signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return nil, errInvalid("bad_record", "signature is malformed")
	}
	if !ed25519.Verify(pub, body, sig) {
		return nil, errInvalid("bad_signature", "signature does not match: the record was altered or signed by another key")
	}
	var p RecordPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, errInvalid("bad_record", "payload is not JSON")
	}
	return &p, nil
}
