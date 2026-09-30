# Feature plan: what to build next

This plan takes the seven recommended features, checks each one against what
the code already does, and says what is worth building, in what order, and how.
The rule from the rest of the project still applies: every number shown must
come from real data, and any claim the engine makes must be reproducible
offline.

## Summary

| # | Feature | Already in the code | Build | Effort | Priority |
|---|---------|---------------------|-------|--------|----------|
| 1 | Organizer playbook and checklist | Command-center alerts | Checklist derived from event state, Markdown export | S | **1** |
| 2 | Judge calibration panel | Per-judge leniency, SE, scale, flags | Forest plot, scale-use histograms, "without this judge" top-k | S–M | **2** |
| 3 | Assignment and COI graph | Conflict list, recusal, component count | Assignments endpoint, graph view, recusal what-if | M | **3** |
| 4 | Rank uncertainty, live | Bootstrap intervals, P(top 3), 5 s polling | Rank distributions, P(top 10), density plot | M | **4** |
| 5 | Adaptive pairwise, explained | Uncertainty-sampling `NextPair` | "Why this pair", convergence metric, variance-based score | M | **5** |
| 6 | Per-review inclusion proofs | Input digest, signed manifest, audit chain | Merkle root in manifest v2, `verify-review` CLI | M | **6** |
| 7 | Judge fatigue signals | `assigned_at`, `completed_at`, `updated_at` | Drift and flattening flags, pairwise streak limit | S–M | **7** |

**Not recommended**, with reasons given under each feature: reweighting a
judge's reviews by a hand-picked factor, a PDF playbook with auto-captured
screenshots, and replacing the bootstrap with a full Bayesian Bradley–Terry
model for scored reviews.

Suggested order: 1 and 2 first (small, visible, no schema changes), then 3 and
4 (new read endpoints), then 5 and 6 (engine and crypto work), then 7 (it
needs more data per judge than the fixture has to be convincing).

---

## 1. Organizer playbook and checklist

**Why first.** It is the cheapest feature on the list and targets
adoptability directly: an organizer who has never used the tool should be able
to run an event without asking anyone.

**Already there.** The command center (`app/organize/[event]/page.tsx`) derives
"attention required" items from real data: under-assigned projects, prize
boundary, statistical ties, flagged judges, held votes, inactive judges.

**Build.**

- A checklist whose steps are *derived from event state*, not ticked by hand.
  Nothing new is stored, so it can never drift from reality:

  | Step | Done when |
  |------|-----------|
  | Event created, dates set | `submissions_close_at` set |
  | Rubric has ≥ 1 criterion | `criteria.length > 0` |
  | Judges invited | `judges.length ≥ reviews_per_project` |
  | Judges activated | every judge `can_login` |
  | Submissions closed | now ≥ `submissions_close_at` |
  | Assignments run | `progress.assignments > 0` and `unassigned == 0` |
  | Judge groups connected | `report.components == 1` |
  | Judging complete | `progress.percent == 100` |
  | Prize boundary resolved | no project with 5% < P(top k) < 95%, or the tie-breaker has run |
  | Voting closed, held votes reviewed | `voting_close_at` passed and `flagged_votes == 0` |
  | Results published and signed | `results_published_at` set |

  Each step links to where it is done (settings, assignment engine,
  moderation, results).
- A per-event playbook page (`/organize/[event]/playbook`) that renders the
  checklist plus the event's own values (slug, deadlines, judge count, invite
  instructions, export and bundle URLs), with a **Download as Markdown**
  button.
- A troubleshooting section built from things the product already handles:
  lost judge link (activation link), deadline extension for one team,
  duplicate projects (moderation), results blocked by open voting, split
  judge groups (assignment engine).

**Files.** `app/organize/[event]/playbook/page.tsx`, `lib/checklist.ts`
(a pure function from event, progress and report to steps), a sidebar entry in
`components/shell/org-nav.tsx`. No backend changes.

**Not recommended.** A PDF with automatically captured screenshots. It needs a
headless browser in the container, goes stale as soon as the UI changes, and
adds nothing a Markdown export plus the live page don't already give.
Browsers can print the page to PDF.

