# Architecture

## Shape

Two processes, one SQLite file, no other moving parts.

```
 browser / curl / run.py
          │
          ▼
  Go  :8080  (src/cmd/dogfood)  ─── the edge
   ├─ /api/v1/*, /.well-known/*, /healthz ──► src/web (JSON API) ──► src/core ──► src/store ──► SQLite (WAL)
   │                                                               (service +     (migrations,   triggers enforce
   │                                                               authorization)  audit chain)  deadline, COI, ranges
   │                                                                   │
   │                                                                   └──► src/judging (pure maths)
   └─ every other path ──► reverse proxy ──► Next.js :3000 (src/frontend)
                                                  │ server components + server actions
                                                  └──► Go /api/v1 (Bearer = the user's session)
```

| Part | Responsibility | Depends on |
|---|---|---|
| `src/cmd/dogfood` | Entry point: `serve`, plus offline tools `normalize`, `simulate`, `verify-record`, `verify-results`, `import`, `export`, `set-password`. | everything below |
| `src/web` | The JSON API and the edge proxy. Turns requests into service calls and service errors into status codes. **No authorization logic.** | core |
| `src/core` | The service layer. Every read and write, **every access decision**, audit writes, the webhook outbox, signed records and results bundles. | store, judging |
| `src/store` | SQLite with the right pragmas, migrations, transactions, the hash-chained audit log. | – |
| `src/judging` | Scoring maths with no I/O: normalization, robustness, outliers, Bradley–Terry, assignment, simulation. | – |
| `src/seed` | First-boot data: accounts, fixture import, demo tokens. | core |
| `src/frontend` | Next.js 16 (App Router) + Tailwind CSS 4, linted and formatted with Biome. A pure client of the API: it holds no data and decides nothing. | Go API |

## Decisions and why

**Go and pure-Go SQLite for the core.** The hardest requirement is "comes up
on a laptop with the network off". A static binary with one data file, and no
database service, is the smallest thing that meets it. Backup is copying a
file. At hackathon scale SQLite is not the bottleneck: the full normalization
with a 300-sample bootstrap, 30 leave-one-judge-out refits and outlier
refits takes well under a second, and it is memoised by input hash.

**Next.js is a client, not a backend.** Every page is server-rendered from
`/api/v1` calls, and every form is a server action that forwards the user's
session to Go as a bearer token. There is no second database, no business
logic and no authorization in the frontend. The API-first claim is literal:
the official UI uses exactly the public API, so anything the UI can do, a
script can do. The session token lives in an httpOnly cookie and never
reaches browser JavaScript. Next.js checks the Origin of every server action,
which covers CSRF for form posts, and Go still enforces its own CSRF check on
cookie-authenticated API writes.

**Go is the edge, not Next.js.** Rate limits and vote-abuse rules key on the
client address. Next.js sets `X-Forwarded-For` only when the client did not
send one (`??=` in `base-server.js`), so behind Next a client could claim any
IP. Go instead answers the API itself and proxies pages with
`httputil.ReverseProxy` in `Rewrite` mode, which strips client-supplied
forwarding headers; then Go stamps its own. It trusts `X-Forwarded-For` only
on requests from the frontend's resolved address: the server-side calls that
carry the real client, as Go stamped them. `run.py` and curl talk to Go
directly.

**One database connection (`SetMaxOpenConns(1)`) and `BEGIN IMMEDIATE`.**
SQLite allows one writer anyway. A single connection makes every
transaction serialisable, which the audit hash chain depends on, and removes
`SQLITE_BUSY` as a failure mode. A read pool is the first knob to turn if
scale ever demands it.

**Authorization lives in one place.** `core.Service.require(...)` and the
per-method checks in `core` are the only code that decides access. The brief's
warning ("if I can curl another judge's scores it is not isolation") cannot
regress from a template or a React component, because none of them make
decisions. `TestAuthorizationMatrix` pins 39 endpoint × role outcomes.

