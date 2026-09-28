import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/button";
import { Countdown } from "@/components/countdown";
import { Icon } from "@/components/icons";
import { Bar, EmptyState, Page, PageHeader, Panel, Tag } from "@/components/ui";
import { api, requireMe } from "@/lib/api";
import { phase, submissionsOpen, when } from "@/lib/format";
import { getNav } from "@/lib/nav";
import type { Assignment, Event, Progress, Team } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const me = await requireMe("/dashboard");
  const nav = await getNav();
  const events = await Promise.all(
    nav.events
      .filter((e) => e.organizer || e.judge || e.participant)
      .map((e) => api<Event>(`/events/${e.id}`).then((ev) => ({ nav: e, ev }))),
  );
  const organized = events.filter((x) => x.nav.organizer);
  const participating = events.filter((x) => x.nav.participant);
  const [progress, assignments, teams] = await Promise.all([
    Promise.all(
      organized.map((x) =>
        api<Progress>(`/events/${x.ev.id}/progress`).catch(() => null),
      ),
    ),
    nav.judge
      ? api<Assignment[] | null>("/judge/assignments").then((a) => a ?? [])
      : Promise.resolve([] as Assignment[]),
    Promise.all(
      participating.map((x) =>
        api<Team>(`/events/${x.ev.id}/team`).catch(() => null),
      ),
    ),
  ]);
  const pending = assignments.filter((a) => a.status === "pending").length;
  const done = assignments.filter((a) => a.status === "done").length;
  const firstName = me.user.name.split(" ")[0];
  const nothing = !organized.length && !participating.length && !nav.judge;

  return (
    <Page>
      <PageHeader
        eyebrow="Dashboard"
        title={
          <>
            Welcome back,{" "}
            <span className="font-serif font-normal italic text-accent">
              {firstName}
            </span>
          </>
        }
        sub={`${me.user.email}${me.user.is_admin ? " · instance admin" : ""}`}
        actions={
          <>
            {me.can_create_events && (
              <Link href="/organize/new" className={buttonClass("accent")}>
                <Icon name="plus" size={14} /> New event
              </Link>
            )}
            <Link href="/certificates" className={buttonClass("secondary")}>
              <Icon name="file" size={14} /> Certificates
            </Link>
          </>
        }
      />

      {nothing && (
        <EmptyState
          title="You're not part of an event yet."
          icon="layers"
          action={
            <Link href="/events" className={buttonClass("accent")}>
              Browse events
            </Link>
          }
        >
          Join a team from an event page, or open the invite link an organizer
          or teammate sent you.
        </EmptyState>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {organized.length > 0 && (
          <Panel
            title="Events you organize"
            icon="activity"
            className="lg:col-span-2"
            bodyClass="p-0"
          >
            <ul>
              {organized.map(({ ev }, i) => {
                const p = progress[i];
                return (
                  <li
                    key={ev.id}
                    className="border-b border-line last:border-0"
                  >
                    <Link
                      href={`/organize/${ev.slug}`}
                      data-nav-item
                      className="group grid items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-hover/60 sm:grid-cols-[minmax(0,1fr)_220px_auto]"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{ev.name}</p>
                        <p className="text-xs text-muted">{phase(ev)}</p>
                      </div>
                      {p ? (
                        <div>
                          <div className="flex justify-between font-mono text-[11px] text-muted">
                            <span>judging</span>
                            <span className="text-ink-2">
                              {p.done}/{p.assignments} · {Math.round(p.percent)}
                              %
                            </span>
                          </div>
                          <Bar
                            value={p.percent}
                            className="mt-1.5"
                            label={`${ev.name} judging`}
                          />
                        </div>
                      ) : (
                        <span />
                      )}
                      <span className="flex items-center gap-1 text-sm text-accent">
                        Command center{" "}
                        <Icon
                          name="arrowRight"
                          size={13}
                          className="transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        {nav.judge && (
          <Panel
            title="Judging"
            icon="gavel"
            aside={
              <Link href="/judge" className="hover:text-ink">
                workspace →
              </Link>
            }
          >
            <div className="flex items-end gap-8">
              <div>
                <p className="font-mono text-4xl tabular text-accent">
                  {pending}
                </p>
                <p className="text-xs text-muted">to review</p>
              </div>
              <div>
                <p className="font-mono text-4xl tabular">{done}</p>
                <p className="text-xs text-muted">reviewed</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-ink-2">
              {pending
                ? "Your queue is ordered; the workspace opens the next one."
                : "You're all caught up."}
            </p>
            {pending > 0 && (
              <Link href="/judge" className={`${buttonClass("accent")} mt-4`}>
                Start reviewing <Icon name="arrowRight" size={14} />
              </Link>
            )}
          </Panel>
        )}

        {participating.length > 0 && (
          <Panel id="submissions" title="My submissions" icon="box">
            <ul className="grid gap-4">
              {participating.map(({ ev }, i) => {
                const t = teams[i];
                const pr = t?.project;
                const open = submissionsOpen(ev);
                return (
                  <li key={ev.id} className="rounded-md border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{ev.name}</p>
                      {pr ? (
                        pr.status === "submitted" ? (
                          <Tag tone="good" dot>
                            submitted
                          </Tag>
                        ) : (
                          <Tag tone="warn" dot>
                            draft
                          </Tag>
                        )
                      ) : (
                        <Tag>no project yet</Tag>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-2">
                      {t ? (
                        <>
                          Team <span className="text-ink">{t.name}</span>
                          {pr ? <> · {pr.title}</> : null}
                        </>
                      ) : (
                        "No team yet."
                      )}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {open ? (
                        <>
                          Deadline in{" "}
                          <Countdown
                            at={ev.submissions_close_at}
                            className="text-ink-2"
                          />
                        </>
                      ) : (
                        `Submissions closed ${when(ev.submissions_close_at)}`
                      )}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Link
                        href={`/events/${ev.slug}/team`}
                        className={buttonClass("secondary", "sm")}
                      >
                        Team & submission
                      </Link>
                      {pr && (
                        <Link
                          href={`/p/${pr.id}`}
                          className={buttonClass("ghost", "sm")}
                        >
                          View project
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
    </Page>
  );
}
