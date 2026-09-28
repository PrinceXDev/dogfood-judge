# Judging: assignment, scoring, normalization, pairwise mode

This document defends every number the portal produces between "a judge
clicked 4" and "this project won". Every figure below is reproducible:

```bash
go run ./src/cmd/dogfood normalize fixtures.json   # -> docs/normalization-proof.md
go run ./src/cmd/dogfood simulate  fixtures.json   # -> docs/simulation.md
go test ./src/judging/                             # unit tests for the maths
```

The code is in `src/judging/` (no database, no HTTP, so it can be tested and
read on its own): `normalize.go`, `robust.go`, `bt.go`, `assign.go`, `sim.go`.
Verifiable results live in `src/core/verify.go`.

---

## 1. Assignment

**Goal.** Every submitted project gets `reviews_per_project` reviewers
(default 3). Those reviewers know the track, have no conflict of interest,
share the work evenly, and overlap enough that judges can be compared with
each other. That last point is what makes normalization possible at all (§3.6).

**Algorithm** (`judging.Assign`). Greedy, most constrained project first
(fewest eligible judges). For each open slot, among judges who match the
track, are not in conflict and are not already assigned, pick by this order:

1. **Lowest current load.** Balance matters most.
2. **Bridges two groups.** Prefer a judge in a different connected component
   of the judge–project graph (tracked with union-find). Two groups of judges
   who never review a common project cannot be put on one scale by any method.
3. **Least overlap with the project's existing reviewers.** Prefer spreading
   co-reviews across many judge pairs over pairing the same two people again.
   More distinct pairs give tighter leniency estimates.
4. **A seeded hash.** Runs are reproducible but not alphabetical.

If no track-matched judge is free, it falls back to any conflict-free judge
and records why. The engine only ever adds assignments; it never removes
completed or pending work, so it is safe to re-run after inviting more judges.

**Conflicts of interest** are enforced three times:

- A database trigger stops anyone holding both `judge` and `participant` in
  the same event.
- The engine excludes judges whose account is on a project's team.
- Judges can **recuse** from a pending assignment with a reason. The pair is
  never re-created, and the reason is in the audit log.

