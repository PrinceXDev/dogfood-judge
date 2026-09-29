import Link from "next/link";
import { publish, runTiebreak } from "@/app/actions";
import { buttonClass } from "@/components/button";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { LiveRefresh } from "@/components/results/live-refresh";
import { RankingTable } from "@/components/results/ranking";
import {
  Callout,
  EmptyState,
  num,
  PageHeader,
  Problem,
  Section,
  Table,
  Tag,
} from "@/components/ui";
import { BoundaryStrip } from "@/components/viz/boundary-strip";
import { Calibration } from "@/components/viz/calibration";
import { ConvergenceChart } from "@/components/viz/convergence";
import { CriterionHeatmap } from "@/components/viz/criterion-heatmap";
import { DefensibilityGraph } from "@/components/viz/defensibility-graph";
import { NormalizationView } from "@/components/viz/normalization";
import { RankDensity } from "@/components/viz/rank-density";
import { ReviewInfluence } from "@/components/viz/review-influence";
import { ScoreBreakdown } from "@/components/viz/score-breakdown";
import { api, load, requireMe } from "@/lib/api";
import { f2, pct, signedf, votingOpen } from "@/lib/format";
import type { Progress, Results, Review } from "@/lib/types";

const METHOD_NAMES: Record<string, string> = {
  raw: "Raw mean",
  zscore: "Z-score per judge",
  bias: "Leniency only",
  biasscale: "Leniency + scale (primary)",
  pairwise: "Induced pairwise (Bradley–Terry)",
};

