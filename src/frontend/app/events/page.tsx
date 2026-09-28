import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/button";
import { EventCard } from "@/components/events/event-card";
import { Icon } from "@/components/icons";
import { EmptyState, Page, PageHeader } from "@/components/ui";
import { api, getMe, rolesIn } from "@/lib/api";
import { phase } from "@/lib/format";
import type { Event, GalleryPage, Progress } from "@/lib/types";

export const metadata: Metadata = { title: "Events" };

const FILTERS: [string, string][] = [
  ["", "All"],
  ["live", "Live"],
  ["upcoming", "Upcoming"],
  ["published", "Results published"],
];

function matches(e: Event, f: string) {
  const ph = phase(e);
  if (f === "live") return !["results published", "upcoming"].includes(ph);
  if (f === "upcoming") return ph === "upcoming";
  if (f === "published") return ph === "results published";
  return true;
}

export default async function Events({ searchParams }: PageProps<"/events">) {
  const status = String((await searchParams).status ?? "");
  const [events, me] = await Promise.all([
    api<Event[] | null>("/events"),
    getMe(),
  ]);
  const all = events ?? [];
  const shown = all.filter((e) => matches(e, status));
  const cards = await Promise.all(
    shown.map(async (e) => {
      const roles = rolesIn(me, e.id);
      // The list endpoint omits tracks and criteria; the detail has them.
      const [detail, page, progress] = await Promise.all([
        api<Event>(`/events/${e.id}`).catch(() => e),
        api<GalleryPage>(`/events/${e.id}/projects`).catch(() => null),
        roles.organizer
          ? api<Progress>(`/events/${e.id}/progress`).catch(() => null)
          : Promise.resolve(null),
      ]);
      return { e: detail, roles, projects: page?.total ?? null, progress };
    }),
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Explorer"
        title="Events"
        sub="Every public event on this instance, plus the private ones you belong to. Stage bars follow each event's schedule; judging completion is shown to organizers."
        actions={
          me?.can_create_events && (
            <Link href="/organize/new" className={buttonClass("accent")}>
              <Icon name="plus" size={14} /> New event
            </Link>
          )
        }
      />
      <nav aria-label="Filter events" className="mb-6 flex flex-wrap gap-1.5">
        {FILTERS.map(([v, label]) => {
          const n = all.filter((e) => matches(e, v)).length;
          const on = status === v;
          return (
            <Link
              key={v}
              href={v ? `/events?status=${v}` : "/events"}
              aria-current={on ? "page" : undefined}
              className={`flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors ${on ? "border-accent/40 bg-accent/10 text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}
            >
              {label}
              <span className="font-mono text-[11px] text-muted">{n}</span>
            </Link>
          );
        })}
      </nav>
      {cards.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <EventCard key={c.e.id} {...c} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={all.length ? "No events match this filter." : "No events yet."}
          icon="layers"
          action={
            me?.can_create_events && !all.length ? (
              <Link href="/organize/new" className={buttonClass("accent")}>
                Create the first event
              </Link>
            ) : undefined
          }
        >
          {all.length
            ? "Try another filter."
            : "When an organizer creates a public event, it appears here."}
        </EmptyState>
      )}
    </Page>
  );
}