**Tests.** Unit-test `lib/checklist.ts` against fixture-shaped inputs for each
event phase.

---

## 2. Judge calibration panel

**Already there.** The engine reports, per judge: `bias` (leniency) with
`bias_se`, `scale`, `mean_given`, `sd_given`, `agreement`, `influence`,
`flips_top_k`, `flips_first`, and flags (`lenient`, `harsh`, `compressed`,
`flat`, `contrarian`, `low data`). The results page shows a table and a
per-judge inspector.

**Build.**

- **Leniency forest plot**: one row per judge, the estimated leniency with a
  90% interval (±1.645 × `bias_se`), a zero line, and judges whose interval
  excludes zero highlighted. This is the "heatmap" from the recommendation in
  a form that shows uncertainty honestly; a colour grid would hide the
  intervals.
- **Scale-use strip**: for each judge, a small histogram of the criterion
  values they gave (from `GET /events/{id}/reviews`, which organizers already
  have). "jdg_07 only uses 4" becomes visible at a glance.
- **"Without this judge" top-k**: the engine already refits the model once
  per removed judge (`robustness()` in `src/judging/robust.go`) but only
  returns whether the winner and top-k changed. Extend `Robustness` with
  `refit_top_k map[judge][]project` so the UI can say "without jdg_24, the
  top 3 becomes {A, B, D}". There's no extra computation; the ranking is
  already there and currently discarded.

**Not recommended.** "Reweight jdg_07's reviews by 0.6". The model already
estimates each judge's scale and leniency from the data; an arbitrary manual
weight would undo that with no principled value to choose. The defensible
what-if is removing a judge, which is what the engine already refits.

**Files.** `src/judging/robust.go` (+ field, + test), `src/web/static/openapi.yaml`,
`lib/types.ts`, `components/viz/calibration.tsx`, a new section in
`app/organize/[event]/results/page.tsx`.

**Tests.** Go: `refit_top_k` has one entry per judge and agrees with
`top_k_flips`. Fixture check: `jdg_07` (flat) shows a single-value histogram.

---

## 3. Assignment and COI graph

**Already there.** `AssignInput.Judges[].Conflict` keeps judges away from
their own team's project and declared conflicts; judges can recuse with a
reason; `judging.Components` counts connected components and the results page
warns when it is greater than 1. What is missing is visibility: no endpoint
lists all assignments for an event.

**Build.**

- `GET /api/v1/events/{event}/assignments` (organizers only): every
  assignment with `judge`, `project`, `status` (pending, done, recused),
  `reason` and `recuse_reason`. Add it to the authorization matrix test.
- A bipartite graph view: judges on one side, projects on the other, edges
  coloured by status. Connected components are coloured distinctly; isolated
  projects and bridge edges (an edge whose removal splits the graph) are
  marked.
- **Recusal what-if**: the organizer selects edges to remove and the view
  recomputes components client-side (union-find on at most a few hundred
  edges, no server call). For example: "if jdg_12 recuses from prj_05 the
  graph stays connected; if jdg_03 also recuses, prj_05 is isolated."
- An **identifiability note**: scores in different components can't be put on
  one scale (`JUDGING.md` explains why). The view links to the assignment
  engine, which already adds bridging reviews.

**Files.** `src/core/judging.go` (a `EventAssignments` query plus a role
check), `src/web/api.go`, `openapi.yaml`, `tests/portal_test.go`,
`components/viz/assignment-graph.tsx`, a section on the command center
(`#judges`).

**Performance.** The fixture has about 134 edges. Use a two-column layout
rather than force-directed layout: it is deterministic and readable, and it
scales to a few hundred edges.

---

## 4. Rank uncertainty, live

**Already there.** The bootstrap (300 resamples) gives each project a 90% rank
interval, P(top k) with k = 3, and P(ahead of next). The command center polls
`/progress` every 5 s, and `Service.analyze` memoises the report by a hash of
its inputs.

**Build.**