**The database is the backstop for integrity rules.** Deadline, conflict of
interest, score ranges, vote budget, one live project per team, reviews only
for assigned projects, and append-only audit are all SQL constraints or
triggers. The service checks them first for friendly errors; the triggers
guarantee a new endpoint or a bug cannot break them.
`TestDeadlineEnforcedByDatabase` proves it with raw SQL.

**Roles are per event.** `event_roles(event, user, role)`: last year's
participant judges this year, and the judge+participant exclusion is a
trigger keyed on the event.

**Tamper-evident audit, written in the same transaction.** Each row stores
`SHA-256(prev ‖ fields)`. The organizer's audit page re-walks the chain and
shows where it breaks. Published results are anchored to it (see below).

**Verifiable results.** Publication exposes a bundle: pseudonymized inputs
plus an Ed25519-signed manifest committing to their fingerprint, the ranking
and the audit hash of the publication. The portal and the offline verifier
call the same function (`core.RankInputs`), so "re-run it yourself" is
literal. See JUDGING.md §7.

**Transactional outbox for webhooks.** Deliveries are rows written in the
same transaction as the change, then POSTed by a worker with an HMAC
signature and exponential backoff. A rolled-back change never fires, and a
committed one is never lost.

**Pure maths package with a simulation harness.** Normalization is where
platforms hand-wave. Keeping it in `src/judging` without I/O means it is
unit-tested against planted effects and validated by Monte Carlo on the
fixture's real review graph (`dogfood simulate`). The results page uses the
exact same functions.

**Interchange format = the fixture format.** Import and export use the
organisers' own `fixtures.json` shape, extended with optional fields. That is
the migration path in and out.

## Request lifecycle (example: a judge saves a review)

1. The browser POSTs the rubric form (a server action) to `:8080`. Go
   proxies it to Next.js, stamping `X-Forwarded-For` with the real address.
2. Next.js checks the action's Origin, reads the httpOnly session cookie, and
   calls `PUT /api/v1/events/{e}/reviews/{p}` on Go with `Authorization:
   Bearer`, forwarding the client address.
3. Go authenticates the token and trusts the forwarded address because the
   call comes from the frontend's address.
4. `core.SubmitReview`:
   - Is the caller a judge in this event?
   - Is judging open?
   - Is the project assigned to them? (403 before any validation)
   - Validates each criterion against its scale.
   - One transaction: upsert the review and its values, mark the assignment
     done, append the audit row (values included), write the webhook outbox.
5. The database re-checks: FK to `assignments`, range trigger.
6. The action calls `redirect`; the organizer's live dashboard sees the new
   count within 5 seconds.

## Configuration

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `DOGFOOD_ADDR` | api | `:8080` | listen address |
| `DOGFOOD_DB` | api | `data/dogfood.db` | SQLite file (`/data/dogfood.db` in Docker) |
| `DOGFOOD_FIXTURES` | api | `fixtures.json` | imported on first boot if no events exist |
| `DOGFOOD_FRONTEND_URL` | api | – | Next.js server to proxy pages to (`http://web:3000` in compose); empty = API only |
| `DOGFOOD_DEMO` | api | `1` | known demo passwords and tokens; **set 0 for real events** |
| `DOGFOOD_PUBLIC_URL` | api | – | base for links the API builds, behind a proxy |
| `DOGFOOD_SECURE_COOKIES` | api, web | `0` | set when served over HTTPS |
| `DOGFOOD_TRUST_PROXY` | api | `0` | honour `X-Forwarded-For` from any peer (only behind your own reverse proxy) |
| `API_URL` | web | `http://127.0.0.1:8081` | where Next.js reaches the Go API (`http://api:8080` in compose) |

## What I would change at 100× scale

- A read pool alongside the single writer, or Postgres. `store` is the only
  package that knows it is SQLite, apart from a few SQLite-flavoured queries.
- Rate-limit buckets in the database or Redis for multiple API instances.
- Run the bootstrap and leave-one-judge-out refits in a background job, with
  results pushed to the page.