export default async function OrganizerResults({
  params,
}: PageProps<"/organize/[event]/results">) {
  const { event } = await params;
  const here = `/organize/${event}/results`;
  await requireMe(here);
  const r = await load<Results>(`/events/${event}/results`, here);
  if (!r.ok) return <Problem error={r.error} />;
  const res = r.data;
  const e = res.event;
  const rep = res.report;
  const rows = res.rows ?? [];
  const ranked = rows.filter((x) => x.ranks.biasscale);
  const judges = res.judges ?? [];
  const rb = rep.robustness;
  const k = rep.top_k;
  const byId = new Map(rows.map((x) => [x.project.id, x.project]));
  const judgeName = new Map(judges.map((j) => [j.judge, j.name]));
  const voting = votingOpen(e);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const stable = rb ? rb.winner_held === rb.refits : false;
  const moved = ranked.filter((x) => x.rank_change !== 0).length;

  // Every review's composite, for the per-judge and per-project breakdowns.
  const [reviewList, progress] = await Promise.all([
    api<Review[] | null>(`/events/${e.id}/reviews`).catch(() => null),
    api<Progress>(`/events/${e.id}/progress`).catch(() => null),
  ]);
  const reviews = reviewList ?? [];
  const criteria = e.criteria ?? [];
  const scaleMin = Math.min(...criteria.map((c) => c.scale_min), 1);
  const scaleMax = Math.max(...criteria.map((c) => c.scale_max), scaleMin);
  const titles = Object.fromEntries(
    rows.map((x) => [x.project.id, x.project.title]),
  );
  const densities = ranked
    .filter((x) => x.rank_dist?.length)
    .map((x) => ({
      id: x.project.id,
      label: x.project.title,
      dist: x.rank_dist ?? [],
    }));
  const pairTopK = (d: number[] | null) =>
    d?.length
      ? d.slice(0, k).reduce((a, b) => a + b, 0) /
        Math.max(
          1,
          d.reduce((a, b) => a + b, 0),
        )
      : null;
  const judgeRow = new Map(judges.map((j) => [j.judge, j]));

  const publishForm = (
    <ActionForm
      action={publish}
      confirm={
        res.published
          ? undefined
          : "Publish results? Judging closes and the ranking becomes public."
      }
      className="flex items-center gap-2"
    >
      <input type="hidden" name="event" value={e.id} />
      <input type="hidden" name="publish" value={res.published ? "0" : "1"} />
      {res.published ? (
        <Submit variant="secondary">Unpublish</Submit>
      ) : (
        <Submit variant="accent" disabled={voting}>
          <Icon name="key" size={14} />
          {voting ? "Voting still open" : "Publish & sign results"}
        </Submit>
      )}
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        eyebrow="Results"
        title={
          <>
            Is the winner{" "}
            <span className="font-serif font-normal italic text-accent">
              defensible?
            </span>
          </>
        }
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {res.published ? (
              <>
                <Tag tone="good" dot>
                  published
                </Tag>
                Public at{" "}
                <Link
                  href={`/events/${e.slug}/results`}
                  className="font-mono text-sm text-accent hover:underline"
                >
                  /events/{e.slug}/results
                </Link>
              </>
            ) : (
              <>
                <Tag tone="warn" dot>
                  not published
                </Tag>
                Only organizers see this page. Judges see nothing but their own
                scores.
                {voting &&
                  " Publishing is blocked while community voting is open."}
              </>
            )}
          </span>
        }
        actions={
          <div className="grid justify-items-end gap-2">
            {publishForm}
            {progress && !res.published && (
              <LiveRefresh
                eventId={e.id}
                done={progress.done}
                comparisons={progress.comparisons}
              />
            )}
          </div>
        }
      />

      {rep.components > 1 && (
        <Callout
          tone="warn"
          title={`The judges split into ${rep.components} groups that share no projects.`}
        >
          Scores in different groups cannot be put on one scale by any method.
          Run the assignment engine from the overview to add bridging reviews.
        </Callout>
      )}

      {!winner ? (
        <EmptyState title="Nothing to rank yet" icon="trophy">
          Results appear as soon as judges submit reviews.
        </EmptyState>
      ) : (
        <>
          {/* VERDICT */}
          <section className="relative overflow-hidden rounded-xl border border-line-strong bg-surface">
            <div className="bg-grid pointer-events-none absolute inset-0 opacity-70 [mask-image:linear-gradient(90deg,black,transparent_70%)]" />
            <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                  Winner · primary method
                </p>
                <h2 className="mt-3 text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  <Link
                    href={`/p/${winner.project.id}`}
                    className="hover:text-accent"
                  >
                    {winner.project.title}
                  </Link>
                </h2>
                <p className="mt-2 text-ink-2">
                  {winner.project.team_name}
                  {winner.project.track_name
                    ? ` · ${winner.project.track_name}`
                    : ""}
                </p>
                {rb && (
                  <p className="mt-6 flex flex-wrap items-center gap-3 text-sm text-ink-2">
                    <span
                      className={`rounded px-2 py-1 font-mono text-xs font-semibold ${stable ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn"}`}
                    >
                      {stable ? "STABLE" : "SENSITIVE"}
                    </span>
                    Stays #1 in {rb.winner_held} of {rb.refits} judge-removal
                    refits.
                  </p>
                )}
                {rb && rb.winner_margin < 1 && runnerUp && (
                  <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-2">
                    The lead over{" "}
                    <span className="text-ink">{runnerUp.project.title}</span>{" "}
                    is{" "}
                    <span className="font-mono text-warn">
                      {f2(rb.winner_margin)} SE
                    </span>
                    : a statistical tie. Consider a tie-breaker round or a
                    shared prize.
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-lg border border-line bg-line">
                {[
                  [
                    "Winner held",
                    rb ? `${rb.winner_held}/${rb.refits}` : "·",
                    rb && !stable ? "text-warn" : "text-accent",
                  ],
                  [`P(top ${k})`, pct(winner.prob_top_k), ""],
                  [
                    "90% rank interval",
                    `#${winner.rank_low}–#${winner.rank_high}`,
                    "",
                  ],
                  [
                    "Lead over #2",
                    rb ? `${f2(rb.winner_margin)} SE` : "·",
                    rb && rb.winner_margin < 1 ? "text-warn" : "",
                  ],
                  [
                    `Top ${k} held`,
                    rb ? `${rb.top_k_held}/${rb.refits}` : "·",
                    "",
                  ],
                  ["Ranks changed vs raw", `${moved}/${ranked.length}`, ""],
                ].map(([label, v, cls]) => (
                  <div key={label} className="bg-surface px-4 py-3.5">
                    <dt className="text-[11px] text-muted">{label}</dt>
                    <dd
                      className={`mt-1 font-mono text-xl tabular ${cls || "text-ink"}`}
                    >
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          {rb && judges.length > 1 && (
            <Section
              id="defensibility"
              eyebrow="Leave-one-judge-out"
              title="What happens if a judge disappears?"
              desc="Every judge is removed in turn and the whole model refitted. Line weight is the judge's influence on the full ranking (1 − Kendall τ without them). Hover a judge, or replay all refits."
            >
              <div className="rounded-xl border border-line bg-surface/50 p-5 sm:p-8">
                <DefensibilityGraph
                  winner={{
                    id: winner.project.id,
                    label: winner.project.title,
                  }}
                  judges={judges.map((j) => ({
                    id: j.judge,
                    label: j.name || j.judge,
                    flips: (rb.winner_flips ?? []).includes(j.judge),
                    influence: j.influence,
                    flipsTopK: j.flips_top_k,
                  }))}
                  refits={rb.refits}
                  held={rb.winner_held}
                  topK={k}
                  probTopK={winner.prob_top_k}
                  rankLow={winner.rank_low}
                  rankHigh={winner.rank_high}
                  margin={rb.winner_margin}
                />
              </div>
              {rb.pivotal && (
                <p className="mt-3 text-sm text-ink-2">
                  Most influential judge:{" "}
                  <span className="text-ink">
                    {judgeName.get(rb.pivotal) || rb.pivotal}
                  </span>{" "}
                  <span className="font-mono text-xs text-muted">
                    ({rb.pivotal})
                  </span>
                  . Without them the ranking agrees with the full one at τ ={" "}
                  <span className="font-mono">{f2(rb.pivotal_tau)}</span>.
                </p>
              )}
            </Section>
          )}

          <Section
            id="boundary"
            eyebrow="Adaptive review"
            title="Where are the prizes still undecided?"
            desc={`Projects placed by the bootstrap probability of finishing in the top ${k}. The tie-breaker round sends one extra reviewer to each of up to 5 projects on the boundary, closest to a coin flip first.`}
          >
            <BoundaryStrip
              k={k}
              projects={ranked.map((x) => ({
                id: x.project.id,
                label: x.project.title,
                p: x.prob_top_k,
              }))}
              action={
                !res.published ? (
                  <ActionForm
                    key="tiebreak"
                    action={runTiebreak}
                    confirm="Assign one extra reviewer to each project whose prize outcome is still uncertain?"
                    className="contents"
                  >
                    <input type="hidden" name="event" value={e.id} />
                    <Submit variant="accent">
                      <Icon name="users" size={14} />
                      Assign tie-breaker reviews
                    </Submit>
                  </ActionForm>
                ) : (
                  <span className="text-xs text-muted">
                    Results are published; the tie-breaker round is closed.
                  </span>
                )
              }
            />
          </Section>

          <Section
            id="ranking"
            eyebrow="Ranking"
            title="How certain are we?"
            desc={
              <>
                Each review is modelled as{" "}
                <span className="font-mono text-ink">
                  mean + leniency + scale × quality + noise
                </span>
                , estimated jointly from every overlapping review. The band is
                the 90% rank interval from {rep.bootstrap} bootstrap resamples;
                “ahead of next” near 50% is a statistical tie.
              </>
            }
            aside={
              <div className="flex gap-2">
                <a
                  href={`/api/v1/events/${e.id}/export/results.csv`}
                  className={buttonClass("secondary", "sm")}
                >
                  <Icon name="download" size={13} /> results.csv
                </a>
                <a
                  href={`/api/v1/events/${e.id}/results/bundle`}
                  className={buttonClass("secondary", "sm")}
                >
                  <Icon name="shieldCheck" size={13} /> Verifiable bundle
                </a>
              </div>
            }
          >
            <RankingTable rows={rows} k={k} detail />
          </Section>

          {densities.length > 0 && (
            <Section
              id="uncertainty"
              eyebrow="Rank uncertainty"
              title="Where could each project really finish?"
              desc={`Each strip shades the ranks a project reached across ${rep.bootstrap} bootstrap resamples, darker where it landed more often. Strips that overlap are ties the data can't break. Move the cut-off to read P(top n) for any prize size.`}
            >
              <RankDensity rows={densities} k={k} />
            </Section>
          )}

          {rep.convergence && (
            <Section
              id="convergence"
              eyebrow="Convergence"
              title="Do we have enough reviews?"
              desc={`Every project keeps a random share of its reviews and the engine refits, ${rep.convergence.subsamples} times per step. If the top ${rep.convergence.top_n} barely moves with a fifth of the reviews gone, another fifth won't move it either. In 48 simulated events with a planted truth, every "settled" top 3 was the true one; "still moving" ones were right 43% of the time.`}
            >
              <ConvergenceChart c={rep.convergence} total={rep.reviews} />
            </Section>
          )}

          <Section
            id="reviews"
            eyebrow="Outliers"
            title="What reviews matter?"
            desc="A review is flagged when neither the judge's own leniency and scale nor the other judges' view of the project explains it (|z| ≥ 2.5, about 1 in 80 honest reviews by chance). Typos, misunderstandings and conflicts of interest look like this."
          >
            {rep.outliers?.length ? (
              <ReviewInfluence
                total={ranked.length}
                reviews={rep.outliers.map((o) => ({
                  judge: o.judge,
                  judgeLabel: judgeName.get(o.judge) || o.judge,
                  project: o.project,
                  projectLabel: byId.get(o.project)?.title ?? o.project,
                  score: o.score,
                  expected: o.expected,
                  z: o.z,
                  rankWith: o.rank_with,
                  rankWithout: o.rank_without,
                }))}
              />
            ) : (
              <Callout
                tone="good"
                title="No review is out of line with the rest."
              >
                Every score is within 2.5 standard deviations of what the model
                expects from that judge for that project, so no single review
                needs a second look.
              </Callout>
            )}
          </Section>

          {reviews.length > 0 && judges.length > 0 && (
            <>
              <Section
                id="why"
                eyebrow="Explain a score"
                title="Why did this score change?"
                desc="Pick a project: its raw reviews, each reviewing judge's estimated leniency and scale, and where the engine lands it. Sorted by how far normalization moved it."
              >
                <ScoreBreakdown
                  mu={rep.fit.mu}
                  projects={[...ranked]
                    .sort(
                      (a, b) =>
                        Math.abs(b.rank_change) - Math.abs(a.rank_change),
                    )
                    .map((x) => ({
                      id: x.project.id,
                      label: x.project.title,
                      rawMean: x.scores.raw ?? 0,
                      final: x.scores.biasscale ?? 0,
                      rawRank: x.ranks.raw ?? 0,
                      finalRank: x.ranks.biasscale ?? 0,
                      reviews: reviews
                        .filter((v) => v.project_id === x.project.id)
                        .map((v) => ({
                          judge: v.judge_id,
                          judgeLabel: v.judge_name || v.judge_id,
                          score: v.composite,
                          bias: judgeRow.get(v.judge_id)?.bias ?? 0,
                          scale: judgeRow.get(v.judge_id)?.scale ?? 1,
                        })),
                    }))}
                />
              </Section>

              <Section
                id="normalization"
                eyebrow="Normalization"
                title="Raw → calibrated → final"
                desc="How every project moves as the engine corrects first for leniency, then for how much of the scale each judge uses. Select a judge to see the scores they gave and how far the engine trusted their offset."
              >
                <NormalizationView
                  mu={rep.fit.mu}
                  projects={ranked.map((x) => ({
                    id: x.project.id,
                    label:
                      x.project.title.length > 18
                        ? `${x.project.title.slice(0, 17)}…`
                        : x.project.title,
                    raw: x.ranks.raw ?? 0,
                    bias: x.ranks.bias ?? 0,
                    final: x.ranks.biasscale ?? 0,
                    rawScore: x.scores.raw ?? 0,
                    finalScore: x.scores.biasscale ?? 0,
                  }))}
                  judges={judges.map((j) => ({
                    id: j.judge,
                    label: j.name || j.judge,
                    bias: j.bias,
                    biasSe: j.bias_se,
                    scale: j.scale,
                    mean: j.mean_given,
                    sd: j.sd_given,
                    reviews: j.reviews,
                    flags: j.flags ?? [],
                    scores: reviews
                      .filter((v) => v.judge_id === j.judge)
                      .map((v) => ({
                        project: byId.get(v.project_id)?.title ?? v.project_id,
                        score: v.composite,
                      })),
                  }))}
                />
              </Section>
            </>
          )}

          <Section
            id="methods"
            eyebrow="Cross-check"
            title="Do the methods agree?"
            desc="Kendall's τ between each method's ranking and the primary. 1 means the same order. Large disagreement is a reason to read the reviews, not to pick the method you like."
          >
            <div className="grid gap-2 rounded-lg border border-line bg-surface p-5">
              {rep.methods.map((m) => {
                const t = rep.agreement[m] ?? 0;
                return (
                  <div
                    key={m}
                    className="grid grid-cols-[minmax(0,200px)_1fr_56px] items-center gap-4 text-sm"
                  >
                    <span
                      className={
                        m === rep.primary
                          ? "font-medium text-ink"
                          : "text-ink-2"
                      }
                    >
                      {METHOD_NAMES[m] ?? m}
                    </span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full ${m === rep.primary ? "bg-accent" : "bg-accent-2/70"}`}
                        style={{ width: `${Math.max(0, t) * 100}%` }}
                      />
                    </div>
                    <span className="text-right font-mono text-xs tabular">
                      {f2(t)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>

          {judges.length > 0 && (
            <Section
              id="judges"
              eyebrow="Diagnostics"
              title="Judges"
              desc="Leniency in scale points (+ is more generous than average). Scale below 1 compresses differences. Agreement is correlation with everyone else's consensus, computed without them. Flags are prompts to look, not verdicts."
            >
              <Table>
                <thead>
                  <tr>
                    <th>Judge</th>
                    <th className={num}>Reviews</th>
                    <th className={num}>Mean given</th>
                    <th className={num}>Leniency</th>
                    <th className={num}>Scale</th>
                    <th className={num}>Agreement</th>
                    <th className={num}>Influence</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {judges.map((j) => (
                    <tr key={j.judge}>
                      <td>
                        <span className="text-ink">{j.name}</span>{" "}
                        <span className="font-mono text-xs text-muted">
                          {j.judge}
                        </span>
                      </td>
                      <td className={num}>{j.reviews}</td>
                      <td className={num}>{f2(j.mean_given)}</td>
                      <td className={num}>
                        {signedf(j.bias)}{" "}
                        <span className="text-[11px] text-muted">
                          ±{f2(j.bias_se)}
                        </span>
                      </td>
                      <td className={num}>{f2(j.scale)}</td>
                      <td className={num}>
                        {j.has_agreement ? f2(j.agreement) : "·"}
                      </td>
                      <td className={num}>
                        {f2(j.influence)}
                        {j.flips_first && (
                          <Tag tone="warn" className="ml-2">
                            decides #1
                          </Tag>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {(j.flags ?? []).map((f) => (
                            <Tag key={f} tone="warn">
                              <span title={f}>{f.split(":")[0]}</span>
                            </Tag>
                          ))}
                          {j.outliers > 0 && (
                            <Tag tone="bad">{j.outliers} outlier review(s)</Tag>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}

          {judges.length > 0 && rb && (
            <Section
              id="calibration"
              eyebrow="Calibration"
              title="Who scores differently, and does it matter?"
              desc="Leniency with its 90% interval: only an interval that clears zero is a measurable difference, and the model has already corrected for it. The strip counts the criterion values each judge used; one bar means they gave one value to everything. Select a judge to see the prize ranking the engine gets without them."
            >
              <Calibration
                judges={judges.map((j) => ({
                  id: j.judge,
                  label: j.name || j.judge,
                  bias: j.bias,
                  biasSe: j.bias_se,
                  reviews: j.reviews,
                  flags: j.flags ?? [],
                  values: reviews
                    .filter((v) => v.judge_id === j.judge)
                    .flatMap((v) => Object.values(v.scores)),
                }))}
                scaleMin={scaleMin}
                scaleMax={scaleMax}
                topK={rb.top_k ?? []}
                refitTopK={rb.refit_top_k ?? {}}
                titles={titles}
              />
            </Section>
          )}

          {!!res.criterion_leniency?.cells?.length && (
            <Section
              id="criteria"
              eyebrow="Leniency by criterion"
              title="Where exactly does each judge differ?"
              desc="Each value is compared with the other judges who scored the same project on the same criterion, so project quality cancels out. Offsets are shrunk toward zero by empirical Bayes, and only those whose 90% interval clears zero are coloured. Hover a cell for the raw offset, sample size and shrinkage."
            >
              <CriterionHeatmap
                data={res.criterion_leniency}
                judgeLabel={Object.fromEntries(
                  judges.map((j) => [j.judge, j.name || j.judge]),
                )}
                criterionLabel={Object.fromEntries(
                  criteria.map((c) => [c.key, c.name || c.key]),
                )}
              />
            </Section>
          )}
        </>
      )}

      {!!res.pairwise?.length && (
        <Section
          eyebrow="Pairwise mode"
          title="Bradley–Terry strengths"
          desc="Strength on the log-odds scale: a gap of 1.0 means the stronger project wins about 73% of comparisons."
        >
          <Table>
            <thead>
              <tr>
                <th className={num}>#</th>
                <th>Project</th>
                <th className={num}>Strength</th>
                <th className={num}>± SE</th>
                <th className={num}>Comparisons</th>
                <th className={num}>P(top {k})</th>
              </tr>
            </thead>
            <tbody>
              {res.pairwise.map((p) => (
                <tr key={p.project.id}>
                  <td className={num}>{p.rank}</td>
                  <td>{p.project.title}</td>
                  <td className={num}>{signedf(p.strength)}</td>
                  <td className={num}>{f2(p.se)}</td>
                  <td className={num}>{p.comparisons}</td>
                  <td className={num}>
                    {pairTopK(p.rank_dist) === null
                      ? "·"
                      : pct(pairTopK(p.rank_dist) ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {!!res.votes?.length && (
        <Section
          eyebrow="Community"
          title="Community vote"
          desc="Held votes stay out of the count until you review them in Moderation."
        >
          <Table>
            <thead>
              <tr>
                <th>Project</th>
                <th className={num}>Counted</th>
                <th className={num}>Held for review</th>
              </tr>
            </thead>
            <tbody>
              {res.votes.map((v) => (
                <tr key={v.project.id}>
                  <td>{v.project.title}</td>
                  <td className={num}>{v.counted}</td>
                  <td className={num}>{v.held}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {!!res.excluded?.length && (
        <Section
          eyebrow="Excluded"
          title="Not in the ranking"
          desc="Their reviews are kept and exported but do not enter the model. Reinstate from Moderation."
        >
          <ul className="grid gap-2">
            {res.excluded.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-4 py-2.5 text-sm"
              >
                <Link
                  href={`/p/${p.id}`}
                  className="font-medium hover:text-accent"
                >
                  {p.title}
                </Link>
                <span className="font-mono text-xs text-muted">{p.id}</span>
                <Tag tone="bad">
                  {p.duplicate_of
                    ? `duplicate of ${p.duplicate_of}`
                    : `disqualified: ${p.disqualified_reason}`}
                </Tag>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