**What the organizer sees:** new assignments with a reason each ("track
match; bridges two judge groups"), the load spread (min–max), the number of
connected components, projects that could not be filled, and off-track
assignments.

**On the fixture:** the 126 imported reviews already form one connected
component. The engine tops the 8 two-review projects up to 3 with 8 pending
assignments (load 2–11).

**Honest limits.** This is a heuristic, not an optimum. A min-cost-flow
formulation would give provably optimal load balance, but connectivity is not
a flow objective. The report exposes load and connectivity so the organizer
can judge the result.

### 1.1 Tie-breaker rounds: reviews where they change the outcome

Uniform coverage (every project gets k reviews) is the right *first*
round. It is the wrong second round. Once scores exist, most projects are
already settled: P(top 3) is essentially 0% or 100%, and another review of
them cannot change a prize. The **Add tie-breaker reviews** action
(`judging.Tiebreak` → `core.RunTiebreak`) instead:

1. takes the current bootstrap P(top k) for every project (§3.5);
2. keeps only projects with 5% < P(top k) < 95%, the ones whose prize outcome
   is genuinely uncertain;
3. orders them by |P − ½|, so coin flips come first;
4. adds **one** extra reviewer to each of up to 5, using the same assignment
   engine and rules (track match, conflicts, load, connectivity), with the
   reason recorded as e.g. *"tie-breaker: P(top 3) = 49%"*.

It is adaptive design applied to ratings: the same idea as pairwise mode's
next-pair choice (§5), one level up. On the fixture it selects prj_37
(P = 49%), prj_11 (55%), prj_34 (65%), prj_25 (24%) and prj_08 (20%), which
are exactly the projects fighting over the podium.

---

## 2. The rubric

Organizers define criteria, each with a weight and an integer scale (default
1–5). A review's **composite** is

$$x_{jp} = \frac{\sum_c w_c \, v_{jpc}}{\sum_c w_c}$$

on the rubric's own scale. Re-weighting recomputes every result; raw values
are never changed. Normalization runs on the composite, not per criterion.
Leniency is mostly shared across a judge's criteria, and per-criterion models
would triple the parameters on data that is already sparse.

---

## 3. Cross-judge normalization

### 3.1 The problem

Judges differ in three ways that plain averages ignore:

- **Leniency.** Some judges give a 4 where others give a 3.
- **Scale use.** Some judges spread their scores from 1 to 5; others give
  everything a 3 or a 4, and one fixture judge gives everything a 4.
- **Batch.** Each judge sees a different handful of projects, so a judge's
  average reflects both their leniency and how good their batch was.

The third point is why the usual fix, **z-scoring each judge**, is wrong
for hackathons: it assumes every judge saw a representative sample. It also
divides by zero for a flat judge, and it is meaningless for a judge with one
review.

### 3.2 The model

For judge *j* and project *p*:

$$x_{jp} = \mu + b_j + s_j\, q_p + \varepsilon_{jp}$$

| Symbol | Meaning | Prior |
|---|---|---|
| $\mu$ | grand mean | flat |
| $b_j$ | judge **leniency**, in scale points | $\mathcal N(0, \tau_b^2)$, $\tau_b$ estimated (empirical Bayes) |
| $s_j$ | judge **scale**: how strongly their scores track true quality | $\mathcal N(1, \tau_s^2)$, $\tau_s = 0.3$ fixed |
| $q_p$ | project **quality**, as a deviation from $\mu$ | $\mathcal N(0, \tau_q^2)$, $\tau_q = 1.0$ fixed (weak) |
| $\varepsilon_{jp}$ | noise | $\mathcal N(0, \sigma^2)$, $\sigma$ estimated |

This is a two-way random-effects model with a judge-specific slope, the
same structure as a 2-parameter item-response model with judges as items. It
separates leniency from batch quality because projects are seen by several
judges: if judge A's projects also get high scores from judges B and C, A is
not lenient, A had a good batch.

**Normalized score** $= \hat\mu + \hat q_p$: *the score an average judge
(zero leniency, unit scale) would be expected to give*, on the original 1–5
scale, so it reads like a score.

### 3.3 Estimation

The estimate is the maximum a posteriori, found by alternating exact
conditional updates (each step is a small ridge regression, so the objective
never gets worse):

- $\mu \mid b, s, q$: the mean residual.
- $q_p \mid \mu, b, s$: $\displaystyle \hat q_p = \frac{\sum_j s_j\,(x_{jp}-\mu-b_j)}{\sum_j s_j^2 + \sigma^2/\tau_q^2}$.
  Judges with larger $s_j$ get more say, because their scores carry more
  information about quality.
- $(b_j, s_j) \mid \mu, q$: a 2×2 ridge regression per judge, with $b$ shrunk
  toward 0 and $s$ toward 1.
- **Variance components:** $\sigma^2 = \text{RSS}/(n-1-\text{leverage})$;
  $\tau_b^2 = \text{mean}_j(\hat b_j^2 + \text{Var}(\hat b_j))$, floored at
  $0.05^2$. These are the standard approximate EM (moment) updates, so the data
  decides how much leniency correction it can support.

Convergence: stop when every parameter moves by less than $10^{-9}$ (the
fixture converges in 387 sweeps, well under a millisecond per sweep).

**Why fix $\tau_q$ and $\tau_s$?** We tried estimating $\tau_q$ by empirical
Bayes. On sparse, noisy data (the fixture) it collapses toward zero: the
estimator concludes projects are indistinguishable, and every adjusted score
becomes ≈3.5. That is a correct statement about the evidence but a useless
ranking. A weak fixed prior ($\tau_q = 1$ scale point) barely shrinks
projects. The uncertainty is then reported where it belongs, in the
intervals (§3.5), instead of being buried in the point estimates. $\tau_s$ is
weakly identified from 2–6 reviews per judge, so it is a stated assumption.

### 3.4 How the awkward fixture cases are handled

| Case in `fixtures.json` | What happens |
|---|---|
| **jdg_07 gave (4,4,4) to all three projects** | Z-scores divide by zero; our z-score baseline maps them to "exactly average", which drags good projects down. The model has no zero-division, and the judge is flagged *"flat: identical scores; carries no ranking information"*. With only 3 reviews the model **cannot** tell "a judge who does not discriminate" from "three equally good projects", so it does not silently down-weight them; the organizer decides. With more data the scale term does the down-weighting (§4, scenario with 10% flat judges). |
| **jdg_01 and jdg_23 have one review each** | $\text{Var}(\hat b_j)$ is large, so $b_j$ is shrunk almost to 0 and they are treated as average. Flagged *"low data"*. |
| **Two unfinished batches: 8 projects with 2 reviews** | Their standard error is ≈0.41 vs ≈0.33 for 3 reviews. They are marked *provisional* and get wider rank intervals (e.g. prj_18: ranks 1–39). The assignment engine creates a third pending review for each. |
| **prj_41 duplicates prj_07** (same team, title and repository, submitted 3 hours later) | Detected on import and marked `duplicate_of = prj_07`. It is excluded from the gallery and the model, but its 4 reviews are kept and exported. An organizer can reinstate it. |
| **Some judges finish, some do not** | The model uses whatever reviews exist. Nothing assumes a complete design. |

### 3.5 Uncertainty: never rank without error bars

For each project the organizer sees:

- **SE**: posterior SD of $q_p$: $\sigma/\sqrt{\sum_j s_j^2 + \sigma^2/\tau_q^2}$.
- **90% rank interval** and **P(top k)** from a stratified bootstrap: resample
  each project's reviews with replacement (so no project vanishes), refit the
  whole model, record ranks. 300 replicates in the UI and 1000 in the proof
  CLI, with a fixed seed so the numbers are reproducible. Refits warm-start
  from the full fit.

Prize decisions should be made on "P(top 3)", not on the ordinal rank. On the
fixture the leader has **P(top 3) = 51%** and ranks 1–6: the data does not
crown a clear winner, and the portal says so rather than implying otherwise.

### 3.6 Connectivity: the precondition nobody mentions

Put every judge and project in one graph, with an edge for each review. If the
graph falls apart into disconnected pieces, the leniency of the judges in one
piece cannot be compared with the leniency of the judges in another, by any
method. A "normalized" cross-track ranking is then an assumption, not a
measurement. The portal counts components, warns when there is more than
one, and the assignment engine actively bridges them (§1). The fixture has
exactly 1 component.

### 3.7 Proof on the fixture data

Full table: [`docs/normalization-proof.md`](docs/normalization-proof.md)
(raw score, raw rank, adjusted score, SE, rank change, 90% rank interval,
P(top 3), and the z-score and pairwise ranks, for all 40 live projects).

Headline facts:

- 122 reviews (126 minus prj_41's 4), 40 projects, 30 judges, 1 component.
- Fitted: $\hat\mu = 3.50$, $\hat\sigma = 0.63$, $\hat\tau_b = 0.05$ (the floor).
- **The fixture's judges show no leniency beyond noise.** Estimated leniency
  spread sits at its floor. Differences between judges' average scores are
  explained by the projects they happened to see. For example, jdg_02's mean
  of 4.22 comes from reviewing prj_08, prj_11, prj_16 and prj_21, which other
  judges also scored highly. A naive per-judge correction would have
  penalised those projects.
- 25 of 40 projects change rank versus the raw mean, almost all by ±1–3,
  driven by scale weighting and unequal review counts. The largest move is
  **prj_18, 19th → 29th**. Its two reviews disagree (4.33 from jdg_04, 2.67
  from jdg_24), and jdg_24 (11 reviews, scale 1.11) tracks the other judges'
  consensus more closely than jdg_04 (scale 0.74), so jdg_24 gets more weight.
  Its interval (1–39) shows how little two reviews can say.
- Agreement with the primary ranking (Kendall τ): raw 0.94, bias-only 0.93,
  **z-score 0.68**, induced pairwise 0.64. Z-scoring reorders the fixture far
  more than the model does, and §4 shows that reordering is mostly error.

### 3.8 Methods reported side by side

| Method | Role |
|---|---|
| `raw` | Plain mean. The baseline everyone understands. |
| `zscore` | Per-judge standardisation mapped back to the scale. Shown because it is what platforms usually mean by "normalization". |
| `bias` | The model with $s_j \equiv 1$: leniency only. |
| **`biasscale`** | **Primary.** Leniency and scale. |
| `pairwise` | Bradley–Terry on *induced* comparisons: every pair of projects one judge scored becomes a win, loss or tie. Leniency and scale cancel within a judge, so this is an independent, assumption-light cross-check. It is noisy because each judge sees few projects. |

### 3.9 Is the winner defensible? Leave-one-judge-out

Losing teams do not ask "was the model right?". They ask "would we have won
with different judges?". The portal answers that directly
(`judging/robust.go`). Every judge is removed in turn, and the **whole model
is refitted** without their reviews. The report shows:

- **Winner held**: in how many of the J refits the winner stays first, and
  exactly which judges' removal changes it.
- **Top-k held**: the same for the whole prize set.
- **Winner margin**: the first–second gap divided by their combined standard
  error. Below 1 it is a statistical tie, whatever the ordinal rank says.
- **Ahead of next**: for every adjacent pair in the ranking, the share of
  bootstrap resamples in which the higher one really stays higher. Near 50%
  means the two are indistinguishable, and the UI tags it *tie*.
- **Judge influence**: 1 − τ between the full ranking and the ranking without
  that judge, plus a *decides #1* tag if their removal flips the winner.

**On the fixture**, the honest answer is uncomfortable:

- The winner, prj_11, stays first in **24 of 30** refits.
- Removing any one of six judges (jdg_02, 04, 16, 20, 29, 30) changes it.
- The lead over prj_34 is **0.05 standard errors**.
- The most influential judge is jdg_24; without them the ranking agrees with
  the full one at τ = 0.78.

Every other platform would have printed "1st: Salt Ledger" and moved on. This
one tells the organizer that first place is a coin flip between two projects.
It offers the tie-breaker round (§1.1) or a shared prize.

### 3.10 Reviews that disagree with everyone

The model predicts every review: what *this* judge, given their leniency and
scale, should give *this* project, given what every other judge said:

$$\hat x_{jp} = \hat\mu + \hat b_j + \hat s_j \hat q_p, \qquad z_{jp} = (x_{jp} - \hat x_{jp})/\hat\sigma$$

Reviews with |z| ≥ 2.5 are flagged. For each one the model is refitted
**without that single review**, and the report shows the project's rank with
and without it: "this one review is worth 10 places" is something an
organizer can act on. Under the model about 1.2% of honest reviews cross the
threshold by chance, so on a 120-review event one or two flags are expected
from noise. The UI calls them prompts to read the review, not accusations.
The unit test plants a rogue review (a judge scoring the clear best project
at the floor) and checks that it is flagged, attributed to the right judge,
and shown to cost the project ranks.

Each judge also gets an **agreement** score: the correlation between their
scores and the consensus computed *without them* (from the leave-one-judge-out
fit, so a judge cannot agree with themselves). A negative agreement over 3 or
more reviews is flagged *contrarian*. This is the portal's answer to targeted
favouritism and collusion (THREAT-MODEL.md): a judge who inflates a friend
does not look lenient overall, but their review of that project is an
outlier, and it is shown with its price in ranks.

On the fixture no review crosses 2.5σ. The fixture's scores are noisy but
not adversarial, and the report says so rather than inventing suspects.

---

## 4. Does it work? Monte Carlo validation

A method can only be validated where the truth is known. Each simulated event
draws true qualities, leniencies, scale factors (log-normal), a share of flat
judges, and noise. It then generates **integer** criterion scores through the
**exact review graph of `fixtures.json`**: the same 126 (judge, project)
pairs, the same unfinished batches, the same uneven loads. Each method then
has to recover the true ranking. 1000 simulated events per scenario, fixed
seeds. Full tables: [`docs/simulation.md`](docs/simulation.md).

Kendall τ vs the true ranking (mean over 1000 events), and how often the
method beat the raw mean:

| Scenario | raw | z-score | bias | **bias+scale** | bias+scale beats raw |
|---|---:|---:|---:|---:|---:|
| Baseline (leniency SD 0.45, scale SD 0.35, 1/30 flat, noise 0.6) | 0.677 | 0.629 | 0.707 | **0.713** | 83% |
| Strong leniency (SD 0.8) | 0.567 | 0.622 | 0.676 | **0.683** | 98% |
| Heavy scale differences + 10% flat judges | 0.650 | 0.602 | 0.677 | **0.695** | 87% |
| Very noisy judges (noise 1.0) | 0.603 | 0.545 | 0.614 | **0.615** | 63% |
| **Null: no judge effects at all** | **0.781** | 0.642 | 0.769 | 0.765 | 9% |

What this shows, including the parts that do not flatter us:

1. The model **recovers the true ranking better than raw means whenever judges
   actually differ**, and the more they differ, the bigger the gain (98% of
   events under strong leniency).
2. **Z-scoring is worse than doing nothing** in every scenario except extreme
   leniency. It throws away real differences between judges' batches.
3. **When judges do not differ at all, normalizing costs a little** (τ 0.781 →
   0.765). That is the price of estimating parameters that are really zero.
   Empirical-Bayes shrinkage keeps it small (z-scoring loses 0.14 here), but it
   is not free. On the fixture, where leniency is indistinguishable from noise,
   the model stays close to the raw ranking (τ = 0.94), which is the behaviour
   this scenario argues for.
4. With very noisy judges no method helps much, because the information is
   not in the data.

---

## 5. Pairwise mode (Bradley–Terry)

**Why.** Absolute scores need calibration; comparisons do not. "Is A better
than B?" has no leniency and no scale. It is the approach Gavel popularised.

**Flow.** A judge opens *Pairwise mode*. The server picks a pair, stores it as
the judge's **current offer**, and accepts a verdict (A / B / tie) **only on
that pair**. Any other pair gets `409 stale_pair`. Judges cannot choose which
projects meet, so they cannot steer a friend into weak pairings.

**Model.**
$P(i \succ j) = \dfrac{\pi_i}{\pi_i+\pi_j} = \text{logistic}(\theta_i-\theta_j)$,
fitted by Hunter's (2004) MM algorithm:

$$\pi_i \leftarrow \frac{W_i + 1}{\sum_j \frac{n_{ij}}{\pi_i+\pi_j} + \frac{2}{\pi_i + 1}}$$

- **Prior:** every project is treated as having drawn one win and one loss
  against a phantom of strength 1 (Laplace smoothing). This keeps undefeated
  and never-compared projects finite, and connects a disconnected comparison
  graph.
- **Ties** count as half a win each (the symmetric limit of Rao–Kupper), which
  keeps MM monotone.
- **Standard errors** come from the inverse of the full observed information
  matrix, with the phantom fixed at 0, so the matrix is invertible.
- **Scores** are $\theta$ centred at 0. A gap of 1.0 means the stronger
  project wins ~73% of the time.

**Choosing the next pair** (`judging.NextPair`), among projects in the
judge's tracks, excluding conflicts and pairs this judge has already seen:
maximise $p(1-p) \,/\, (1+n_{ij}) \,/\, \sqrt{1+\min(n_i,n_j)}$. That is
outcome uncertainty, discounted for pairs and projects already compared
often. Near-ties are broken at random, and left/right is randomised to cancel
position bias.

**Validation** (40 projects, Bradley–Terry ground truth, equal budgets):

| Comparisons | Adaptive τ | Random τ |
|---:|---:|---:|
| 80 | 0.498 | 0.461 |
| 160 | 0.624 | 0.571 |
| 320 | 0.735 | 0.702 |
| 640 | 0.805 | 0.784 |

Adaptive selection is consistently better. The gain is largest at small
budgets, which is where hackathons live.

**Why not Crowd-BT** (Chen et al. 2013, which also estimates each judge's
reliability)? It adds one parameter per judge to a model that already has one
per project. With 30 judges making maybe 20 comparisons each, that roughly
doubles the parameters on the same evidence. The per-judge flag in §3.4 gives
the organizer the same signal without the overfitting risk. It is the natural
next step once an event has an order of magnitude more comparisons.

---

## 6. Who sees what

| | Visitor | Participant | Judge | Organizer |
|---|---|---|---|---|
| Submitted projects, comments | ✓ | ✓ | ✓ | ✓ |
| Drafts | – | own team | – | ✓ |
| Own reviews | – | – | ✓ | ✓ |
| Another judge's reviews | – | – | **403** | ✓ (their events) |
| Rankings, normalized scores | after publish | after publish | after publish | always |
| Judge diagnostics (leniency, flags) | – | – | – | ✓ |
| Vote tallies | after publish | after publish | after publish | always |

All of this is enforced in `src/core` (the service layer). The Next.js
interface is just another API client, so it cannot bypass it.
`tests/portal_test.go: TestAuthorizationMatrix` checks 39 (endpoint, role)
pairs. Publishing is refused while community voting is open, and judging
closes when results are published.

---

## 7. Verifiable results: don't trust the organizer's screen

A normalized ranking is a computation, so it should be *checkable*: anyone
can re-run it offline, on the same inputs, and get the same answer. Once
results are published, `GET /api/v1/events/{e}/results/bundle` (linked from
the public results page) returns:

- **inputs**: every review's raw criterion values and the rubric weights.
  Judges are replaced by keyed pseudonyms (`J-3f9c…`, stable within the event,
  not reversible without the instance secret), so the bundle exposes
  scores, not who gave them. Duplicates and disqualified projects are listed
  as excluded.
- **a manifest signed with the instance's Ed25519 key**, committing to:
  - the SHA-256 of the canonical inputs;
  - the hash of the `results.publish` entry in the audit chain, which ties
    the ranking to the tamper-evident log;
  - the engine version and priors;
  - the full ranking with adjusted scores.

`dogfood verify-results bundle.json --key <public key>` then:

1. checks the signature;
2. recomputes the input fingerprint;
3. recomputes every composite from the raw values and weights;
4. re-runs the exact engine (`core.RankInputs`, the same function the portal
   used to write the manifest).

```
OK   signature (key 7d7a383e43e39e4b)
OK   input fingerprint 05e7994c2a33…
OK   ranking re-computed from 123 reviews (max score difference 0)
VERIFIED: the published ranking follows from the published inputs.
```

Changing a single criterion value fails the fingerprint, and the recomputed
ranking reports how far scores moved. Changing the manifest fails the
signature. Scores must agree to 10⁻⁶, because floating-point summation can
differ in the last bits across CPU architectures, and any rank difference
must be explained by such a near-exact tie. `TestVerifiableResultsBundle`
covers the genuine, tampered-input and forged-manifest cases.

What this proves: the published ranking follows from the published inputs
under the published method. What it cannot prove: that the inputs are what
judges actually entered. That is what the audit chain is for, and the
manifest's anchor ties the two together.

---

## 8. Limitations

- The model assumes leniency is additive and constant within an event. A
  judge who is harsh early and lenient late is modelled as their average.
- $\tau_s$ and $\tau_q$ are fixed priors. The simulation shows the method is
  robust across realistic effect sizes, but they are assumptions, stated.
- The bootstrap resamples reviews within projects. It captures review noise,
  not uncertainty about who was assigned.
- With 2–3 reviews per project, **no** method produces a confident total
  order of 40 projects. The portal's job is to say so, and it does.
