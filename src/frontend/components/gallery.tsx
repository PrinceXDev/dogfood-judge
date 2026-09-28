import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { ProjectIdentity } from "@/components/project/identity";
import { SearchHotkey } from "@/components/project/search-hotkey";
import { EmptyState, Kbd, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import type { Event, GalleryPage, Project, Track } from "@/lib/types";

/** Wraps case-insensitive matches of `q` in <mark>, for search results. */
function highlight(text: string, q?: string): ReactNode {
  const needle = q?.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const out: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(n); i !== -1; i = lower.indexOf(n, at)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(
      <mark key={i} className="rounded-[3px] bg-accent/20 px-0.5 text-ink">
        {text.slice(i, i + n.length)}
      </mark>,
    );
    at = i + n.length;
  }
  if (!out.length) return text;
  out.push(text.slice(at));
  return out;
}

export function ProjectCard({ p, q }: { p: Project; q?: string }) {
  const flagged = Boolean(p.duplicate_of || p.disqualified_reason);
  return (
    <Link
      href={`/p/${p.id}`}
      data-nav-item
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow)] transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_0_0_1px_var(--accent-soft),0_24px_48px_-28px_var(--glow)] focus-visible:-translate-y-0.5"
    >
      <ProjectIdentity
        id={p.id}
        title={p.title}
        className="h-28 border-b border-line transition-opacity duration-200 group-hover:opacity-100 sm:opacity-90"
      />
      <article className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[15px] font-semibold tracking-[-0.015em] text-ink">
            {highlight(p.title, q)}
          </h3>
          <Icon
            name="arrowUpRight"
            size={15}
            className="mt-0.5 shrink-0 text-muted transition-[transform,color] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent"
          />
        </div>
        <p className="mt-1 truncate text-[13px] text-ink-2">
          {highlight(p.team_name, q)}
        </p>
        {p.summary && (
          <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
            {highlight(p.summary, q)}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
          {p.track_name && <Tag>{p.track_name}</Tag>}
          {p.status === "draft" && <Tag tone="warn">draft</Tag>}
          {p.duplicate_of && <Tag tone="bad">duplicate</Tag>}
          {p.disqualified_reason && <Tag tone="bad">disqualified</Tag>}
          <span
            className={`ml-auto font-mono text-[10.5px] ${flagged ? "text-bad" : "text-muted"}`}
          >
            {p.id}
          </span>
        </div>
      </article>
    </Link>
  );
}

type Search = { q?: string; track?: string; event?: string; page?: string };

const chip =
  "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] font-medium transition-colors duration-150";
const chipOn = "border-accent/40 bg-accent/10 text-accent";
const chipOff =
  "border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-hover hover:text-ink";

