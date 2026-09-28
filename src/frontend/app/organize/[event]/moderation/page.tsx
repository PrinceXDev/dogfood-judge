import Link from "next/link";
import { hideComment, moderateProject, reviewVote } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import {
  EmptyState,
  Field,
  Hash,
  inputCls,
  Metric,
  PageHeader,
  Panel,
  Problem,
  Section,
  Tag,
} from "@/components/ui";
import { api, load, requireMe } from "@/lib/api";
import { ago, when } from "@/lib/format";
import type {
  Comment,
  DuplicatePair,
  Event,
  FlaggedVote,
  Project,
} from "@/lib/types";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export default async function Moderation({
  params,
}: PageProps<"/organize/[event]/moderation">) {
  const { event } = await params;
  const here = `/organize/${event}/moderation`;
  await requireMe(here);
  const er = await load<Event>(`/events/${event}`, here);
  if (!er.ok) return <Problem error={er.error} />;
  const e = er.data;
  const pr = await load<Project[]>(`/events/${e.id}/all-projects`, here);
  if (!pr.ok) return <Problem error={pr.error} />;
  const [dups, votes, comments] = await Promise.all([
    api<DuplicatePair[] | null>(`/events/${e.id}/duplicates`),
    api<FlaggedVote[] | null>(`/events/${e.id}/votes/flagged`),
    api<Comment[] | null>(`/events/${e.id}/comments`),
  ]);
  const pairs = dups ?? [];
  const held = votes ?? [];
  const notes = comments ?? [];
  const excluded = pr.data.filter(
    (p) => p.duplicate_of || p.disqualified_reason,
  );
  const openPairs = pairs.filter(
    ({ original: o, duplicate: d }) => d.duplicate_of !== o.id,
  ).length;
  const networks = [
    ...held.reduce((m, v) => {
      m.set(v.ip_hash, [...(m.get(v.ip_hash) ?? []), v]);
      return m;
    }, new Map<string, FlaggedVote[]>()),
  ].sort((a, b) => b[1].length - a[1].length);
  const hidden = notes.filter((c) => c.hidden).length;
  const titles = new Map(pr.data.map((p) => [p.id, p.title]));

  return (
    <>
      <PageHeader
        eyebrow="Moderation"
        title="Keep the field fair"
        sub="Resolve duplicate submissions, exclude or reinstate projects, and decide on community votes the anti-abuse rules held back. Every decision is written to the audit trail."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          icon="split"
          label="Duplicates to review"
          value={openPairs}
          tone={openPairs ? "warn" : undefined}
          sub={`${pairs.length} pair${pairs.length === 1 ? "" : "s"} detected`}
        />
        <Metric
          icon="flag"
          label="Excluded projects"
          value={excluded.length}
          sub={`of ${pr.data.length} in the event`}
        />
        <Metric
          icon="vote"
          label="Held votes"
          value={held.length}
          tone={held.length ? "warn" : undefined}
          sub={`${networks.length} network${networks.length === 1 ? "" : "s"}`}
        />
        <Metric
          icon="eye"
          label="Comments"
          value={notes.length}
          sub={`${hidden} hidden`}
        />
      </div>

      <Section
        title="Possible duplicate submissions"
        eyebrow="Duplicates"
        desc="Pairs sharing a normalised title or repository URL. The earlier submission is treated as the original."
      >
        {pairs.length ? (
          <div className="grid gap-4">
            {pairs.map(({ original: o, duplicate: d }) => {
              const marked = d.duplicate_of === o.id;
              const why = [
                norm(o.title) === norm(d.title) && "same title",
                o.repo_url && o.repo_url === d.repo_url && "same repository",
              ].filter(Boolean) as string[];
              return (
                <article
                  key={d.id}
                  data-nav-item
                  tabIndex={-1}
                  className="overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow)]"
                >
                  <div className="grid md:grid-cols-[1fr_auto_1fr]">
                    <Side label="Original" p={o} tone="good" />
                    <div className="flex items-center justify-center gap-2 border-y border-line bg-surface-2/60 px-3 py-2 md:flex-col md:border-x md:border-y-0 md:py-0">
                      <span
                        aria-hidden="true"
                        className="font-mono text-lg text-warn"
                      >
                        ≈
                      </span>
                      {why.map((w) => (
                        <span
                          key={w}
                          className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.1em] text-muted"
                        >
                          {w}
                        </span>
                      ))}
                    </div>
                    <Side label="Duplicate" p={d} tone="warn" />
                  </div>
                  <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2/40 px-4 py-2.5">
                    {marked ? (
                      <Tag tone="bad" dot>
                        Marked duplicate of {o.id}
                      </Tag>
                    ) : (
                      <p className="text-xs text-muted">
                        Marking excludes{" "}
                        <span className="font-mono">{d.id}</span> from judging
                        and results. You can reinstate it later.
                      </p>
                    )}
                    {!marked && (
                      <ActionForm
                        action={moderateProject}
                        className="grid gap-2"
                      >
                        <input type="hidden" name="project" value={d.id} />
                        <input type="hidden" name="of" value={o.id} />
                        <div>
                          <Submit size="sm" variant="secondary">
                            <Icon name="split" size={13} />
                            Mark as duplicate
                          </Submit>
                        </div>
                      </ActionForm>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState icon="split" title="No look-alikes.">
            No two submissions share a title or repository.
          </EmptyState>
        )}
      </Section>

      <Section
        title="Excluded projects"
        eyebrow="Exclusions"
        desc="Duplicates and disqualified projects are left out of judging and results. Reinstating clears both."
      >
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {excluded.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {excluded.map((p) => (
                <li
                  key={p.id}
                  data-nav-item
                  tabIndex={-1}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 font-medium">
                      <Link href={`/p/${p.id}`} className="hover:text-accent">
                        {p.title}
                      </Link>
                      <span className="font-mono text-xs font-normal text-muted">
                        {p.id}
                      </span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                      {p.duplicate_of ? (
                        <>
                          <Tag tone="warn">duplicate</Tag>
                          of <span className="font-mono">{p.duplicate_of}</span>
                          {titles.get(p.duplicate_of) && (
                            <span className="text-muted">
                              {titles.get(p.duplicate_of)}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <Tag tone="bad">disqualified</Tag>
                          {p.disqualified_reason}
                        </>
                      )}
                    </p>
                  </div>
                  <ActionForm action={moderateProject} className="grid gap-2">
                    <input type="hidden" name="project" value={p.id} />
                    <div>
                      <Submit
                        size="sm"
                        variant="ghost"
                        name="intent"
                        value="reinstate"
                      >
                        <Icon name="arrowLeft" size={13} />
                        Reinstate
                      </Submit>
                    </div>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="check" title="Every project is in the running.">
              Nothing has been excluded.
            </EmptyState>
          )}

          <Panel title="Disqualify a project" icon="gavel">
            <ActionForm action={moderateProject} className="grid gap-3">
              <input type="hidden" name="intent" value="disqualify" />
              <Field label="Project">
                <select name="project" className={inputCls}>
                  {pr.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.id})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reason">
                <input name="reason" required className={inputCls} />
              </Field>
              <div>
                <Submit variant="danger" size="sm">
                  Disqualify
                </Submit>
              </div>
            </ActionForm>
          </Panel>
        </div>
      </Section>

      <Section
        title="Held votes"
        eyebrow="Community voting"
        id="votes"
        desc="Votes flagged by the anti-abuse rules stay out of the tally until you decide. Grouped by network: a keyed hash of the voter's IP address, never the address itself."
      >
        {networks.length ? (
          <div className="grid gap-4">
            {networks.map(([ip, vs]) => (
              <Panel
                key={ip}
                icon="wifiOff"
                title={
                  <span className="flex items-center gap-2">
                    Network <Hash value={ip} head={12} className="text-ink-2" />
                  </span>
                }
                aside={
                  <span className="font-mono tabular">
                    {vs.length} vote{vs.length === 1 ? "" : "s"} ·{" "}
                    {new Set(vs.map((v) => v.user_id)).size} voter
                    {new Set(vs.map((v) => v.user_id)).size === 1 ? "" : "s"}
                  </span>
                }
                bodyClass=""
              >
                <ul className="divide-y divide-line">
                  {vs.map((v) => (
                    <li
                      key={`${v.user_id}-${v.project_id}`}
                      data-nav-item
                      tabIndex={-1}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1 text-sm">
                        <p>
                          <span className="font-medium">{v.user_name}</span>
                          <span className="text-muted"> voted for </span>
                          <Link
                            href={`/p/${v.project_id}`}
                            className="font-medium hover:text-accent"
                          >
                            {v.title}
                          </Link>
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <Tag tone="warn">{v.reason}</Tag>
                          <time
                            dateTime={v.created_at}
                            title={when(v.created_at)}
                          >
                            {ago(v.created_at)}
                          </time>
                        </p>
                      </div>
                      <ActionForm action={reviewVote} className="grid gap-2">
                        <input type="hidden" name="event" value={e.id} />
                        <input type="hidden" name="user" value={v.user_id} />
                        <input
                          type="hidden"
                          name="project"
                          value={v.project_id}
                        />
                        <div className="flex gap-2">
                          <Submit
                            size="sm"
                            variant="secondary"
                            name="approve"
                            value="1"
                          >
                            <Icon name="check" size={13} />
                            Count
                          </Submit>
                          <Submit
                            size="sm"
                            variant="danger"
                            name="approve"
                            value="0"
                          >
                            <Icon name="x" size={13} />
                            Discard
                          </Submit>
                        </div>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        ) : (
          <EmptyState icon="vote" title="You're all caught up.">
            No votes are waiting on a decision.
          </EmptyState>
        )}
      </Section>

      <Section
        title="Recent comments"
        eyebrow="Comments"
        id="comments"
        desc="Hidden comments disappear from the public project page but stay on record."
      >
        {notes.length ? (
          <ul className="grid gap-2">
            {notes.map((c) => (
              <li
                key={c.id}
                data-nav-item
                tabIndex={-1}
                className={`flex gap-4 rounded-lg border px-4 py-3 ${c.hidden ? "border-dashed border-line-strong bg-transparent" : "border-line bg-surface"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span className="font-medium text-ink">{c.user_name}</span>
                    on
                    <Link
                      href={`/p/${c.project_id}`}
                      className="text-ink-2 hover:text-accent"
                    >
                      {titles.get(c.project_id) ?? (
                        <span className="font-mono">{c.project_id}</span>
                      )}
                    </Link>
                    <span aria-hidden="true">·</span>
                    <time dateTime={c.created_at} title={when(c.created_at)}>
                      {ago(c.created_at)}
                    </time>
                    {c.hidden && <Tag tone="bad">hidden</Tag>}
                  </p>
                  <p
                    className={`mt-1.5 text-pretty text-sm leading-relaxed ${c.hidden ? "text-muted line-through decoration-muted/40" : "text-ink"}`}
                  >
                    {c.body}
                  </p>
                </div>
                <ActionForm
                  action={hideComment}
                  className="grid shrink-0 content-start gap-2"
                >
                  <input type="hidden" name="comment" value={c.id} />
                  <input
                    type="hidden"
                    name="hide"
                    value={c.hidden ? "0" : "1"}
                  />
                  <div>
                    <Submit size="sm" variant="ghost">
                      <Icon name="eye" size={13} />
                      {c.hidden ? "Unhide" : "Hide"}
                    </Submit>
                  </div>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="eye" title="Quiet in here.">
            No one has commented on a project yet.
          </EmptyState>
        )}
      </Section>
    </>
  );
}

function Side({
  label,
  p,
  tone,
}: {
  label: string;
  p: Project;
  tone: "good" | "warn";
}) {
  return (
    <div className="min-w-0 p-4">
      <p
        className={`mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] ${tone === "good" ? "text-good" : "text-warn"}`}
      >
        {label}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <Link href={`/p/${p.id}`} className="font-medium hover:text-accent">
          {p.title}
        </Link>
        <span className="font-mono text-xs text-muted">{p.id}</span>
      </p>
      <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted">Team</dt>
        <dd className="text-ink-2">{p.team_name}</dd>
        {p.track_name && (
          <>
            <dt className="text-muted">Track</dt>
            <dd className="text-ink-2">{p.track_name}</dd>
          </>
        )}
        <dt className="text-muted">Submitted</dt>
        <dd className="font-mono text-ink-2">{when(p.submitted_at)}</dd>
        {p.repo_url && (
          <>
            <dt className="text-muted">Repo</dt>
            <dd className="truncate font-mono text-ink-2" title={p.repo_url}>
              {p.repo_url.replace(/^https?:\/\//, "")}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
