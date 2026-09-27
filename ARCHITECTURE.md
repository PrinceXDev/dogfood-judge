# Architecture

## Shape

One Go binary, one SQLite file, no other moving parts.

```
 browser ── HTML forms (cookie + CSRF) ──┐
                                          ├─► src/web ──► src/core ──► src/store ──► SQLite (WAL)
 curl / scripts ── JSON (Bearer) ─────────┘   (HTTP)     (service +    (migrations,    triggers enforce
                                                          authorization) audit chain)   deadline, COI, ranges
                                                  │
                                                  └──► src/judging (pure maths: normalization,
                                                        Bradley–Terry, assignment, simulation)
```

| Package | Responsibility | Depends on |
|---|---|---|
| `src/cmd/dogfood` | Entry point: `serve`, and the offline tools `normalize`, `simulate`, `verify-record`, `import`, `export`, `set-password`. | everything |
| `src/web` | HTTP only. It turns requests into service calls, and service errors into status codes or pages. Templates and static files are embedded. **No authorization logic.** | core |
| `src/core` | The service layer. Every read and write, **every access decision**, audit writes, webhook outbox, signed records. | store, judging |
| `src/store` | Open SQLite with the right pragmas, run migrations, transactions, the append-only hash-chained audit log. | – |
| `src/judging` | Scoring maths with no I/O: testable, benchmarkable, and readable on its own. | – |
| `src/seed` | First-boot data: accounts, fixture import, demo tokens. | core |

## Decisions and why

**Go and SQLite, pure Go (`modernc.org/sqlite`, no cgo).** The brief's
hardest requirement is "comes up on a laptop with the network off". One
static binary and one data file is the smallest thing that satisfies it.
Backup is copying a file. The container needs no database service, no
migrations job and no volume permissions dance. At hackathon scale (hundreds
of teams, thousands of reviews) SQLite is not the bottleneck. The whole
normalization with a 300-sample bootstrap takes about 0.4 s.

**One connection (`SetMaxOpenConns(1)`) and `BEGIN IMMEDIATE`.** SQLite
allows one writer at a time anyway. A single connection makes every
transaction serialisable, which the audit hash chain depends on (each row
hashes the previous one). It also removes `SQLITE_BUSY` as a failure mode.
The trade-off is no read concurrency. At this scale that is invisible, and
it is the first knob to turn (a read pool) if it ever isn't.

**Authorization lives in one place.** `core.Service.require(...)` and the
per-method checks in `core` are the only code that decides access. The HTML
handlers and the JSON API are thin adapters over the same methods, so they
cannot disagree. The brief's warning ("if I can curl another judge's scores
it is not isolation") is structurally impossible to regress from a template.
`TestAuthorizationMatrix` pins 39 endpoint × role outcomes.

**The database is the backstop for integrity rules.** Deadline, conflict of
interest, score ranges, vote budget, one live project per team, reviews only
for assigned projects, and append-only audit are all SQL constraints or
triggers. The service checks them first for friendly errors. The triggers
guarantee that a new endpoint, a script, or a future contributor's bug still
cannot break them. `TestDeadlineEnforcedByDatabase` proves it with raw SQL.

**Roles are per event.** `event_roles(event, user, role)`. Last year's
participant can judge this year, and the judge+participant exclusion is a
trigger keyed on the event.

**Tamper-evident audit, written in the same transaction.** `store.Audit` runs
inside the transaction that made the change, so the change and its record
commit together or not at all. Each row stores `SHA-256(prev ‖ fields)`. The
organizer's audit page re-walks the chain and shows where it breaks.

**Transactional outbox for webhooks.** Deliveries are rows written in the
same transaction as the event that caused them. A background worker POSTs
them with an HMAC signature and exponential backoff. A rolled-back change
never fires a webhook, and a committed one is never lost to a crash.

**Server-rendered HTML, progressive enhancement.** Go `html/template` with
contextual escaping, one CSS file, and ~80 lines of optional JS (live
dashboard polling, copy buttons, keyboard shortcuts for pairwise mode). No
build step and no node_modules; every page works with JS off. A strict CSP
forbids inline and third-party scripts.

**Pure maths package with a simulation harness.** Normalization is where
platforms hand-wave. Keeping it in `src/judging` without I/O means it is
unit tested against planted effects and validated by Monte Carlo on the
fixture's real review graph (`dogfood simulate`). The results page uses the
exact same functions. Analyses are memoised by a hash of their inputs, so
the page only recomputes when a score, weight or exclusion changes.

**Interchange format = the fixture format.** Import and export use the
organisers' own `fixtures.json` shape (extended with optional fields). That
is the migration path in and out, and it lets another team's portal read our
export.

## Request lifecycle (example: a judge saves a review)

1. `web.authenticate` resolves the bearer token or session cookie to a user.
   Only hashes are looked up.
2. `web.page` / `web.api` checks the CSRF token for cookie-authenticated writes.
3. `core.SubmitReview`:
   - Is the caller a judge in this event?
   - Is judging open?
   - Is the project assigned to them? (403 before validation)
   - Validates every criterion against its scale.
   - One transaction: upsert the review, its values and the assignment
     status, append the audit row (values included), write the webhook outbox.
4. The database re-checks: FK to `assignments`, range trigger.
5. The dashboard's poller sees the new count within 5 seconds.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DOGFOOD_ADDR` | `:8080` | listen address |
| `DOGFOOD_DB` | `data/dogfood.db` | SQLite file (`/data/dogfood.db` in Docker) |
| `DOGFOOD_FIXTURES` | `fixtures.json` | imported on first boot if no events exist |
| `DOGFOOD_DEMO` | `1` | known demo passwords and tokens; **set 0 for real events** |
| `DOGFOOD_PUBLIC_URL` | – | base for invite and activation links behind a proxy |
| `DOGFOOD_SECURE_COOKIES` | `0` | set when served over HTTPS |
| `DOGFOOD_TRUST_PROXY` | `0` | honour `X-Forwarded-For` (only behind your own proxy) |

## What I would change at 100× scale

- A read pool alongside the single writer, or Postgres. `store` is the only
  package that knows it is SQLite, apart from a few SQLite-flavoured queries.
- Move rate-limit buckets to the database or Redis for multiple instances.
- Compute the bootstrap in a background job, with results pushed to the page.
