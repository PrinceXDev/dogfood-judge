import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { CopyField } from "@/components/forms";
import { Icon, type IconName } from "@/components/icons";
import { HeroInstrument } from "@/components/landing/hero-instrument";
import { NetworkBackground } from "@/components/landing/network-background";
import { ProofChain } from "@/components/landing/proof-chain";
import { SimulationLab } from "@/components/landing/simulation-lab";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { StoryScene } from "@/components/landing/story-scene";
import { CountUp, Reveal } from "@/components/motion";
import { GITHUB_URL } from "@/components/shell/footer";
import { EmptyState } from "@/components/ui";
import { BoundaryStrip } from "@/components/viz/boundary-strip";
import { DefensibilityGraph } from "@/components/viz/defensibility-graph";
import { ReviewInfluence } from "@/components/viz/review-influence";
import { ScoreBreakdown } from "@/components/viz/score-breakdown";
import { api, apiRoot } from "@/lib/api";
import {
  type DemoResult,
  demoQuery,
  jLabel,
  pLabel,
  STORY_WORLD,
} from "@/lib/demo";
import type { Event, SigningKey } from "@/lib/types";

type Stats = {
  events: number;
  projects: number;
  judges: number;
  reviews: number;
  comparisons: number;
  audit_entries: number;
};

function Feature({
  n,
  kicker,
  title,
  children,
  id,
  body,
}: {
  n: string;
  kicker: string;
  title: ReactNode;
  body: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal className="mb-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <div>
            <p className="flex items-center gap-3 font-mono text-xs text-muted">
              <span className="text-accent">{n}</span>
              <span className="h-px w-8 bg-line-strong" />
              <span className="uppercase tracking-[0.16em]">{kicker}</span>
            </p>
            <h2 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              {title}
            </h2>
          </div>
          <div className="text-pretty text-[15px] leading-relaxed text-ink-2 lg:pb-2">
            {body}
          </div>
        </Reveal>
        <Reveal delay={120}>{children}</Reveal>
      </div>
    </section>
  );
}

const OFFLINE: [IconName, string, string, string][] = [
  ["box", "Docker", "Two containers, one command.", "docker compose up"],
  [
    "database",
    "SQLite",
    "One file in a named volume. Back it up with cp.",
    "/data/dogfood.db",
  ],
  [
    "terminal",
    "API",
    "Every page action is an HTTP call, described in OpenAPI 3.1.",
    "GET /api/v1/openapi.yaml",
  ],
  [
    "key",
    "CLI",
    "Re-run the engine and check signatures with no server at all.",
    "dogfood verify-results bundle.json",
  ],
];

