// Package seed makes a fresh database useful on first boot: an admin and an
// organizer account, the DOGFOOD fixture event, an open playground event, and
// (in demo mode) known credentials for the acceptance checker.
package seed

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"dogfood/src/core"
	"dogfood/src/store"
)

// DemoPassword is set on every seeded account in demo mode. Printed at boot
// and documented; production deployments set DOGFOOD_DEMO=0.
const DemoPassword = "dogfood-demo"

// Demo bearer tokens referenced by .dogfood.toml. Stable so the committed
// config works against any fresh `docker compose up`.
var DemoTokens = []struct{ Label, Email, Token string }{
	{"admin", "admin@dogfood.local", "demo-admin-7c1e9b"},
	{"organizer", "organizer@dogfood.local", "demo-organizer-4f2a81"},
	{"judge_a", "", "demo-judge-a-91bc3d"},                          // jdg_26, most reviews in the fixture
	{"judge_b", "", "demo-judge-b-44de5f"},                          // jdg_24
	{"participant", "sana7@example.org", "demo-participant-2e88a0"}, // team tm_07
}

// Judge fixture ids behind judge_a / judge_b.
const (
	JudgeA = "jdg_26"
	JudgeB = "jdg_24"
)

type Options struct {
	FixturesPath string
	Demo         bool
	Out          io.Writer
}

// Run is idempotent: each step checks whether it has already happened.
func Run(ctx context.Context, svc *core.Service, opt Options) error {
	out := opt.Out
	if out == nil {
		out = os.Stdout
	}
	var users int
	if err := svc.DB.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&users); err != nil {
		return err
	}
	fresh := users == 0

	// One PBKDF2 hash for all demo accounts: hashing ~130 accounts at 600k
	// iterations each would add a minute to first boot.
	var demoHash string
	if opt.Demo {
		var err error
		if demoHash, err = core.HashPassword(DemoPassword); err != nil {
			return err
		}
	}

	admin, err := ensureAccount(ctx, svc, "admin@dogfood.local", "Admin", true, demoHash)
	if err != nil {
		return err
	}
	organizer, err := ensureAccount(ctx, svc, "organizer@dogfood.local", "Olu Organizer", false, demoHash)
	if err != nil {
		return err
	}
	adminActor := core.Actor{User: admin, Source: "seed"}

	var n int
	svc.DB.QueryRowContext(ctx, `SELECT count(*) FROM events`).Scan(&n)
	if n == 0 && opt.FixturesPath != "" {
		b, err := os.ReadFile(opt.FixturesPath)
		if err != nil {
			return fmt.Errorf("read fixtures: %w", err)
		}
		var doc core.Doc
		if err := json.Unmarshal(b, &doc); err != nil {
			return fmt.Errorf("parse fixtures: %w", err)
		}
		res, err := svc.Import(ctx, adminActor, &doc)
		if err != nil {
			return fmt.Errorf("import fixtures: %w", err)
		}
		fmt.Fprintf(out, "seed: imported %s: %d projects, %d reviews, %d accounts\n", res.EventID, res.Projects, res.Reviews, res.Users)
		for _, d := range res.Duplicates {
			fmt.Fprintf(out, "seed:   duplicate detected: %s\n", d)
		}
		for _, w := range res.Warnings {
			fmt.Fprintf(out, "seed:   warning: %s\n", w)
		}
		if _, err := svc.DB.ExecContext(ctx, `INSERT OR IGNORE INTO event_roles (event_id, user_id, role) VALUES (?, ?, 'organizer')`,
			res.EventID, organizer.ID); err != nil {
			return err
		}
		// Top up the unfinished batches with pending assignments so judges have work.
		rep, err := svc.RunAssignment(ctx, core.Actor{User: organizer, Source: "seed"}, res.EventID)
		if err != nil {
			return fmt.Errorf("assign: %w", err)
		}
		fmt.Fprintf(out, "seed: assignment engine added %d pending reviews (load %d-%d, %d component(s))\n",
			len(rep.New), rep.LoadMin, rep.LoadMax, rep.Components)
		// A 48-hour community voting window from first boot, so T3 can be tried
		// immediately. Publishing is refused while it is open; an organizer can
		// shorten it in Settings (the change is audited).
		now := time.Now().UTC().Truncate(time.Second)
		if _, err := svc.DB.ExecContext(ctx, `UPDATE events SET voting_open_at = ?, voting_close_at = ? WHERE id = ?`,
			store.FormatTime(now), store.FormatTime(now.Add(48*time.Hour)), res.EventID); err != nil {
			return err
		}
		if err := playground(ctx, svc, adminActor, organizer); err != nil {
			return fmt.Errorf("playground: %w", err)
		}
	}

	if opt.Demo {
		if _, err := svc.DB.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE password_hash IS NULL`, demoHash); err != nil {
			return err
		}
		for _, t := range DemoTokens {
			var uid string
			switch t.Label {
			case "judge_a":
				uid = JudgeA
			case "judge_b":
				uid = JudgeB
			default:
				if err := svc.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE email = ?`, t.Email).Scan(&uid); err != nil {
					return fmt.Errorf("demo token %s: %w", t.Label, err)
				}
			}
			if err := svc.PutFixedCredential(ctx, uid, t.Token, "demo "+t.Label); err != nil {
				return err
			}
		}
	}
	if fresh || opt.Demo {
		banner(out, opt.Demo)
	}
	return nil
}

