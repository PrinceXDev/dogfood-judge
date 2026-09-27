# Data model

SQLite, one file (`/data/dogfood.db` in the container). Schema:
[`src/store/migrations/0001_init.sql`](src/store/migrations/0001_init.sql),
applied automatically at boot and tracked in `schema_migrations`.

## Conventions

- **Ids are prefixed strings**: `usr_`, `evt_`, `trk_`, `tm_`, `prj_`,
  `crt_`, `cmt_`, `whk_`. Fixture ids (`prj_01`, `jdg_26`) are kept as-is on
  import, so a URL or log line tells you what kind of thing it points at.
- **Timestamps are `TEXT` in `YYYY-MM-DDTHH:MM:SSZ`**, UTC, fixed width. String
  order equals time order, which lets triggers compare against
  `strftime('%Y-%m-%dT%H:%M:%SZ','now')` directly.
- **Rules that protect integrity live in the database**, not only in Go:
  deadline, conflict of interest, score range, vote budget, one live project
  per team, reviews only for assignments, append-only audit. The service
  layer checks them too, for good error messages. The database is the backstop.

## Entities

```
users ─┬─< credentials            (sessions, API tokens, activation links; hashed)
       ├─< event_roles >─ events  (organizer | judge | participant, per event)
       │                    ├─< tracks ─< prizes
       │                    ├─< criteria            (rubric: key, weight, scale)
       │                    ├─< invitations         (judge/organizer links; hashed)
       │                    ├─< teams ─< team_members >─ users
       │                    │     └─< deadline_extensions
       │                    ├─< projects (team, track, draft|submitted, duplicate_of)
       │                    ├─< assignments (judge × project, reason, status)
       │                    │     └─ reviews ─< review_scores >─ criteria
       │                    ├─< pairwise_offers / comparisons
       │                    ├─< votes, comments
       │                    └─< webhooks ─< webhook_deliveries
       ├─ judge_tracks            (expertise, for assignment)
settings                          (instance secret, Ed25519 signing key)
audit_log                         (hash-chained, append-only)
```

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | Accounts. `password_hash` NULL means imported and not yet activated. `is_admin` is the only global role. | `email` unique, case-insensitive |
| `credentials` | Session, API and activation tokens. Only SHA-256 hashes are stored. | `kind` enum; activation tokens cannot authenticate |
| `events` | Dates for submissions, judging, voting and publication; limits. | `open < close`; `voting_open < voting_close` |
| `event_roles` | **Roles are per event.** The same person can judge one event and compete in another. | Trigger: judge and participant are mutually exclusive in an event |
| `tracks`, `prizes`, `criteria` | Event configuration. | `UNIQUE(id, event_id)` so children can reference a track *of the same event* |
| `teams`, `team_members` | Invite-link teams. Team names are not unique (the fixture repeats "StillTrail" three times). | `UNIQUE(event_id, user_id)`: one team per person per event; composite FK keeps team and member in the same event |
| `projects` | Draft or submitted; `origin` = portal or import; organizer flags `duplicate_of` and `disqualified_reason`. | Partial unique index: one project per team where `duplicate_of IS NULL`; composite FKs to team and track of the same event; deadline triggers |
| `deadline_extensions` | Per-team extra time, honoured by the triggers. | |
| `assignments` | Judge × project with the engine's reason and a status. | PK `(judge, project)` |
| `reviews`, `review_scores` | One review per assignment, one value per criterion. | FK to `assignments`; range trigger against the criterion's scale |
| `pairwise_offers`, `comparisons` | Current offer per judge, and verdicts. | Verdict must match the offer (service) |
| `votes` | Per voter per project, with hashed IP/UA and a `flagged` reason when held. | PK `(event, user, project)`; budget trigger |
| `comments` | Moderated by hiding, never deleting. | Length check |
| `webhooks`, `webhook_deliveries` | Transactional outbox for outgoing events. | |
| `audit_log` | Every consequential action, hash-chained. | Update and delete triggers abort |

### Why scores are normalized rows, not a JSON blob

`review_scores(judge, project, criterion, value)` means re-weighting the rubric
is a query, not a migration. The range trigger can check each value against
*its* criterion. Criteria can be added mid-event without touching old reviews.
Composite scores are derived (Σ w·v / Σ w) and never stored, so they cannot go
stale.

### Why roles are per event

A hackathon platform hosts many events, and people move between roles: last
year's winner judges this year. A global role column can't express that, and
it can't express the conflict-of-interest rule either. The trigger that
forbids judge+participant needs the event in the key.

## Import

`fixtures.json` (the organisers' format) is the import format. Import
(`POST /api/v1/import`, `dogfood import file.json`, or automatically on first
boot):

1. Creates the event. The submission window opens a day before the earliest
   submission unless `submissions_open` is given.
2. Creates tracks. Criteria are taken from `criteria` if present, otherwise
   inferred from score keys (equal weight, scale 1–5).
3. Creates judges (the user id is the fixture judge id when free) with
   `judge` role and track expertise.
4. Creates teams and members as password-less accounts with `participant`
   role. Anyone who would be both judge and participant is kept as judge and
   reported.
5. Inserts projects **oldest first**, with `origin = 'import'` so the
   deadline trigger accepts historic rows, and detects duplicates
   (normalised title/repo, second project from the same team).
6. Inserts each score as a completed assignment plus review.
7. **Remaps any id already used** on this instance and reports each remap, so
   the same export can be imported twice or into another team's portal.
8. Writes one audit entry with counts, duplicates and warnings.

On the fixture: 41 projects, 126 reviews, 121 accounts, 1 duplicate
(`prj_41` → `prj_07`, same title and repository).

## Export: the way out

- `GET /api/v1/events/{event}/export.json` (or `dogfood export evt_01`): the
  whole event in the same fixtures format, plus criteria, weights, dates,
  duplicate flags and judge tracks. Import it into another instance and the
  results come out identical (`TestImportExportRoundTrip`).
- `scores.csv`: one row per review, one column per criterion, weighted score,
  comment. Formula-injection safe.
- `results.csv`: rank, adjusted score, SE, 90% rank interval, P(top 3), raw
  mean and rank, rank change, and the z-score, bias-only and induced-pairwise
  ranks.
- The SQLite file itself: `docker compose cp dogfood:/data/dogfood.db .`
  (WAL mode; stop the container or use `sqlite3 .backup` for a consistent copy).

## Migrations

Numbered files in `src/store/migrations/`, applied in order inside a
transaction at boot, and recorded in `schema_migrations`. A new version adds
`0002_*.sql`. Existing files are never edited once released.
