import Link from "next/link";
import { Countdown } from "@/components/countdown";
import { Icon } from "@/components/icons";
import { StatusDot, Tag } from "@/components/ui";
import { phase } from "@/lib/format";
import { nextDeadline, type Stage, timeline } from "@/lib/timeline";
import type { Event, Progress } from "@/lib/types";

// An event in the explorer: its schedule as four stage bars (time elapsed in
// each window), real counts, the next deadline, and, for organizers only,
// how far judging actually is (from /progress).

const stateStyle: Record<Stage["state"], string> = {
  done: "bg-accent/70",
  live: "bg-accent",
  upcoming: "bg-line",
  off: "bg-line/50",
};

export function StageBars({ stages }: { stages: Stage[] }) {
  return (
    <ol className="grid grid-cols-4 gap-2">
      {stages.map((s) => (
        <li key={s.key} className="min-w-0">
          <div className="flex items-center justify-between gap-1 font-mono text-[10px] uppercase tracking-[0.12em]">
            <span
              className={
                s.state === "live"
                  ? "text-accent"
                  : s.state === "off"
                    ? "text-muted/50"
                    : "text-muted"
              }
            >
              {s.label}
            </span>
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: a themed meter; the native element's styling differs per browser */}
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
            role="meter"
            aria-label={`${s.label}: ${s.state}`}
            aria-valuenow={Math.round(s.pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full ${stateStyle[s.state]} ${s.state === "live" ? "shadow-[0_0_8px_var(--glow)]" : ""}`}
              style={{
                width: `${s.state === "off" ? 0 : Math.max(s.state === "live" ? 4 : 0, s.pct)}%`,
              }}
            />
          </div>
          <p className="mt-1 truncate text-[10.5px] text-muted">
            {s.state === "off"
              ? "not scheduled"
              : s.key === "results"
                ? s.state === "done"
                  ? "published"
                  : "sealed"
                : s.state}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function EventCard({
  e,
  projects,
  progress,
  roles,
}: {
  e: Event;
  projects: number | null;
  progress: Progress | null;
  roles: { organizer: boolean; judge: boolean; participant: boolean };
}) {
  const ph = phase(e);
  const live = !["results published", "upcoming", "awaiting results"].includes(
    ph,
  );
  const next = nextDeadline(e);
  return (
    <article className="glow-edge group relative flex flex-col rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow)] transition-[transform,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            <Link
              href={`/events/${e.slug}`}
              data-nav-item
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
            >
              {e.name}
            </Link>
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{e.slug}</p>
        </div>
        <Tag
          tone={
            live ? "accent" : ph === "results published" ? "good" : "neutral"
          }
        >
          {live && <StatusDot tone="accent" pulse />}
          {ph}
        </Tag>
      </div>

      {e.description && (
        <p className="mt-3 line-clamp-2 text-sm text-ink-2">{e.description}</p>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-3 border-y border-line py-4">
        {(
          [
            ["Projects", projects ?? "·"],
            ["Tracks", e.tracks?.length ?? 0],
            ["Criteria", e.criteria?.length ?? 0],
          ] as [string, number | string][]
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] text-muted">{k}</dt>
            <dd className="mt-0.5 font-mono text-xl tabular">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        <StageBars stages={timeline(e)} />
      </div>

      {progress && (
        <div className="relative z-10 mt-4 rounded-md border border-line bg-surface-2/60 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-2">Judging completion</span>
            <span className="font-mono text-accent">
              {progress.done}/{progress.assignments} ·{" "}
              {Math.round(progress.percent)}%
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {roles.organizer && <Tag tone="accent">organizer</Tag>}
          {roles.judge && <Tag tone="info">judge</Tag>}
          {roles.participant && <Tag tone="good">participant</Tag>}
          {next && (
            <span className="text-muted">
              {next.label} in <Countdown at={next.at} className="text-ink-2" />
            </span>
          )}
        </div>
        <span className="flex items-center gap-1 font-medium text-accent opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-within:opacity-100">
          Enter event <Icon name="arrowRight" size={13} />
        </span>
      </div>
    </article>
  );
}
