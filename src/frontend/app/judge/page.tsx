import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import {
  Bar,
  EmptyState,
  Kbd,
  Metric,
  num,
  Page,
  PageHeader,
  StatusDot,
  Table,
  Tag,
} from "@/components/ui";
import { api, requireMe } from "@/lib/api";
import { ago, f2, judgingOpen, percent, when } from "@/lib/format";
import type { Assignment, Event } from "@/lib/types";

export const metadata: Metadata = { title: "Judging" };

export default async function JudgeHome() {
  await requireMe("/judge");
  const all = (await api<Assignment[] | null>("/judge/assignments")) ?? [];
  const groups = new Map<string, Assignment[]>();
  for (const a of all)
    groups.set(a.event_id, [...(groups.get(a.event_id) ?? []), a]);
  const events = await Promise.all(
    [...groups.keys()].map((id) => api<Event>(`/events/${id}`)),
  );

  const pendingAll = all.filter((a) => a.status === "pending").length;
  const doneAll = all.filter((a) => a.status === "done").length;
  const assignedAll = all.filter((a) => a.status !== "recused").length;

  return (
    <Page>
      <PageHeader
        eyebrow="Judging"
        title={
          <>
            Your evaluation <span className="font-serif italic">queue</span>
          </>
        }
        sub="You only ever see your own scores. Other judges' scores are unavailable to you, in these pages and in the API."
      >
        {!!pendingAll && (
          <p className="mt-4 hidden items-center gap-2 text-xs text-muted sm:flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> move through the queue
            <span className="text-line-strong">·</span>
            <Kbd>↵</Kbd> open
          </p>
        )}
      </PageHeader>

      {!all.length ? (
        <EmptyState icon="gavel" title="No assignments yet.">
          An organizer invites judges and runs the assignment engine. Projects
          assigned to you will appear here, with the reason you were picked.
        </EmptyState>
      ) : (
        <>
          <div className="mb-10 grid grid-cols-3 gap-3">
            <Metric
              label="To review"
              value={pendingAll}
              tone={pendingAll ? "accent" : "good"}
              icon="clock"
            />
            <Metric
              label="Reviewed"
              value={doneAll}
              sub={`of ${assignedAll} assigned`}
              icon="check"
            />
            <Metric
              label={events.length === 1 ? "Event" : "Events"}
              value={events.length}
              icon="layers"
            />
          </div>
          <div className="grid gap-10">
            {events.map((e) => (
              <EventQueue key={e.id} e={e} list={groups.get(e.id) ?? []} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

function EventQueue({ e, list }: { e: Event; list: Assignment[] }) {
  const pending = list.filter((a) => a.status === "pending");
  const done = list.filter((a) => a.status === "done");
  const recused = list.filter((a) => a.status === "recused");
  const assigned = pending.length + done.length;
  const open = judgingOpen(e);
  const deadline = e.judging_close_at;

  return (
    <section
      aria-labelledby={`ev-${e.id}`}
      className="animate-rise overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow)]"
    >
      <header className="bg-grid relative border-b border-line px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {open ? (
                <Tag tone="accent" dot>
                  judging open
                </Tag>
              ) : (
                <Tag tone="warn" dot>
                  judging closed
                </Tag>
              )}
              {e.results_published_at && (
                <Tag tone="good" dot>
                  results published
                </Tag>
              )}
            </div>
            <h2
              id={`ev-${e.id}`}
              className="text-xl font-semibold tracking-[-0.025em]"
            >
              {e.name}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted">
              <Icon name="clock" size={12} />
              {deadline
                ? `${open ? "closes" : "closed"} ${when(deadline)}`
                : open
                  ? "no judging deadline set"
                  : "judging closed"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {e.results_published_at && (
              <Link
                href={`/judge/${e.slug}/record`}
                className={buttonClass("secondary", "sm")}
              >
                <Icon name="shieldCheck" size={13} />
                Your signed record
              </Link>
            )}
            {open && (
              <Link
                href={`/judge/${e.slug}/pairwise`}
                className={buttonClass("secondary", "sm")}
              >
                <Icon name="split" size={13} />
                Pairwise mode
              </Link>
            )}
            {open && pending[0] && (
              <Link
                href={`/judge/${e.slug}/p/${pending[0].project.id}`}
                className={buttonClass("accent", "sm")}
              >
                Start next review
                <Icon name="arrowRight" size={13} />
              </Link>
            )}
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Bar
            value={percent(done.length, assigned)}
            className="flex-1"
            tone={done.length === assigned && assigned ? "good" : "accent"}
            label={`${done.length} of ${assigned} reviews done`}
          />
          <span className="whitespace-nowrap font-mono text-xs text-ink-2 tabular">
            {done.length}
            <span className="text-muted"> / {assigned} done</span>
          </span>
        </div>
      </header>

      <div className="px-5 py-5">
        <h3 className="mb-3 flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">
          To review
          <span className="text-ink-2 tabular">{pending.length}</span>
        </h3>
        {pending.length ? (
          <ol className="grid gap-1.5">
            {pending.map((a, i) => (
              <li key={a.project.id}>
                <Link
                  data-nav-item
                  href={`/judge/${e.slug}/p/${a.project.id}`}
                  className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 rounded-md border border-line bg-surface-2/50 px-3 py-3 transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-hover focus-visible:border-accent/60 focus-visible:bg-surface-hover"
                >
                  <span className="font-mono text-xs text-muted tabular">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">
                        {a.project.title}
                      </span>
                      {a.project.track_name && (
                        <Tag>{a.project.track_name}</Tag>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {a.project.team_name}
                      {a.reason && (
                        <>
                          <span className="mx-1.5 text-line-strong">·</span>
                          <span className="text-ink-2">Why you:</span>{" "}
                          {a.reason}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted transition-colors group-hover:text-ink group-focus-visible:text-accent">
                    <span className="hidden sm:inline">
                      {open ? "Review" : "View"}
                    </span>
                    <Icon
                      name="arrowRight"
                      size={14}
                      className="transition-transform duration-150 group-hover:translate-x-0.5"
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-line-strong px-4 py-4 text-sm">
            <span className="grid size-7 place-items-center rounded-full border border-good/30 bg-good/10 text-good">
              <Icon name="check" size={14} />
            </span>
            <span>
              <span className="font-medium text-ink">
                You're all caught up.
              </span>{" "}
              <span className="text-muted">
                {open
                  ? "Nothing left in this queue. You can still refine a review below."
                  : "Nothing was left pending when judging closed."}
              </span>
            </span>
          </div>
        )}

        {!!done.length && (
          <div className="mt-7">
            <h3 className="mb-3 flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">
              Completed
              <span className="text-ink-2 tabular">{done.length}</span>
            </h3>
            <Table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="hidden sm:table-cell">Track</th>
                  <th className={num}>Your weighted score</th>
                  <th className="hidden sm:table-cell">Updated</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {done.map((a) => (
                  <tr key={a.project.id}>
                    <td>
                      <span className="flex items-center gap-2">
                        <StatusDot tone="good" label="reviewed" />
                        <span className="font-medium">{a.project.title}</span>
                      </span>
                    </td>
                    <td className="hidden text-ink-2 sm:table-cell">
                      {a.project.track_name}
                    </td>
                    <td className={`${num} text-ink`}>
                      {a.review ? f2(a.review.composite) : "·"}
                    </td>
                    <td className="hidden font-mono text-xs text-muted sm:table-cell">
                      {a.review ? ago(a.review.updated_at) : ""}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/judge/${e.slug}/p/${a.project.id}`}
                        className="text-[13px] text-accent hover:underline"
                      >
                        {open ? "Edit" : "View"}
                        <span className="sr-only"> {a.project.title}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {!!recused.length && (
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">
              Declined for conflict of interest ({recused.length})
            </summary>
            <ul className="mt-2 grid gap-1 pl-4 text-ink-2">
              {recused.map((a) => (
                <li key={a.project.id} className="flex items-center gap-2">
                  <StatusDot tone="neutral" label="declined" />
                  {a.project.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