export default async function Landing() {
  const [stats, demo, key, events] = await Promise.all([
    api<Stats>("/stats", { token: null }).catch(() => null),
    api<DemoResult>(`/demo/simulate?${demoQuery(STORY_WORLD)}`, {
      token: null,
    }).catch(() => null),
    apiRoot<SigningKey>("/.well-known/dogfood-signing-key").catch(() => null),
    api<Event[] | null>("/events", { token: null }).catch(() => null),
  ]);
  const demoEvent =
    events?.find((e) => e.slug === "sample-hack-2026") ?? events?.[0];
  const rep = demo?.report;
  const rb = rep?.robustness;
  const winner = rep?.projects[0];

  return (
    <>
      <SmoothScroll />

      {/* HERO */}
      <section className="relative -mt-14 overflow-hidden pt-14">
        <NetworkBackground />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_70%_40%,var(--accent-soft),transparent_70%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />
        <div className="relative mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-20">
          <div className="max-w-2xl">
            <Link
              href="/verify"
              className="group inline-flex animate-rise items-center gap-2.5 rounded-full border border-line-strong bg-surface/60 py-1 pl-1.5 pr-3 text-xs text-ink-2 backdrop-blur transition-colors hover:border-accent/40"
            >
              <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent">
                open source
              </span>
              Self-hosted · offline · signed results
              <Icon
                name="arrowRight"
                size={12}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <h1 className="mt-7 animate-rise text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.05em] [animation-delay:80ms] sm:text-6xl lg:text-7xl">
              Can your hackathon results{" "}
              <span className="font-serif font-normal italic tracking-[-0.02em] text-accent">
                survive scrutiny?
              </span>
            </h1>
            <p className="mt-7 max-w-xl animate-rise text-pretty text-lg leading-relaxed text-ink-2 [animation-delay:160ms]">
              Open-source infrastructure for submissions, judging, normalization
              and verifiable results. Judge the work. Prove the result.
            </p>
            <div className="mt-9 flex animate-rise flex-wrap gap-3 [animation-delay:240ms]">
              <Link href="/events" className={buttonClass("accent", "lg")}>
                Explore the platform <Icon name="arrowRight" size={15} />
              </Link>
              <a href="#run" className={buttonClass("secondary", "lg")}>
                <Icon name="terminal" size={15} /> Run locally
              </a>
              {demoEvent && (
                <Link
                  href={`/events/${demoEvent.slug}`}
                  className={buttonClass("ghost", "lg")}
                >
                  View demo event
                </Link>
              )}
            </div>
            <dl className="mt-12 grid max-w-lg animate-rise grid-cols-3 gap-6 border-t border-line pt-6 [animation-delay:320ms]">
              {[
                ["Empirical Bayes", "judge leniency + scale"],
                ["Bootstrap", "rank intervals"],
                ["Ed25519", "signed bundles"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-sm font-medium">{k}</dt>
                  <dd className="mt-0.5 text-xs text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="animate-rise [animation-delay:200ms]">
            {demo ? (
              <HeroInstrument data={demo} />
            ) : (
              <EmptyState title="The engine is not reachable" icon="activity">
                Start the API to see the live judging graph.
              </EmptyState>
            )}
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
      {stats && (
        <section
          aria-label="This instance"
          className="border-y border-line bg-surface/40"
        >
          <div className="mx-auto grid max-w-7xl grid-cols-2 divide-line px-4 sm:px-6 md:grid-cols-5 md:divide-x">
            {(
              [
                ["projects", stats.projects],
                ["judges", stats.judges],
                ["reviews", stats.reviews],
                ["events", stats.events],
                ["audit entries", stats.audit_entries],
              ] as [string, number][]
            ).map(([label, v]) => (
              <div key={label} className="px-2 py-7 md:px-6">
                <p className="font-mono text-3xl font-medium tracking-tight text-ink">
                  <CountUp value={v} />
                </p>
                <p className="mt-1 text-xs text-muted">
                  {label} on this instance
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* STORY */}
      {demo && (
        <section
          id="how"
          aria-label="How the judging engine works"
          className="scroll-mt-14"
        >
          <StoryScene data={demo} />
        </section>
      )}

      {demo && rep && (
        <>
          <Feature
            n="00"
            kicker="The problem"
            title="Raw scores don't tell the whole story."
            body={
              <>
                A 4 from a harsh judge can mean more than a 5 from a generous
                one. The engine models every review as{" "}
                <span className="font-mono text-ink">
                  mean + leniency + scale × quality + noise
                </span>{" "}
                and corrects each judge only as far as the evidence supports.
                Pick a project and flip to the judge-corrected view.
              </>
            }
          >
            <ScoreBreakdown
              mu={rep.fit.mu}
              projects={[...rep.projects]
                .sort(
                  (a, b) => Math.abs(b.rank_change) - Math.abs(a.rank_change),
                )
                .slice(0, 6)
                .map((p) => ({
                  id: p.project,
                  label: pLabel(p.project),
                  rawMean: p.scores.raw,
                  final: p.scores.biasscale,
                  rawRank: p.ranks.raw,
                  finalRank: p.ranks.biasscale,
                  reviews: demo.reviews
                    .filter((r) => r.project === p.project)
                    .map((r) => {
                      const j = rep.judges.find((x) => x.judge === r.judge);
                      return {
                        judge: r.judge,
                        judgeLabel: jLabel(r.judge),
                        score: r.score,
                        bias: j?.bias ?? 0,
                        scale: j?.scale ?? 1,
                      };
                    }),
                }))}
            />
          </Feature>

          {rb && winner && (
            <Feature
              n="01"
              kicker="Robustness"
              title="Know whether your winner is defensible."
              body="Every judge is removed in turn and the whole model refitted: leave-one-judge-out. If first place survives every removal, no single judge decided it. Hover a judge to ask what happens without them, or run the full test."
            >
              <div className="rounded-xl border border-line bg-surface/50 p-6 sm:p-10">
                <DefensibilityGraph
                  winner={{ id: winner.project, label: pLabel(winner.project) }}
                  judges={rep.judges.map((j) => ({
                    id: j.judge,
                    label: jLabel(j.judge),
                    flips: j.flips_first,
                    influence: j.influence,
                    flipsTopK: j.flips_top_k,
                  }))}
                  refits={rb.refits}
                  held={rb.winner_held}
                  topK={rep.top_k}
                  probTopK={winner.prob_top_k}
                  rankLow={winner.rank_low}
                  rankHigh={winner.rank_high}
                  margin={rb.winner_margin}
                />
              </div>
            </Feature>
          )}

          {!!rep.outliers?.length && (
            <Feature
              n="02"
              kicker="Outliers"
              title="Find the review that changed everything."
              body="Some reviews can't be explained by the judge's habits or by what everyone else saw. The engine flags them and reports what each one is worth: the project's rank with it, and after a full refit without it."
            >
              <ReviewInfluence
                total={rep.projects.length}
                reviews={rep.outliers.map((o) => ({
                  judge: o.judge,
                  judgeLabel: jLabel(o.judge),
                  project: o.project,
                  projectLabel: pLabel(o.project),
                  score: o.score,
                  expected: o.expected,
                  z: o.z,
                  rankWith: o.rank_with,
                  rankWithout: o.rank_without,
                }))}
              />
            </Feature>
          )}

          <Feature
            n="03"
            kicker="Adaptive review"
            title="Spend judge time where it matters."
            body={`Most projects are already decided. A few sit on the prize boundary, where one more opinion can change who wins. The tie-breaker round sends extra reviews only there: P(top ${rep.top_k}) between 5% and 95%, closest to a coin flip first.`}
          >
            <BoundaryStrip
              k={rep.top_k}
              projects={rep.projects.map((p) => ({
                id: p.project,
                label: pLabel(p.project),
                p: p.prob_top_k,
              }))}
            />
          </Feature>

          <Feature
            n="04"
            kicker="Proof chain"
            title="Results you can reproduce."
            body="Publishing produces a bundle: every criterion score with judges pseudonymized, and a manifest signed by the portal that commits to a fingerprint of those inputs, the audit-log entry of the publication, and the ranking. Change one character and verification fails."
          >
            <ProofChain
              reviews={demo.reviews}
              keyId={key?.key_id ?? "unavailable"}
            />
          </Feature>
        </>
      )}

      <Feature
        n="05"
        kicker="Offline"
        title="Built for offline operation."
        body="A hackathon's Wi-Fi is the least reliable thing in the building. Dogfood Judge runs on one laptop with the network off: no cloud accounts, no hosted database, no third-party requests, not even for fonts."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {OFFLINE.map(([icon, t, s, code]) => (
            <div
              key={t}
              className="glow-edge flex flex-col rounded-lg border border-line bg-surface p-5"
            >
              <span className="grid size-9 place-items-center rounded-md border border-line-strong bg-surface-2 text-accent">
                <Icon name={icon} size={17} />
              </span>
              <p className="mt-5 font-medium">{t}</p>
              <p className="mt-1 flex-1 text-sm text-ink-2">{s}</p>
              <code className="mt-5 block truncate rounded border border-line bg-sunken px-2.5 py-1.5 font-mono text-[11px] text-ink-2">
                {code}
              </code>
            </div>
          ))}
        </div>
      </Feature>

      {demo && (
        <Feature
          id="simulate"
          n="06"
          kicker="Simulation"
          title={
            <>
              Break the judging.{" "}
              <span className="font-serif font-normal italic text-accent">
                Watch the engine.
              </span>
            </>
          }
          body="Tune a synthetic hackathon and the same engine that ranks real events analyzes it. Because the world is synthetic, every ranking is scored against the truth that generated it. Crank up leniency and watch the raw mean fall apart."
        >
          <SimulationLab initial={demo} />
        </Feature>
      )}

      {/* RUN LOCALLY + FINAL CTA */}
      <section id="run" className="relative scroll-mt-20 overflow-hidden py-28">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <Reveal>
            <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
              Run your next hackathon on infrastructure{" "}
              <span className="font-serif font-normal italic text-accent">
                you can verify.
              </span>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-ink-2">
              Three commands and you have a seeded portal on{" "}
              <span className="font-mono text-ink">localhost:8080</span>, with
              demo accounts for every role.
            </p>
          </Reveal>
          <Reveal
            delay={100}
            className="mx-auto mt-10 grid max-w-2xl gap-2 text-left"
          >
            <CopyField value={`git clone ${GITHUB_URL}.git`} />
            <CopyField value="cd dogfood-judge && docker compose up" />
            <CopyField value="open http://localhost:8080" />
          </Reveal>
          <Reveal
            delay={180}
            className="mt-10 flex flex-wrap justify-center gap-3"
          >
            <Link href="/events" className={buttonClass("accent", "lg")}>
              Explore the platform <Icon name="arrowRight" size={15} />
            </Link>
            <a href={GITHUB_URL} className={buttonClass("secondary", "lg")}>
              <Icon name="github" size={15} /> View on GitHub
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
