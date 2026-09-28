## What

<!-- One or two sentences: what this PR changes. -->

## Why

<!-- The problem or requirement behind it. Link the issue if there is one. -->

## How

<!-- Key implementation decisions. Mention schema, API or judging-math changes explicitly. -->

## Tiers / areas touched

- [ ] T1 core (auth, roles, events, teams, submissions, gallery)
- [ ] T2 judging (assignment, rubric, isolation, dashboard, normalization, CSV)
- [ ] T3 public (voting, comments, anti-abuse, audit)
- [ ] T4 stretch (API, webhooks, records, embed, import/export)
- [ ] Frontend (src/frontend: Next.js, Tailwind, Biome)
- [ ] Docs (README, ARCHITECTURE, DATA-MODEL, JUDGING, THREAT-MODEL)
- [ ] Infra (Dockerfile, docker-compose, seed)

## Checks

- [ ] `go vet ./...` and `gofmt -l ./src ./tests` are clean
- [ ] `go test ./...` passes
- [ ] `cd src/frontend && npm run check && npm run build` passes (types, Biome, build)
- [ ] `python3 run.py .dogfood.toml` still verifies T1 T2
- [ ] `python3 tools/extended_check.py .dogfood.toml` still passes T3, T4 and BONUS
- [ ] `docker compose down -v && docker compose up` comes up seeded
- [ ] New API routes have a row in `TestAuthorizationMatrix` and an entry in `openapi.yaml`
- [ ] Schema changes are a new migration file, not an edit to an existing one
- [ ] `acceptance-report.txt` / docs regenerated if behaviour changed

## Honest gaps

<!-- Anything not done, known limitations, or follow-ups. "None" is fine. -->