- Return the **rank distribution** from the bootstrap: for each project, a
  count per rank (at most N × N integers, which is tiny). P(top 10) and any
  other P(top n) then fall out on the client with no refit.
- A **rank density plot** for the top 10 on the results page: overlapping
  distributions make ties obvious without reading numbers.
- **Live refresh**: re-fetch results when `/progress.done` changes. The
  memoised analyze means only real review changes trigger a refit.

**Not recommended.** A full Bayesian Bradley–Terry model for *scored*
reviews. The scored model is already fitted by penalised maximum likelihood
with empirical-Bayes shrinkage, and the bootstrap already gives calibrated
rank uncertainty (the simulation in `docs/simulation.md` checks it). A second
model would produce a second, slightly different ranking to explain. For
*pairwise* mode, `FitBT` already returns SEs; adding the same rank-distribution
output there is enough.

**Files.** `src/judging/normalize.go` (`bootstrap()` keeps the histograms it
already iterates over), `ProjectResult.RankDist []int`, `openapi.yaml`,
`lib/types.ts`, `components/viz/rank-density.tsx`.

**Tests.** Each project's `RankDist` sums to the bootstrap count, and
P(top 3) computed from it equals `prob_top_k`.

---

## 5. Adaptive pairwise, explained

**Already there.** `NextPair` in `src/judging/bt.go` is already adaptive. It
picks the unseen pair that maximises outcome uncertainty `p(1 − p)`, damped by
how often the pair and its members have been compared, with random
tie-breaking and left/right randomisation. `SimulatePairwise` compares it with
random selection at equal budgets.

**Build.**

- **Variance-aware score.** Score each pair by the expected reduction in the
  strengths' posterior variance: the Fisher information of one comparison is
  `p(1 − p)`, and its effect on `SE_a² + SE_b²` is available from the current
  fit. The pair then targets uncertain *projects*, not just close ones. Keep
  the current heuristic as a fallback and let the simulation decide: ship the
  new score only if `SimulatePairwise` shows equal or better τ and top-k
  recovery at every budget. Calling this information gain is only honest if
  the simulation backs it.
- **"Why this pair."** Return the pair's reason in `PairOffer` (for example
  "closest remaining pair: model says 52% / 48%", or "neither project has
  been compared yet") without revealing either project's strength or rank, so
  the judge isn't biased.
- **Convergence metric.** After each comparison, compute Kendall τ between
  the top 10 of the current fit and the fit of 10 comparisons ago; show it as
  a small line on the command center ("top-10 order stable at τ = 0.93").
  Store nothing: recompute from the comparisons table, which is small.
- Update `docs/simulation.md` with the adaptive-vs-random results.

**Files.** `src/judging/bt.go`, `src/judging/sim.go`, `src/core/judging.go`
(`NextPair` offer reason), `lib/types.ts`, `components/pairwise.tsx`,
`components/live-progress.tsx`.

---

## 6. Per-review inclusion proofs

**Already there.** The bundle contains every review's criterion scores with
judges pseudonymised, `InputDigest` (SHA-256 of the canonical inputs), and an
Ed25519-signed manifest anchored to the audit log.
`dogfood verify-results` re-runs the engine offline.

**Build.**

- **Manifest v2** (`dogfood.results/v2`): add `review_root`, the Merkle root
  over leaves `H(pseudonym ‖ project ‖ canonical scores)` in the bundle's
  existing sorted order. Keep v1 verification working.
- **Judge records carry their leaves.** A judge's signed record includes their
  pseudonym for the event and the leaf hashes of their reviews. Only the
  judge learns their pseudonym, so anonymity in the public bundle holds.
- **CLI**: `dogfood verify-review --bundle bundle.json --record record.json`
  proves each of the judge's reviews is in the published results unchanged,
  using an inclusion path it computes from the bundle.
- **Public badge**: "All N reviews committed under root 0x…", with the root
  next to the input fingerprint on the public results page.