func ensureAccount(ctx context.Context, svc *core.Service, email, name string, admin bool, hash string) (*core.User, error) {
	var id string
	err := svc.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE email = ?`, email).Scan(&id)
	if err == sql.ErrNoRows {
		id = store.NewID("usr")
		var h any
		if hash != "" {
			h = hash
		}
		if _, err := svc.DB.ExecContext(ctx, `INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			id, email, name, h, admin, store.FormatTime(time.Now())); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	return svc.UserByID(ctx, id)
}

// playground is a small event with submissions open for a week from first
// boot, so the full create -> submit -> judge -> publish loop can be shown live.
func playground(ctx context.Context, svc *core.Service, admin core.Actor, organizer *core.User) error {
	now := time.Now().UTC().Truncate(time.Hour)
	judgingClose := now.Add(14 * 24 * time.Hour)
	e, err := svc.CreateEvent(ctx, admin, core.EventInput{
		Name:               "Playground Hack",
		Slug:               "playground",
		Description:        "An open event for trying the full lifecycle: form a team, submit, judge, publish.",
		SubmissionsOpenAt:  now.Add(-time.Hour),
		SubmissionsCloseAt: now.Add(7 * 24 * time.Hour),
		JudgingCloseAt:     &judgingClose,
		Tracks:             []string{"Tools", "Data", "Community"},
		Criteria:           []string{"Functionality", "Quality", "Innovation"},
	})
	if err != nil {
		return err
	}
	_, err = svc.DB.ExecContext(ctx, `INSERT OR IGNORE INTO event_roles (event_id, user_id, role) VALUES (?, ?, 'organizer')`, e.ID, organizer.ID)
	return err
}

func banner(out io.Writer, demo bool) {
	fmt.Fprintln(out, "seed: ------------------------------------------------------------")
	if !demo {
		fmt.Fprintln(out, "seed: demo mode is off. Set a password for admin@dogfood.local with:")
		fmt.Fprintln(out, "seed:   dogfood set-password admin@dogfood.local")
		fmt.Fprintln(out, "seed: ------------------------------------------------------------")
		return
	}
	fmt.Fprintf(out, "seed: DEMO MODE. Every seeded account's password is %q\n", DemoPassword)
	fmt.Fprintln(out, "seed:   admin        admin@dogfood.local")
	fmt.Fprintln(out, "seed:   organizer    organizer@dogfood.local")
	fmt.Fprintln(out, "seed:   judge        jonas.vogel@example.org (jdg_26, or any fixture judge email)")
	fmt.Fprintln(out, "seed:   participant  sana7@example.org (or any fixture team member)")
	fmt.Fprintln(out, "seed: API headers for the acceptance checker (.dogfood.toml):")
	for _, t := range DemoTokens {
		fmt.Fprintf(out, "seed:   %-12s Authorization: Bearer %s\n", t.Label, t.Token)
	}
	fmt.Fprintln(out, "seed: Turn demo mode off (DOGFOOD_DEMO=0) before real use.")
	fmt.Fprintln(out, "seed: ------------------------------------------------------------")
}
