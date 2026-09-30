package tests

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"dogfood/src/core"
)

// rewriteHistory is what an operator with the database file can do: drop the
// append-only trigger, edit an entry, and recompute every hash after it so
// the chain re-walks cleanly.
func rewriteHistory(t *testing.T, p *portal, seq int64) {
	t.Helper()
	db := p.svc.DB
	if _, err := db.Exec(`DROP TRIGGER audit_log_append_only_update`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE audit_log SET detail = '{"rewritten":true}' WHERE seq = ?`, seq); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT seq, at, actor_id, event_id, action, target, detail FROM audit_log ORDER BY seq`)
	if err != nil {
		t.Fatal(err)
	}
	type row struct {
		seq                                            int64
		at, actor, event, action, target, detail, hash string
	}
	var all []row
	for rows.Next() {
		var r row
		rows.Scan(&r.seq, &r.at, &r.actor, &r.event, &r.action, &r.target, &r.detail)
		all = append(all, r)
	}
	rows.Close()
	prev := "0000000000000000000000000000000000000000000000000000000000000000"
	for _, r := range all {
		h := sha256.New()
		for _, part := range []string{prev, r.at, r.actor, r.event, r.action, r.target, r.detail} {
			h.Write([]byte(part))
			h.Write([]byte{0})
		}
		hash := hex.EncodeToString(h.Sum(nil))
		if _, err := db.Exec(`UPDATE audit_log SET prev_hash = ?, hash = ? WHERE seq = ?`, prev, hash, r.seq); err != nil {
			t.Fatal(err)
		}
		prev = hash
	}
}

type proofResp struct {
	Record  core.SignedRecord      `json:"record"`
	Payload core.AuditProofPayload `json:"payload"`
}

func TestAuditReceiptCatchesRecomputedChain(t *testing.T) {
	p := newPortal(t)
	// A judge acts, then keeps a receipt for it.
	var offer core.PairOffer
	p.must(p.api("GET", "/api/v1/events/evt_01/pairwise/next", judgeA, nil), 200).JSON(t, &offer)
	p.must(p.api("POST", "/api/v1/events/evt_01/pairwise", judgeA, map[string]string{"a": offer.A.ID, "b": offer.B.ID, "outcome": "a"}), 204)
	var rc proofResp
	p.must(p.api("GET", "/api/v1/events/evt_01/audit/receipt", judgeA, nil), 200).JSON(t, &rc)
	if len(rc.Payload.Entries) == 0 || rc.Payload.Entries[len(rc.Payload.Entries)-1].Action != "pairwise.compare" {
		t.Fatalf("receipt does not pin the judge's comparison: %+v", rc.Payload.Entries)
	}
	for _, e := range rc.Payload.Entries {
		if rc.Payload.UserID == "" || e.Hash == "" {
			t.Fatalf("incomplete receipt entry %+v", e)
		}
	}
	var cp proofResp
	p.must(p.api("GET", "/api/v1/audit/checkpoint", "", nil), 200).JSON(t, &cp)

	var ok core.AuditProofCheck
	p.must(p.api("POST", "/api/v1/audit/verify", "", rc.Record), 200).JSON(t, &ok)
	if !ok.Valid || ok.Checked != len(rc.Payload.Entries)+1 {
		t.Fatalf("fresh receipt should verify: %+v", ok)
	}

	// A forged receipt (payload swapped) is rejected on the signature.
	forged := rc.Record
	forged.Payload = cp.Record.Payload
	var bad core.AuditProofCheck
	p.must(p.api("POST", "/api/v1/audit/verify", "", forged), 200).JSON(t, &bad)
	if bad.Valid {
		t.Fatal("forged receipt verified")
	}

	// Rewrite an early entry and recompute the chain: the plain chain check passes...
	rewriteHistory(t, p, 2)
	var audit struct {
		Verification struct{ OK bool }
	}
	p.must(p.api("GET", "/api/v1/events/evt_01/audit", orgToken, nil), 200).JSON(t, &audit)
	if !audit.Verification.OK {
		t.Fatal("the recomputed chain should look intact on its own")
	}
	// ...but both the judge's receipt and the saved checkpoint catch it.
	for name, rec := range map[string]core.SignedRecord{"receipt": rc.Record, "checkpoint": cp.Record} {
		var res core.AuditProofCheck
		p.must(p.api("POST", "/api/v1/audit/verify", "", rec), 200).JSON(t, &res)
		if res.Valid || len(res.Mismatches) == 0 {
			t.Fatalf("%s did not catch the rewrite: %+v", name, res)
		}
	}
}

func TestAuditReceiptIsPersonalAndNeedsARole(t *testing.T) {
	p := newPortal(t)
	p.must(p.api("GET", "/api/v1/events/evt_01/audit/receipt", "", nil), 401)
	var a, b proofResp
	p.must(p.api("GET", "/api/v1/events/evt_01/audit/receipt", judgeA, nil), 200).JSON(t, &a)
	p.must(p.api("GET", "/api/v1/events/evt_01/audit/receipt", judgeB, nil), 200).JSON(t, &b)
	if a.Payload.UserID == b.Payload.UserID {
		t.Fatal("two judges got the same receipt owner")
	}
	// Every pinned entry must be the holder's own action.
	rows, err := p.svc.DB.Query(`SELECT seq FROM audit_log WHERE actor_id != ?`, a.Payload.UserID)
	if err != nil {
		t.Fatal(err)
	}
	others := map[int64]bool{}
	for rows.Next() {
		var s int64
		rows.Scan(&s)
		others[s] = true
	}
	rows.Close()
	for _, e := range a.Payload.Entries {
		if others[e.Seq] {
			t.Fatalf("receipt pins someone else's entry %d", e.Seq)
		}
	}
	// A signed-up user with no role in the event gets nothing.
	stranger := p.signup("stranger@example.org", "Stranger")
	p.must(p.api("GET", "/api/v1/events/evt_01/audit/receipt", stranger, nil), 403)
}