**Files.** `src/core/verify.go`, `src/core/records.go`, `src/cmd/dogfood/main.go`,
`JUDGING.md` / `THREAT-MODEL.md` (what this proves and what it doesn't: it
proves inclusion and integrity after publication, not that the judge scored
honestly), tests for the proof and for tampering.

---

## 7. Judge fatigue signals

**Data reality.** The schema records `assigned_at`, `completed_at` and review
`created_at` / `updated_at`, but not when a judge *opened* a project. True
time-per-review can't be measured. The gap between consecutive completions
can, but it includes breaks. Fixture judges wrote 2–11 reviews each, which is
too few for statistical fatigue detection.

**Build (honestly scoped).**

- **Drift flag**: for judges with ≥ 8 reviews, compare the SD of residuals
  (from the fitted model) in their first half vs. second half of reviews by
  `created_at`. Flag "scores flattening" or "scores becoming erratic" only
  when the ratio passes a threshold chosen by simulation for about a 5%
  false-flag rate. Present it like the other flags: a prompt to look, not a
  verdict.
- **Pairwise streak limit**: in `NextPair`, avoid giving the same judge a pair
  that shares a project with their previous comparison (order effects), and
  suggest a pause after N consecutive comparisons in the UI.
- **Optional** (needs schema): an `opened_at` on assignments, set the first
  time a judge loads the review page. It enables real time-per-review later.
  Add it only if organizers want it, because it records judge behaviour.

**Files.** `src/judging/normalize.go` (`judgeDiagnostics`), `src/judging/bt.go`,
`src/judging/sim.go` (the threshold), the calibration panel from feature 2.

---

## Also mentioned: sybil resistance and zero-downtime operation

- **Sybil resistance (voting).** Already there: one vote per account per
  project, a vote budget, no voting for your own project, per-IP rate limits,
  and network clustering that holds votes for organizer review. The next
  steps are to document these in `THREAT-MODEL.md` with the exact rules, and
  optionally let an organizer require an email domain or an invite for
  voters. Community votes never enter the judged ranking, which limits the
  damage.
- **Zero-downtime operation.** The deployment is two containers and one
  SQLite file, so "zero downtime" means graceful restarts and safe backups
  rather than rolling fleets. Worth adding: a documented `sqlite3 .backup`
  command in the README, a `/healthz` check wired into `docker-compose.yml`,
  and a CI job that runs `run.py` and `tools/extended_check.py` against a
  fresh `docker compose up` on every pull request.

## Definition of done (every feature)

- Every number comes from the API; missing data shows an empty state.
- New endpoints are in `openapi.yaml` and the authorization matrix test.
- Engine changes have Go tests, and a simulation where a claim is statistical.
- `npm run check`, `npm run build`, `go test ./...`, `run.py` and
  `tools/extended_check.py` all pass.
- Math changes are documented in `JUDGING.md`.

---

## Research review, 29 Sep 2026

A second list of ideas (leniency heatmap, rank posteriors, Merkle CLI,
information-gain pairs, COI graph, fatigue, PDF playbook, convergence
dashboard, OAuth) was checked against the code after the seven features
above shipped. Most already existed; this is what changed.

| Idea | Status |
|------|--------|
| Leniency heatmap with EB intervals | Judge-level forest plot existed. **Added** a judge × criterion grid with estimated EB shrinkage (JUDGING.md §3.11). |
| Live P(top 1/3/10) | Existed: rank distributions, cut-off slider, 5 s polling. WebSocket not needed at this scale. |
| Merkle proof per review | CLI existed. **Added** the same check in the browser on `/verify`. |
| Information-gain pair selection | Tested in the simulation and lost at 80–320 comparisons, so the live rule stays (docs/simulation.md). |
| COI / assignment graph | Existed, with components, bridges and a recusal what-if. |
| Fatigue detection | Drift check existed. Time-per-review still can't be measured honestly (no `opened_at`). |
| Playbook PDF | **Added** Save as PDF (print styles), instead of screenshot capture. |
| Ranking convergence | **Added** a learning curve that works without timestamps, plus the real arrival curve when times exist (§3.12). |
| OAuth sign-in | Existed (GitHub, Google, LinkedIn, X). |
