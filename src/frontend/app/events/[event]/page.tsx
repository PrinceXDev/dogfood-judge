import Link from "next/link";
import { buttonClass } from "@/components/button";
import { Countdown } from "@/components/countdown";
import { StageBars } from "@/components/events/event-card";
import { ProjectCard } from "@/components/gallery";
import { Icon } from "@/components/icons";
import {
  Callout,
  Card,
  Eyebrow,
  Page,
  Panel,
  Problem,
  Section,
  StatusDot,
  Tag,
} from "@/components/ui";
import { api, apiRoot, getMe, load, rolesIn } from "@/lib/api";
import {
  f1,
  judgingOpen,
  phase,
  submissionsOpen,
  votingOpen,
  when,
} from "@/lib/format";
import { nextDeadline, timeline } from "@/lib/timeline";
import type {
  AuditLog,
  Event,
  GalleryPage,
  Progress,
  Results,
  SigningKey,
  Team,
} from "@/lib/types";

export default async function EventPage({
  params,
}: PageProps<"/events/[event]">) {
  const { event } = await params;
  const r = await load<Event>(`/events/${event}`, `/events/${event}`);
  if (!r.ok) return <Problem error={r.error} />;
  const e = r.data;
  const me = await getMe();
  const roles = rolesIn(me, e.id);
  const published = !!e.results_published_at;
  const [page, team, progress, audit, results, key] = await Promise.all([
    api<GalleryPage>(`/events/${e.id}/projects`),
    me && !roles.judge
      ? api<Team>(`/events/${e.id}/team`).catch(() => null)
      : Promise.resolve(null),
    roles.organizer
      ? api<Progress>(`/events/${e.id}/progress`).catch(() => null)
      : Promise.resolve(null),
    roles.organizer
      ? api<AuditLog>(`/events/${e.id}/audit`).catch(() => null)
      : Promise.resolve(null),
    published
      ? api<Results>(`/events/${e.id}/results`).catch(() => null)
      : Promise.resolve(null),
    apiRoot<SigningKey>("/.well-known/dogfood-signing-key").catch(() => null),
  ]);
  const ph = phase(e);
  const live = !["results published", "upcoming", "awaiting results"].includes(
    ph,
  );
  const next = nextDeadline(e);
  const stages = timeline(e);
  const totalWeight = (e.criteria ?? []).reduce((s, c) => s + c.weight, 0) || 1;
  const podium = (results?.rows ?? [])
    .filter((x) => x.ranks.biasscale)
    .slice(0, 3);

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_60%_at_85%_0%,var(--accent-soft),transparent_70%)]" />
        <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={live ? "accent" : published ? "good" : "neutral"}>
              {live && <StatusDot tone="accent" pulse />}
              {ph}
            </Tag>
            {roles.organizer && <Tag tone="accent">you organize this</Tag>}
            {roles.judge && <Tag tone="info">you judge this</Tag>}
            {roles.participant && <Tag tone="good">you're participating</Tag>}
            <span className="font-mono text-xs text-muted">{e.slug}</span>
          </div>
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="max-w-3xl">
              <h1 className="animate-rise text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
                {e.name}
              </h1>
              {e.description && (
                <p className="mt-4 text-pretty text-lg text-ink-2">
                  {e.description}
                </p>
              )}
              <div className="mt-7 flex flex-wrap gap-2">
                <Link
                  href={`/events/${e.slug}/projects`}
                  className={buttonClass("accent", "lg")}
                >
                  Browse {page.total} projects{" "}
                  <Icon name="arrowRight" size={15} />
                </Link>
                {published && (
                  <Link
                    href={`/events/${e.slug}/results`}
                    className={buttonClass("secondary", "lg")}
                  >
                    <Icon name="trophy" size={15} /> Results
                  </Link>
                )}
                {votingOpen(e) && (
                  <Link
                    href={`/events/${e.slug}/ballot`}
                    className={buttonClass("secondary", "lg")}
                  >
                    <Icon name="vote" size={15} /> Vote
                  </Link>
                )}
                {roles.organizer && (
                  <Link
                    href={`/organize/${e.slug}`}
                    className={buttonClass("secondary", "lg")}
                  >
                    <Icon name="activity" size={15} /> Command center
                  </Link>
                )}
              </div>
            </div>
            {next && (
              <div className="rounded-xl border border-line-strong bg-surface/70 px-5 py-4 backdrop-blur">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                  {next.label} in
                </p>
                <Countdown
                  at={next.at}
                  className="mt-1 block text-3xl text-ink"
                />
                <p className="mt-1 text-xs text-muted">{when(next.at)}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <Page>
        <Panel
          title="Event health"
          icon="activity"
          aside={<span className="font-mono">schedule · UTC</span>}
        >
          <StageBars stages={stages} />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs sm:grid-cols-4">
            {stages.map((s) => (
              <div key={s.key} className="text-muted">
                <p className="text-ink-2">{s.label}</p>
                <p className="mt-0.5 font-mono text-[11px]">
                  {s.state === "off"
                    ? "not scheduled"
                    : s.key === "results"
                      ? s.start
                        ? when(s.start)
                        : "sealed until published"
                      : `${s.start ? when(s.start).replace(" UTC", "") : "·"} →`}
                </p>
                {s.key !== "results" && s.end && (
                  <p className="font-mono text-[11px]">{when(s.end)}</p>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {/* Role-specific next steps */}
            {roles.judge && (
              <Card className="mb-8" glow>
                <Eyebrow tone="info">Judging</Eyebrow>
                {judgingOpen(e) ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-ink-2">
                      Your assignments are waiting. You'll only ever see your
                      own scores.
                    </p>
                    <div className="flex gap-2">
                      <Link href="/judge" className={buttonClass("accent")}>
                        Open workspace
                      </Link>
                      <Link
                        href={`/judge/${e.slug}/pairwise`}
                        className={buttonClass("secondary")}
                      >
                        Pairwise mode
                      </Link>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-ink-2">
                    Judging is not open right now.
                  </p>
                )}
                {published && (
                  <Link
                    href={`/judge/${e.slug}/record`}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
                  >
                    Your signed judging record{" "}
                    <Icon name="arrowRight" size={13} />
                  </Link>
                )}
              </Card>
            )}

            {!roles.judge && !roles.organizer && (
              <Card className="mb-8" glow>
                <Eyebrow tone="good">Participate</Eyebrow>
                <div className="mt-3">
                  {team ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-ink-2">
                        You're on <b className="text-ink">{team.name}</b>
                        {team.project ? (
                          <>
                            {" "}
                            with{" "}
                            <b className="text-ink">{team.project.title}</b> (
                            {team.project.status})
                          </>
                        ) : null}
                        .
                      </p>
                      <Link
                        href={`/events/${e.slug}/team`}
                        className={buttonClass("accent")}
                      >
                        Team and submission <Icon name="arrowRight" size={14} />
                      </Link>
                    </div>
                  ) : submissionsOpen(e) ? (
                    me ? (
                      <Link
                        href={`/events/${e.slug}/team`}
                        className={buttonClass("accent")}
                      >
                        Create or join a team
                      </Link>
                    ) : (
                      <p className="text-ink-2">
                        <Link
                          href={`/login?next=/events/${e.slug}/team`}
                          className="text-accent hover:underline"
                        >
                          Sign in
                        </Link>{" "}
                        to form a team and submit.
                      </p>
                    )
                  ) : (
                    <p className="text-ink-2">Submissions are not open.</p>
                  )}
                </div>
              </Card>
            )}

            <Section
              eyebrow="Project explorer"
              title={`${page.total} submitted project${page.total === 1 ? "" : "s"}`}
              aside={
                <Link
                  href={`/events/${e.slug}/projects`}
                  className={buttonClass("ghost", "sm")}
                >
                  View all <Icon name="arrowRight" size={13} />
                </Link>
              }
            >
              {page.projects?.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {page.projects.slice(0, 6).map((p) => (
                    <ProjectCard key={p.id} p={p} />
                  ))}
                </div>
              ) : (
                <Callout>No projects have been submitted yet.</Callout>
              )}
            </Section>

            <Section
              eyebrow="Results"
              title={published ? "Published results" : "Results are sealed"}
            >
              {published && podium.length ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {podium.map((x, i) => (
                    <Link
                      key={x.project.id}
                      href={`/p/${x.project.id}`}
                      className={`rounded-lg border p-4 transition-colors hover:border-line-strong ${i === 0 ? "border-accent/40 bg-accent/[0.05]" : "border-line bg-surface"}`}
                    >
                      <p
                        className={`font-mono text-3xl ${i === 0 ? "text-accent" : "text-ink-2"}`}
                      >
                        {i + 1}
                      </p>
                      <p className="mt-2 font-medium">{x.project.title}</p>
                      <p className="text-xs text-muted">
                        {x.project.team_name}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="max-w-2xl text-sm text-ink-2">
                  No score is visible outside the organizing team until results
                  are published. Then the ranking appears with rank intervals, a
                  robustness test and a signed, reproducible bundle.
                </p>
              )}
              {published && (
                <Link
                  href={`/events/${e.slug}/results`}
                  className={`${buttonClass("secondary")} mt-4`}
                >
                  Full results and verification{" "}
                  <Icon name="arrowRight" size={14} />
                </Link>
              )}
            </Section>
          </div>

          <aside className="grid content-start gap-4">
            {progress && (
              <Panel
                title="Judging health"
                icon="gavel"
                aside={
                  <Link href={`/organize/${e.slug}`} className="hover:text-ink">
                    open →
                  </Link>
                }
              >
                <p className="font-mono text-3xl tabular text-accent">
                  {Math.round(progress.percent)}%
                </p>
                <p className="text-xs text-muted">
                  {progress.done} of {progress.assignments} reviews done
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted">Fully reviewed</dt>
                    <dd className="font-mono text-base">
                      {progress.fully_reviewed}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Under-assigned</dt>
                    <dd
                      className={`font-mono text-base ${progress.unassigned ? "text-warn" : ""}`}
                    >
                      {progress.unassigned}
                    </dd>
                  </div>
                </dl>
              </Panel>
            )}

            {!!e.criteria?.length && (
              <Panel title="How projects are judged" icon="layers">
                <ul className="grid gap-3">
                  {e.criteria.map((c) => (
                    <li key={c.id}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span>{c.name}</span>
                        <span className="font-mono text-[11px] text-muted">
                          ×{f1(c.weight)} · {c.scale_min}–{c.scale_max}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-accent-2"
                          style={{
                            width: `${(100 * c.weight) / totalWeight}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs leading-relaxed text-muted">
                  {e.reviews_per_project} reviews per project. Scores are
                  normalized for each judge's leniency and scale use.{" "}
                  <Link href="/#how" className="text-accent hover:underline">
                    How it works
                  </Link>
                </p>
              </Panel>
            )}

            {(!!e.tracks?.length || !!e.prizes?.length) && (
              <Panel title="Tracks & prizes" icon="trophy">
                {!!e.tracks?.length && (
                  <div className="flex flex-wrap gap-1.5">
                    {e.tracks.map((t) => (
                      <Link
                        key={t.id}
                        href={`/events/${e.slug}/projects?track=${t.id}`}
                      >
                        <Tag className="hover:border-muted">{t.name}</Tag>
                      </Link>
                    ))}
                  </div>
                )}
                {!!e.prizes?.length && (
                  <ul className="mt-4 grid gap-2 border-t border-line pt-4">
                    {e.prizes.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span>{p.name}</span>
                        {p.value && (
                          <span className="font-mono text-xs text-accent">
                            {p.value}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            <Panel title="Integrity" icon="shieldCheck">
              <ul className="grid gap-3 text-sm">
                {audit ? (
                  <li className="flex items-start gap-2.5">
                    <StatusDot tone={audit.verification.ok ? "good" : "bad"} />
                    <span className="text-ink-2">
                      {audit.verification.ok
                        ? `Audit chain intact: ${audit.verification.entries} entries verify.`
                        : `Audit chain broken at entry ${audit.verification.broken_at}.`}{" "}
                      <Link
                        href={`/organize/${e.slug}/audit`}
                        className="text-accent hover:underline"
                      >
                        Review trail
                      </Link>
                    </span>
                  </li>
                ) : (
                  <li className="flex items-start gap-2.5">
                    <StatusDot tone="good" />
                    <span className="text-ink-2">
                      Every submission, review and deadline change is written to
                      a hash-chained audit log.
                    </span>
                  </li>
                )}
                <li className="flex items-start gap-2.5">
                  <StatusDot tone="accent" />
                  <span className="text-ink-2">
                    Records and results are signed with Ed25519
                    {key ? (
                      <span className="font-mono text-xs"> · {key.key_id}</span>
                    ) : (
                      ""
                    )}
                    .{" "}
                    <Link
                      href="/verify"
                      className="text-accent hover:underline"
                    >
                      Verify a record
                    </Link>
                  </span>
                </li>
              </ul>
            </Panel>

            <Panel title="Format" icon="users">
              <dl className="grid grid-cols-3 gap-3 text-xs">
                {(
                  [
                    ["Team size", `≤ ${e.max_team_size}`],
                    ["Reviews", `${e.reviews_per_project}/project`],
                    ["Votes", `${e.votes_per_voter}/voter`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted">{k}</dt>
                    <dd className="mt-0.5 font-mono text-sm">{v}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </aside>
        </div>
      </Page>
    </>
  );
}
