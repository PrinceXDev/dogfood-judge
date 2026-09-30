package core

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"

	"dogfood/src/store"
)

// Audit checkpoints and receipts. The triggers make audit_log append-only and
// the hash chain makes edits visible, but an operator with the database can
// still drop the triggers and recompute the whole chain. A signed statement
// "entry N had hash H" that someone else keeps pins every entry up to N:
// changing any of them changes H. Receipts give each person such a statement
// for their own actions, so a rewrite has to get past everyone holding one.

const (
	auditHeadType    = "dogfood.audit-head/v1"
	auditReceiptType = "dogfood.audit-receipt/v1"
)

// AuditLink is one pinned audit entry.
type AuditLink struct {
	Seq    int64  `json:"seq"`
	At     string `json:"at,omitempty"`
	Action string `json:"action,omitempty"`
	Target string `json:"target,omitempty"`
	Hash   string `json:"hash"`
}

// AuditProofPayload is the signed body of a checkpoint or a receipt.
type AuditProofPayload struct {
	Type     string      `json:"type"`
	Head     AuditLink   `json:"head"`               // latest entry when issued
	EventID  string      `json:"event_id,omitempty"` // receipts only
	UserID   string      `json:"user_id,omitempty"`  // receipts only
	Entries  []AuditLink `json:"entries,omitempty"`  // receipts only: the holder's own actions
	IssuedAt string      `json:"issued_at"`
	KeyID    string      `json:"key_id"`
}

func (s *Service) signProof(p AuditProofPayload) *SignedRecord {
	p.KeyID = s.signer.KeyID
	body, _ := json.Marshal(p)
	sig := ed25519.Sign(s.signer.priv, body)
	return &SignedRecord{Payload: base64.StdEncoding.EncodeToString(body), Signature: base64.StdEncoding.EncodeToString(sig), KeyID: p.KeyID}
}

func (s *Service) auditHead(ctx context.Context) (AuditLink, error) {
	var h AuditLink
	err := s.DB.QueryRowContext(ctx, `SELECT seq, at, hash FROM audit_log ORDER BY seq DESC LIMIT 1`).Scan(&h.Seq, &h.At, &h.Hash)
	if errors.Is(err, sql.ErrNoRows) {
		return h, nil
	}
	return h, err
}

// AuditCheckpoint signs the current head of the audit chain. It is public: it
// reveals only how many entries exist, which /stats already does.
func (s *Service) AuditCheckpoint(ctx context.Context) (*SignedRecord, *AuditProofPayload, error) {
	head, err := s.auditHead(ctx)
	if err != nil {
		return nil, nil, err
	}
	p := AuditProofPayload{Type: auditHeadType, Head: head, IssuedAt: s.nowS()}
	rec := s.signProof(p)
	p.KeyID = rec.KeyID
	return rec, &p, nil
}

// AuditReceipt signs the caller's own audit entries in an event plus the
// current head. Anyone with a role in the event may ask; nobody can get a
// receipt for someone else's actions.
func (s *Service) AuditReceipt(ctx context.Context, a Actor, eventID string) (*SignedRecord, *AuditProofPayload, error) {
	e, err := s.event(ctx, s.DB, eventID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.require(ctx, s.DB, a, e.ID, RoleOrganizer, RoleJudge, RoleParticipant); err != nil {
		return nil, nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT seq, at, action, target, hash FROM audit_log
		WHERE event_id = ? AND actor_id = ? ORDER BY seq`, e.ID, a.User.ID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	p := AuditProofPayload{Type: auditReceiptType, EventID: e.ID, UserID: a.User.ID, IssuedAt: s.nowS()}
	for rows.Next() {
		var l AuditLink
		if err := rows.Scan(&l.Seq, &l.At, &l.Action, &l.Target, &l.Hash); err != nil {
			return nil, nil, err
		}
		p.Entries = append(p.Entries, l)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if p.Head, err = s.auditHead(ctx); err != nil {
		return nil, nil, err
	}
	rec := s.signProof(p)
	p.KeyID = rec.KeyID
	return rec, &p, nil
}

// AuditProofCheck is the result of holding a checkpoint or receipt up
// against the live audit log.
type AuditProofCheck struct {
	Valid      bool                    `json:"valid"` // signature good, every pinned hash matches, chain intact
	Reason     string                  `json:"reason,omitempty"`
	Payload    *AuditProofPayload      `json:"payload,omitempty"`
	Checked    int                     `json:"checked"`
	Mismatches []AuditMismatch         `json:"mismatches,omitempty"`
	Chain      store.AuditVerification `json:"chain"`
}

type AuditMismatch struct {
	Seq  int64  `json:"seq"`
	Want string `json:"want"`
	Got  string `json:"got"` // "" when the entry no longer exists
}

// VerifyAuditProof decodes and checks the signature of a checkpoint or receipt.
func VerifyAuditProof(pub ed25519.PublicKey, rec SignedRecord) (*AuditProofPayload, error) {
	body, err := base64.StdEncoding.DecodeString(rec.Payload)
	if err != nil {
		return nil, errInvalid("bad_record", "payload is not base64")
	}
	sig, err := base64.StdEncoding.DecodeString(rec.Signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return nil, errInvalid("bad_record", "signature is malformed")
	}
	if !ed25519.Verify(pub, body, sig) {
		return nil, errInvalid("bad_signature", "signature does not match: the proof was altered or signed by another key")
	}
	var p AuditProofPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, errInvalid("bad_record", "payload is not JSON")
	}
	if p.Type != auditHeadType && p.Type != auditReceiptType {
		return nil, errInvalid("bad_record", "not an audit checkpoint or receipt")
	}
	return &p, nil
}

// CheckAuditProof verifies a proof against this instance's audit log: the
// signature, that every pinned entry still has the hash it had, and that the
// chain itself re-walks cleanly. A rewritten history fails here even if the
// rewriter recomputed every hash, because the pinned hashes are signed.
func (s *Service) CheckAuditProof(ctx context.Context, rec SignedRecord) (*AuditProofCheck, error) {
	p, err := VerifyAuditProof(s.signer.Pub, rec)
	if err != nil {
		return &AuditProofCheck{Reason: err.Error()}, nil
	}
	out := &AuditProofCheck{Payload: p}
	links := append([]AuditLink{}, p.Entries...)
	if p.Head.Seq > 0 {
		links = append(links, p.Head)
	}
	for _, l := range links {
		var got string
		err := s.DB.QueryRowContext(ctx, `SELECT hash FROM audit_log WHERE seq = ?`, l.Seq).Scan(&got)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		out.Checked++
		if got != l.Hash {
			out.Mismatches = append(out.Mismatches, AuditMismatch{Seq: l.Seq, Want: l.Hash, Got: got})
		}
	}
	if out.Chain, err = store.VerifyAudit(ctx, s.DB); err != nil {
		return nil, err
	}
	switch {
	case len(out.Mismatches) > 0:
		out.Reason = "the audit log no longer contains what was signed: history was rewritten"
	case !out.Chain.OK:
		out.Reason = "the audit hash chain is broken"
	default:
		out.Valid = true
	}
	return out, nil
}