/** Server-rendered, so the gallery (and run.py's fixture check) works without JavaScript. */
export async function Gallery({
  event,
  search,
}: {
  event?: Event;
  search: Search;
}) {
  const q = new URLSearchParams();
  if (search.q) q.set("q", search.q);
  if (search.track) q.set("track", search.track);
  if (search.page) q.set("page", search.page);
  if (!event && search.event) q.set("event", search.event);
  const path = event ? `/events/${event.id}/projects` : "/projects";
  const [page, events, scoped] = await Promise.all([
    api<GalleryPage>(`${path}?${q}`),
    event ? Promise.resolve(null) : api<Event[] | null>("/events"),
    // On /projects, track chips appear once an event is chosen.
    !event && search.event
      ? api<Event>(`/events/${encodeURIComponent(search.event)}`).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);
  const tracks: Track[] = (event ?? scoped)?.tracks ?? [];
  const projects = page.projects ?? [];
  const pages = Math.max(1, Math.ceil(page.total / page.page_size));

  // Links keep the other filters and reset to page one unless told otherwise.
  const href = (over: Partial<Search>) => {
    const next = new URLSearchParams();
    const merged = { ...search, page: undefined, ...over };
    if (merged.q) next.set("q", merged.q);
    if (merged.track) next.set("track", merged.track);
    if (!event && merged.event) next.set("event", merged.event);
    if (merged.page && merged.page !== "1") next.set("page", merged.page);
    const s = next.toString();
    return s ? `?${s}` : "?";
  };

  const activeTrack = tracks.find((t) => t.id === search.track);
  const activeEvent = events?.find((e) => e.slug === search.event);
  const filtered = Boolean(search.q || search.track || search.event);

  return (
    <>
      <SearchHotkey target="gallery-q" />
      <form
        method="get"
        aria-label="Search projects"
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label className="group relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Search projects</span>
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3.5 text-muted transition-colors group-focus-within:text-accent"
          />
          <input
            id="gallery-q"
            name="q"
            type="search"
            defaultValue={search.q}
            placeholder="Search title, team, summary, track"
            autoComplete="off"
            className="h-11 w-full rounded-lg border border-line-strong bg-surface pr-12 pl-10 text-[15px] text-ink shadow-[var(--shadow)] transition-[border-color,box-shadow] duration-150 placeholder:text-muted/80 hover:border-muted/50 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
          />
          <span className="pointer-events-none absolute right-3 hidden sm:inline-flex">
            <Kbd>/</Kbd>
          </span>
        </label>
        {search.track && (
          <input type="hidden" name="track" value={search.track} />
        )}
        {events?.length ? (
          <label className="relative flex items-center sm:w-56">
            <span className="sr-only">Event</span>
            <select
              name="event"
              defaultValue={search.event ?? ""}
              className="h-11 w-full appearance-none rounded-lg border border-line-strong bg-surface pr-9 pl-3.5 text-sm text-ink shadow-[var(--shadow)] transition-[border-color] duration-150 hover:border-muted/50 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
            >
              <option value="">All events</option>
              {events.map((e) => (
                <option key={e.id} value={e.slug}>
                  {e.name}
                </option>
              ))}
            </select>
            <Icon
              name="chevronDown"
              size={14}
              className="pointer-events-none absolute right-3 text-muted"
            />
          </label>
        ) : null}
        <button type="submit" className={`${buttonClass("accent", "lg")} h-11`}>
          Search
        </button>
      </form>

      {tracks.length > 0 && (
        <nav
          aria-label="Filter by track"
          className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          <ul className="flex gap-2 sm:flex-wrap">
            <li>
              <Link
                href={href({ track: undefined })}
                aria-current={!search.track ? "true" : undefined}
                className={`${chip} ${!search.track ? chipOn : chipOff}`}
              >
                All tracks
              </Link>
            </li>
            {tracks.map((t) => {
              const on = t.id === search.track;
              return (
                <li key={t.id}>
                  <Link
                    href={href({ track: on ? undefined : t.id })}
                    aria-current={on ? "true" : undefined}
                    title={t.description || undefined}
                    className={`${chip} ${on ? chipOn : chipOff}`}
                  >
                    {on && <Icon name="check" size={12} />}
                    {t.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-3">
        <p className="text-sm text-ink-2" aria-live="polite">
          <span className="font-mono font-medium text-ink tabular">
            {page.total}
          </span>{" "}
          project{page.total === 1 ? "" : "s"}
          {search.q ? (
            <>
              {" "}
              matching <span className="text-ink">“{search.q}”</span>
            </>
          ) : null}
          {activeTrack ? (
            <>
              {" "}
              in <span className="text-ink">{activeTrack.name}</span>
            </>
          ) : null}
          {activeEvent ? (
            <>
              {" "}
              at <span className="text-ink">{activeEvent.name}</span>
            </>
          ) : null}
          .
        </p>
        <div className="flex items-center gap-3 font-mono text-[11px] text-muted">
          {pages > 1 && (
            <span className="tabular">
              page {page.page}/{pages}
            </span>
          )}
          {filtered && (
            <Link
              href="?"
              className="inline-flex items-center gap-1 text-ink-2 transition-colors hover:text-ink"
            >
              <Icon name="x" size={12} />
              clear filters
            </Link>
          )}
        </div>
      </div>

      {projects.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p, i) => (
            <li
              key={p.id}
              className="animate-rise"
              style={{ animationDelay: `${Math.min(i, 11) * 30}ms` }}
            >
              <ProjectCard p={p} q={search.q} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="search"
          title={filtered ? "Nothing matches that." : "No projects yet."}
          action={
            filtered ? (
              <Link href="?" className={buttonClass("secondary")}>
                Clear filters
              </Link>
            ) : undefined
          }
        >
          {filtered
            ? "Try a shorter query, another track, or all events."
            : "Submitted projects appear here as soon as teams hit submit."}
        </EmptyState>
      )}

      {pages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-8 flex flex-wrap items-center justify-center gap-1.5"
        >
          {page.page > 1 ? (
            <Link
              href={href({ page: String(page.page - 1) })}
              rel="prev"
              className={buttonClass("secondary", "sm")}
            >
              <Icon name="arrowLeft" size={13} />
              Previous
            </Link>
          ) : (
            <span
              className={`${buttonClass("secondary", "sm")} opacity-40`}
              aria-disabled="true"
            >
              <Icon name="arrowLeft" size={13} />
              Previous
            </span>
          )}
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter(
              (n) => n === 1 || n === pages || Math.abs(n - page.page) <= 1,
            )
            .map((n, i, arr) => (
              <span key={n} className="flex items-center gap-1.5">
                {i > 0 && n - arr[i - 1] > 1 && (
                  <span className="px-1 font-mono text-xs text-muted">…</span>
                )}
                <Link
                  href={href({ page: String(n) })}
                  aria-current={n === page.page ? "page" : undefined}
                  className={`grid h-7 min-w-7 place-items-center rounded-md border px-2 font-mono text-xs tabular transition-colors ${n === page.page ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"}`}
                >
                  {n}
                </Link>
              </span>
            ))}
          {page.page < pages ? (
            <Link
              href={href({ page: String(page.page + 1) })}
              rel="next"
              className={buttonClass("secondary", "sm")}
            >
              Next
              <Icon name="arrowRight" size={13} />
            </Link>
          ) : (
            <span
              className={`${buttonClass("secondary", "sm")} opacity-40`}
              aria-disabled="true"
            >
              Next
              <Icon name="arrowRight" size={13} />
            </span>
          )}
        </nav>
      )}
    </>
  );
}
