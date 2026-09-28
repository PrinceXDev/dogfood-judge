import Link from "next/link";
import type { ReactNode } from "react";
import { activationLink, invite, runAssignment } from "@/app/actions";
import { buttonClass } from "@/components/button";
import { Countdown } from "@/components/countdown";
import { StageBars } from "@/components/events/event-card";
import { ActionForm, Submit } from "@/components/forms";
import { Icon, type IconName } from "@/components/icons";
import { LiveProgress } from "@/components/live-progress";
import {
  Bar,
  EmptyState,
  Field,
  inputCls,
  PageHeader,
  Panel,
  Problem,
  Tag,
  type Tone,
} from "@/components/ui";
import { api, load, requireMe } from "@/lib/api";
import { f2, pct, votingOpen, when } from "@/lib/format";
import { timeline } from "@/lib/timeline";
import type { Event, JudgeSummary, Progress, Results } from "@/lib/types";

type Alert = {
  id: string;
  tone: Tone;
  icon: IconName;
  text: ReactNode;
  href?: string;
  cta?: string;
};

export default async function CommandCenter({
  params,
}: PageProps<"/organize/[event]">) {
  const { event } = await params;
  const here = `/organize/${event}`;
  await requireMe(here);
  const er = await load<Event>(`/events/${event}`, here);
  if (!er.ok) return <Problem error={er.error} />;
  const e = er.data;
  const pr = await load<Progress>(`/events/${e.id}/progress`, here);
  if (!pr.ok) return <Problem error={pr.error} />;
  const p = pr.data;
  const [judges, results] = await Promise.all([
    api<JudgeSummary[] | null>(`/events/${e.id}/judges`).then((j) => j ?? []),
    api<Results>(`/events/${e.id}/results`).catch(() => null),
  ]);
  const track = new Map((e.tracks ?? []).map((t) => [t.id, t.name]));
  const ranked = (results?.rows ?? []).filter((x) => x.ranks.biasscale);
  const rep = results?.report;
  const rb = rep?.robustness;
  const winner = ranked[0];
  const k = rep?.top_k ?? 3;
  const boundary = ranked.filter(
    (x) => x.prob_top_k > 0.05 && x.prob_top_k < 0.95,
  ).length;

  // Attention items, each derived from real data and pointing at where to act.
  const alerts: Alert[] = [];
  if (p.unassigned > 0)
    alerts.push({
      id: "unassigned",
      tone: "warn",
      icon: "users",
      text: (
        <>
          <b>{p.unassigned}</b> project{p.unassigned === 1 ? " has" : "s have"}{" "}
          fewer than {e.reviews_per_project} reviewers assigned.
        </>
      ),
      href: "#judges",
      cta: "Run assignment",
    });
  if (rep && rep.components > 1)
    alerts.push({
      id: "components",
      tone: "bad",
      icon: "split",
      text: (
        <>
          Judges split into <b>{rep.components}</b> groups that share no
          projects; scores can't be compared across them.
        </>
      ),
      href: "#judges",
      cta: "Add bridging reviews",
    });
  if (!results?.published && boundary > 0)
    alerts.push({
      id: "boundary",
      tone: "warn",
      icon: "split",
      text: (
        <>
          <b>{boundary}</b> project{boundary === 1 ? " is" : "s are"} on the
          prize boundary (5% &lt; P(top {k}) &lt; 95%).
        </>
      ),
      href: `/organize/${e.slug}/results#boundary`,
      cta: "Tie-breaker round",
    });
  if (rb && rb.winner_margin < 1 && ranked[1])
    alerts.push({
      id: "tie",
      tone: "warn",
      icon: "trophy",
      text: (
        <>
          <b>{winner.project.title}</b> and <b>{ranked[1].project.title}</b> are
          statistically tied (lead {f2(rb.winner_margin)} SE).
        </>
      ),
      href: `/organize/${e.slug}/results#defensibility`,
      cta: "Inspect",
    });
  if (rb && rb.winner_held < rb.refits)
    alerts.push({
      id: "flips",
      tone: "info",
      icon: "shieldCheck",
      text: (
        <>
          Removing any one of <b>{rb.refits - rb.winner_held}</b> judges changes
          the winner ({rb.winner_held}/{rb.refits} refits hold).
        </>
      ),
      href: `/organize/${e.slug}/results#defensibility`,
      cta: "Test stability",
    });
  for (const j of (results?.judges ?? [])
    .filter((j) =>
      (j.flags ?? []).some((f) => /^(flat|compressed|contrarian)/.test(f)),
    )
    .slice(0, 3)) {
    const flag =
      (j.flags ?? []).find((f) => /^(flat|compressed|contrarian)/.test(f)) ??
      "";
    alerts.push({
      id: `flag-${j.judge}`,
      tone: "neutral",
      icon: "flag",
      text: (
        <>
          Judge <b>{j.name}</b>{" "}
          <span className="font-mono text-xs text-muted">{j.judge}</span>:{" "}
          {flag.split(":")[0]} scoring
          {flag.includes(":") ? ` (${flag.split(":")[1].trim()})` : ""}.
        </>
      ),
      href: `/organize/${e.slug}/results#judges`,
      cta: "Diagnostics",
    });
  }
  if (p.flagged_votes > 0)
    alerts.push({
      id: "held-votes",
      tone: "warn",
      icon: "vote",
      text: (
        <>
          <b>{p.flagged_votes}</b> community vote
          {p.flagged_votes === 1 ? " is" : "s are"} held by the anti-abuse
          rules.
        </>
      ),
      href: `/organize/${e.slug}/moderation#votes`,
      cta: "Review",
    });
  if (votingOpen(e) && e.voting_close_at)
    alerts.push({
      id: "voting",
      tone: "info",
      icon: "clock",
      text: (
        <>
          Voting closes in{" "}
          <Countdown at={e.voting_close_at} className="text-ink" />. Results
          can't be published until then.
        </>
      ),
      href: `/organize/${e.slug}/settings`,
      cta: "Schedule",
    });
  const inactive = judges.filter((j) => !j.can_login).length;
  if (inactive > 0)
    alerts.push({
      id: "inactive",
      tone: "neutral",
      icon: "key",
      text: (
        <>
          <b>{inactive}</b> judge{inactive === 1 ? " hasn't" : "s haven't"}{" "}
          activated an account yet.
        </>
      ),
      href: "#judges",
      cta: "Activation links",
    });

  const stages = timeline(e);
  const toneCls: Record<Tone, string> = {
    neutral: "text-muted",
    info: "text-info",
    accent: "text-accent",
    good: "text-good",
    warn: "text-warn",
    bad: "text-bad",
  };

  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title="Overview"
        sub="Everything that needs a decision, live. Counts update every five seconds."
        actions={
          <>
            <Link
              href={`/organize/${e.slug}/results`}
              className={buttonClass("accent")}
            >
              <Icon name="trophy" size={14} /> Results
            </Link>
            <Link
              href={`/organize/${e.slug}/settings`}
              className={buttonClass("secondary")}
            >
              <Icon name="settings" size={14} /> Settings
            </Link>
          </>
        }
      />

      <Panel
        title="Event control"
        icon="clock"
        aside={<span className="font-mono">schedule · UTC</span>}
      >
        <StageBars stages={stages} />
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs sm:grid-cols-4">
          {stages.map((s) => (
            <div key={s.key}>
              <p className="text-muted">
                {s.key === "results"
                  ? results?.published
                    ? `Published ${when(e.results_published_at).replace(" UTC", "")}`
                    : "Not published"
                  : s.end
                    ? `Ends ${when(s.end).replace(" UTC", "")}`
                    : s.state === "off"
                      ? "Not scheduled"
                      : "Open-ended"}
              </p>
              <Link
                href={
                  s.key === "results"
                    ? `/organize/${e.slug}/results`
                    : `/organize/${e.slug}/settings`
                }
                className="mt-1 inline-flex items-center gap-1 text-accent hover:underline"
              >
                {s.key === "results"
                  ? results?.published
                    ? "Manage"
                    : "Review & publish"
                  : "Edit dates"}
                <Icon name="arrowRight" size={11} />
              </Link>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <LiveProgress initial={p} target={e.reviews_per_project} />

        <div className="grid content-start gap-6">
          <Panel
            title="Result defensibility"
            icon="shieldCheck"
            aside={
              <Link
                href={`/organize/${e.slug}/results#defensibility`}
                className="hover:text-ink"
              >
                open →
              </Link>
            }
          >
            {winner && rb ? (
              <>
                <p className="text-[11px] text-muted">Current #1</p>
                <p className="mt-0.5 truncate text-lg font-semibold tracking-tight">
                  {winner.project.title}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  {(
                    [
                      [
                        "Winner held",
                        `${rb.winner_held}/${rb.refits}`,
                        rb.winner_held === rb.refits
                          ? "text-accent"
                          : "text-warn",
                      ],
                      [`P(top ${k})`, pct(winner.prob_top_k), ""],
                      [
                        "Rank interval",
                        `#${winner.rank_low}–#${winner.rank_high}`,
                        "",
                      ],
                      [
                        "Lead over #2",
                        `${f2(rb.winner_margin)} SE`,
                        rb.winner_margin < 1 ? "text-warn" : "",
                      ],
                    ] as [string, string, string][]
                  ).map(([a, b, c]) => (
                    <div key={a}>
                      <dt className="text-[11px] text-muted">{a}</dt>
                      <dd
                        className={`font-mono text-lg tabular ${c || "text-ink"}`}
                      >
                        {b}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p
                  className={`mt-4 rounded-md px-2.5 py-1.5 text-center font-mono text-xs font-semibold ${rb.winner_held === rb.refits ? "bg-accent/10 text-accent" : "bg-warn/10 text-warn"}`}
                >
                  {rb.winner_held === rb.refits ? "STABLE" : "SENSITIVE"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                The ranking appears once judges submit reviews.
              </p>
            )}
          </Panel>

          <Panel
            title="Attention required"
            icon="alert"
            aside={<span className="font-mono">{alerts.length}</span>}
            bodyClass="p-2"
          >
            {alerts.length ? (
              <ul className="grid">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 rounded-md px-3 py-2.5 hover:bg-surface-hover/60"
                  >
                    <Icon
                      name={a.icon}
                      size={15}
                      className={`mt-0.5 shrink-0 ${toneCls[a.tone]}`}
                    />
                    <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-2 [&_b]:font-medium [&_b]:text-ink">
                      {a.text}
                    </p>
                    {a.href && (
                      <Link
                        href={a.href}
                        data-nav-item
                        className="shrink-0 whitespace-nowrap text-xs font-medium text-accent hover:underline"
                      >
                        {a.cta}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted">
                Nothing needs you right now. The pack is in order.
              </p>
            )}
          </Panel>
        </div>
      </div>

      <section id="judges" className="mt-12 scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              Judges & assignments
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              {judges.length} judges
            </h2>
          </div>
          <ActionForm
            action={runAssignment}
            className="flex flex-col items-end gap-2"
          >
            <input type="hidden" name="event" value={e.id} />
            <Submit variant="accent">
              <Icon name="activity" size={14} /> Run assignment engine
            </Submit>
          </ActionForm>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-ink-2">
          Tops every project up to {e.reviews_per_project} reviewers: matching
          track, no conflicts, balanced load, and bridging judge groups so
          scores can be normalized. Never removes existing work.
        </p>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          {judges.length ? (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <ul>
                {judges.map((j) => (
                  <li
                    key={j.user.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_140px_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {j.user.name}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {j.user.email}
                      </p>
                    </div>
                    <div className="hidden flex-wrap gap-1 sm:flex">
                      {(j.tracks ?? []).length ? (
                        (j.tracks ?? []).map((t) => (
                          <Tag key={t}>{track.get(t) ?? t}</Tag>
                        ))
                      ) : (
                        <span className="text-xs text-muted">any track</span>
                      )}
                    </div>
                    <div className="hidden items-center gap-2 sm:flex">
                      <Bar
                        value={j.assigned ? (100 * j.done) / j.assigned : 0}
                        className="flex-1"
                      />
                      <span className="w-12 text-right font-mono text-xs tabular">
                        {j.done}/{j.assigned}
                      </span>
                    </div>
                    <div className="justify-self-end">
                      {j.can_login ? (
                        <Tag tone="good" dot>
                          active
                        </Tag>
                      ) : (
                        <ActionForm
                          action={activationLink}
                          className="grid justify-items-end gap-1"
                        >
                          <input type="hidden" name="event" value={e.id} />
                          <input type="hidden" name="user" value={j.user.id} />
                          <input
                            type="hidden"
                            name="name"
                            value={j.user.name}
                          />
                          <Submit size="sm" variant="secondary">
                            Activation link
                          </Submit>
                        </ActionForm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState title="No judges yet" icon="users">
              Invite judges with the form alongside, then run the assignment
              engine.
            </EmptyState>
          )}

          <div className="grid content-start gap-6">
            <Panel id="invite" title="Invite a judge or organizer" icon="plus">
              <ActionForm action={invite} className="grid gap-3">
                <input type="hidden" name="event" value={e.id} />
                <Field
                  label="Email"
                  hint="Optional: only that account can accept."
                >
                  <input type="email" name="email" className={inputCls} />
                </Field>
                <Field label="Role">
                  <select name="role" className={inputCls}>
                    <option value="judge">Judge</option>
                    <option value="organizer">Organizer</option>
                  </select>
                </Field>
                <div>
                  <Submit variant="secondary">Create invite link</Submit>
                </div>
              </ActionForm>
            </Panel>
            <Panel id="exports" title="Exports" icon="download">
              <ul className="grid gap-2 text-sm">
                {(
                  [
                    [
                      "scores.csv",
                      `/api/v1/events/${e.id}/export/scores.csv`,
                      "every criterion score",
                    ],
                    [
                      "results.csv",
                      `/api/v1/events/${e.id}/export/results.csv`,
                      "ranking with intervals",
                    ],
                    [
                      "export.json",
                      `/api/v1/events/${e.id}/export.json`,
                      "the full event, re-importable",
                    ],
                    [
                      "results bundle",
                      `/api/v1/events/${e.id}/results/bundle`,
                      "signed, pseudonymized",
                    ],
                  ] as [string, string, string][]
                ).map(([label, href, hint]) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="group flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 hover:border-line-strong hover:bg-surface-hover/60"
                    >
                      <span>
                        <span className="font-mono text-[13px] text-ink">
                          {label}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {hint}
                        </span>
                      </span>
                      <Icon
                        name="download"
                        size={14}
                        className="text-muted group-hover:text-accent"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </section>
    </>
  );
}
