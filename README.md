# Dogfood Judge

**A self-hosted hackathon submission and judging platform whose results you
can defend.** Judge isolation is enforced by the backend. A documented
normalization corrects judge leniency and scale use, and says how certain
each rank is. There is a Bradley–Terry pairwise mode, a tamper-evident audit
trail, and one command to run it all offline.

Built for [DOGFOOD 2026](https://dogfoodhack.com/spec) ("build the platform
that will judge you"). MIT licensed. Go + SQLite, one binary, no cloud.

```bash
docker compose up
# → http://localhost:8080, seeded with the DOGFOOD fixtures (41 projects, 30 judges, 126 reviews)
```

The first build downloads the Go and Alpine base images and Go modules. After
that, the portal runs with the network off and never makes an outbound
request (webhooks go only to URLs an organizer configures).

Without Docker (Go 1.26+):

```bash
go run ./src/cmd/dogfood          # uses ./fixtures.json and ./data/dogfood.db
```

---

## Demo accounts

Demo mode (`DOGFOOD_DEMO=1`, the compose default) sets every seeded account's
password to **`dogfood-demo`** and installs stable API tokens for the
acceptance checker. The seed prints them on boot. **Set `DOGFOOD_DEMO=0`
before running a real event.**

| Role                     | Sign in as                  | API header                                      |
| ------------------------ | --------------------------- | ----------------------------------------------- |
| Admin                    | `admin@dogfood.local`       | `Authorization: Bearer demo-admin-7c1e9b`       |
| Organizer                | `organizer@dogfood.local`   | `Authorization: Bearer demo-organizer-4f2a81`   |
| Judge (jdg_26)           | `jonas.vogel@example.org`   | `Authorization: Bearer demo-judge-a-91bc3d`     |
| Judge (jdg_24)           | `diego.herrera@example.org` | `Authorization: Bearer demo-judge-b-44de5f`     |
| Participant (team tm_07) | `sana7@example.org`         | `Authorization: Bearer demo-participant-2e88a0` |

Any fixture judge or team-member email works with the demo password.

Two events are seeded:

- **Sample Hack 2026** (`evt_01`, the fixtures). Submissions are closed, judging
  is open, and **community voting is open for 48 hours from first boot**.
  Results cannot be published while voting is open (that is the T3 rule); to
  publish sooner, set the voting close to now in _Settings_, and the change is
  audited.
- **Playground Hack**: submissions open for 7 days from first boot, for trying
  team formation and submission live.

## A five-minute tour (the demo video script)

1. **Create.** Sign in as admin → _New event_ → dates, tracks, criteria.
   _Settings_: re-weight the rubric, add prizes, invite a judge (copy link).
2. **Submit.** As a participant on _Playground Hack_: create a team, copy the
   invite link, join as a second account, save a draft, submit, edit again.
   Move the deadline into the past as organizer. Edits now fail, even through
   the API, and even with raw SQL (database trigger).
3. **Judge.** As `jonas.vogel@example.org`: _Judging_ shows your queue and why
   each project was assigned to you. Score with the rubric; try _Pairwise
   mode_ (A / B / T keys). Try to read another judge's scores:
   `curl -H "Authorization: Bearer demo-judge-b-44de5f" localhost:8080/api/v1/judge/scores?judge=jdg_26`
   returns **403**.
4. **Watch.** As organizer, the dashboard updates live as reviews arrive; the
   assignment engine tops up the unfinished batches.
5. **Decide.** _Results_ shows raw vs normalized scores, the rank change, 90%
   rank intervals and P(top 3). Judge diagnostics flag **jdg_07** (flat scorer)
   and the one-review judges; prj_41 is excluded as a duplicate of prj_07.
6. **Publish.** Publish, then open the public results page, a judge's signed
   participation record, and verify it at `/verify` (a one-character edit fails).
   The audit log shows every step, hash-chained.

## What is built: tiers claimed and evidence

`.dogfood.toml` claims **T1 T2 T3 T4**. `run.py` has checks for T1 and T2
only, so it prints `verified T1 T2` and _"claimed but not verified: T3 T4"_.
That is the checker having no T3/T4 checks, not a failure. The T3/T4 evidence
is [`extended-report.txt`](extended-report.txt), produced by
[`tools/extended_check.py`](tools/extended_check.py): same style as run.py,
standard library only, read-only against the running portal. The integration
tests in `tests/` cover the same ground.

| Tier   | Feature                                                                                                            | Where                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **T1** | Auth and sessions (PBKDF2, hashed tokens, 14-day sessions)                                                         | `src/core/auth.go`                                |
|        | Role model: visitor, participant, judge, organizer (**per event**), admin                                          | `event_roles`, `core.require`                     |
|        | Events with dates, tracks, prizes                                                                                  | `/organize/new`, _Settings_                       |
|        | Team formation by invite link (rotatable, size-limited)                                                            | `src/core/teams.go`                               |
|        | Draft → submit → edit until deadline                                                                               | `/events/{slug}/team`                             |
|        | **Deadline enforced by service and database triggers**, with per-team audited extensions                           | `0001_init.sql`, `TestDeadlineEnforcedByDatabase` |
|        | Public gallery with search and track/event filter                                                                  | `/projects`, `/events/{slug}/projects`            |
| **T2** | Judge invitation (single-use links) and **assignment engine** (track match, COI, load balance, graph connectivity) | JUDGING.md §1                                     |
|        | Weighted rubric the organizer configures                                                                           | _Settings → Rubric_                               |
|        | **Backend role isolation** (39-case authorization matrix test)                                                     | `src/core`, `TestAuthorizationMatrix`             |
|        | Live organizer dashboard (polls every 5 s)                                                                         | `/organize/{slug}`                                |
|        | **Cross-judge normalization, documented and validated**                                                            | JUDGING.md §3–4                                   |
|        | CSV export (scores, results), formula-injection safe                                                               | `/api/v1/events/{e}/export/*.csv`                 |
| **T3** | Community voting (authenticated, per-voter budget)                                                                 | `/events/{slug}/ballot`                           |
|        | Project comments with moderation                                                                                   | `/p/{id}`                                         |
|        | Results hidden during voting; publishing refused while voting is open                                              | `core.Publish`, `core.Results`                    |
|        | Ballot order shuffled per voter (stable on reload)                                                                 | `core.Ballot`                                     |
|        | Anti-abuse: rate limits, duplicate detection (projects, votes, comments), held-vote queue, audit trail             | THREAT-MODEL.md                                   |
| **T4** | REST API for everything + OpenAPI 3.1 + signed webhooks with retries                                               | `/api`, `/api/v1/openapi.yaml`                    |
|        | Certificates and records (printable, signed)                                                                       | `/events/{slug}/certificate`                      |
|        | **Signed, publicly verifiable judge records** (Ed25519, offline CLI verification)                                  | `/judge/{slug}/record`, `/verify`                 |
|        | Embeddable gallery widget (`<iframe src="…/embed/evt_01">`)                                                        | `/embed/{event}`                                  |
|        | Bulk import/export in the fixtures format, id remapping                                                            | `/api/v1/import`, `export.json`                   |

### Bonus challenges

| Challenge                      | Status                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normalization Proof** (Hard) | Done. Leniency + scale model with empirical-Bayes shrinkage, uncertainty by bootstrap, a connectivity check, proof on the fixture ([docs/normalization-proof.md](docs/normalization-proof.md)), and a Monte Carlo comparison against raw means and z-scores on the fixture's own review graph ([docs/simulation.md](docs/simulation.md)), including the case where it _loses_. [JUDGING.md](JUDGING.md) |
| **Pairwise Mode** (Hard)       | Done. Bradley–Terry by MM with a regularising prior, standard errors from the information matrix, adaptive pair selection (validated against random), server-chosen pairs so judges cannot steer. JUDGING.md §5                                                                                                                                                                                         |
| **Threat Model** (Medium)      | Done. [THREAT-MODEL.md](THREAT-MODEL.md), with what we stop and what we do not.                                                                                                                                                                                                                                                                                                                         |
| **API First** (Medium)         | Done. Every UI action is in the API; [`openapi.yaml`](src/web/static/openapi.yaml), served at `/api/v1/openapi.yaml`.                                                                                                                                                                                                                                                                                   |

## Checks and tests

```bash
docker compose up -d
python3 run.py .dogfood.toml > acceptance-report.txt           # T1, T2 (organisers' checker)
python3 tools/extended_check.py .dogfood.toml > extended-report.txt   # T3, T4
go test ./...                                                   # unit + integration (~1 min)
go run ./src/cmd/dogfood normalize fixtures.json                # the normalization proof
go run ./src/cmd/dogfood simulate fixtures.json                 # the Monte Carlo validation (~4 min)
```

`tests/` boots the whole portal in-process (real SQLite, real seed, real HTTP)
and covers: the run.py checks, a 39-case authorization matrix, database-level
deadline and conflict-of-interest enforcement, the full lifecycle (teams,
invites, drafts, deadline, reviews, pairwise, publish, signed records), voting
rules and hidden results, audit-chain tamper detection, CSRF, CSV injection,
login rate limiting, webhook delivery and signatures, import/export round trip,
and every HTML page for every role. The maths has its own unit tests in
`src/judging/`.

## Operating it

- **Data**: one SQLite file in the `dogfood-data` volume. Back it up with
  `docker compose cp dogfood:/data/dogfood.db ./backup.db` (stop first, or
  use `sqlite3 .backup`). `docker compose down -v` resets to a fresh seed.
- **Real event**: set `DOGFOOD_DEMO=0`, set the admin password
  (`docker compose exec dogfood dogfood set-password admin@dogfood.local`),
  and put it behind HTTPS with `DOGFOOD_SECURE_COOKIES=1` and
  `DOGFOOD_PUBLIC_URL`.
- **Imported judges and participants** have no password until an organizer
  sends them an activation link (dashboard → _Activation link_). Sign-up
  deliberately cannot claim an imported email.
- **Moving data**: _Dashboard → Exports → full event JSON_, then
  `POST /api/v1/import` on another instance.

## Honest limitations

- **No email.** Offline by design, so invitations, activation links and team
  invites are links the organizer or team copies. No password-reset email: an
  organizer issues an activation link, or an operator uses `dogfood set-password`.
- **Voting is account-based only.** The brief allows email-gated,
  link-based or authenticated voting. Without an email service, patient
  multi-network Sybil voting with aged accounts is not stopped
  (THREAT-MODEL.md explains what is).
- **Normalization runs on the rubric composite**, not per criterion.
- **Rate limits are in memory** (one process); a restart resets them. Running
  `tools/extended_check.py` trips the login limiter for localhost for about
  a minute; that is the check working.
- **No manual unassign.** The engine only adds assignments; judges can recuse.
- **UI times are UTC.** Accessibility is semantic HTML and keyboard-operable
  forms, not audited.
- **Docker needs network for the first build** (base images and Go modules);
  running needs none.
- On the fixture data the leniency correction is small. The data shows no
  judge leniency beyond noise, and the report says so rather than inventing
  corrections. The simulation shows what happens when leniency is real.

## Documents

[ARCHITECTURE.md](ARCHITECTURE.md) · [DATA-MODEL.md](DATA-MODEL.md) ·
[JUDGING.md](JUDGING.md) · [THREAT-MODEL.md](THREAT-MODEL.md) ·
[acceptance-report.txt](acceptance-report.txt) · [extended-report.txt](extended-report.txt)

## License

MIT, see [LICENSE](LICENSE). You keep ownership, and so does anyone who forks it.
