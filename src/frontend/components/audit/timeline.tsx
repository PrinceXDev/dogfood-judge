import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { AuditEntry } from "@/lib/types";

// The audit log as a hash-chained timeline, newest first. The chain is global
// (one sequence across every event), so a link can only be checked between two
// entries whose seq numbers are consecutive; anything else is shown as a gap.

type Link =
  | { kind: "linked"; to: number }
  | { kind: "mismatch"; to: number }
  | { kind: "gap"; hidden: number; to: number }
  | { kind: "genesis" }
  | { kind: "edge"; to: number };

const GENESIS = /^0+$/;

export function chainLinks(entries: AuditEntry[]): Link[] {
  return entries.map((x, i) => {
    const older = entries[i + 1];
    if (!older) {
      return GENESIS.test(x.prev_hash)
        ? { kind: "genesis" }
        : { kind: "edge", to: x.seq - 1 };
    }
    if (older.seq !== x.seq - 1) {
      return { kind: "gap", hidden: x.seq - older.seq - 1, to: older.seq };
    }
    return x.prev_hash === older.hash
      ? { kind: "linked", to: older.seq }
      : { kind: "mismatch", to: older.seq };
  });
}

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function tone(action: string): string {
  if (action.startsWith("results."))
    return "text-accent border-accent/30 bg-accent/10";
  if (/^(review|assignment|pairwise)\./.test(action))
    return "text-info border-info/30 bg-info/10";
  if (/^(vote|comment)\./.test(action))
    return "text-accent-2 border-accent-2/30 bg-accent-2/10";
  if (/^deadline\.|disqualif|duplicate/.test(action))
    return "text-warn border-warn/30 bg-warn/10";
  return "text-ink-2 border-line-strong bg-surface-2";
}

function ActionToken({ action }: { action: string }) {
  const dot = action.indexOf(".");
  const head = dot < 0 ? action : action.slice(0, dot);
  const rest = dot < 0 ? "" : action.slice(dot + 1);
  return (
    <span
      className={`inline-flex h-[22px] items-center rounded border px-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] ${tone(action)}`}
    >
      {head}
      {rest && (
        <>
          <span className="opacity-50">.</span>
          <span className="text-ink">{rest}</span>
        </>
      )}
    </span>
  );
}

function preview(detail: AuditEntry["detail"]): string {
  if (!detail) return "";
  return Object.entries(detail)
    .slice(0, 4)
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${s.length > 28 ? `${s.slice(0, 27)}…` : s}`;
    })
    .join("  ");
}

const short = (h: string) => h.slice(0, 8);

export function AuditTimeline({
  entries,
  names,
}: {
  entries: AuditEntry[];
  names: Record<string, string>;
}) {
  const links = chainLinks(entries);
  const days: { day: string; items: number[] }[] = [];
  entries.forEach((x, i) => {
    const d = x.at.slice(0, 10);
    const last = days.at(-1);
    if (last?.day === d) last.items.push(i);
    else days.push({ day: d, items: [i] });
  });

  return (
    <div className="grid gap-8">
      {days.map(({ day, items }) => (
        <section
          key={day}
          aria-label={dayFmt.format(new Date(`${day}T00:00:00Z`))}
        >
          <div className="mb-3 flex items-center gap-3">
            <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-2">
              {dayFmt.format(new Date(`${day}T00:00:00Z`))}
            </h3>
            <span className="hairline flex-1" />
            <span className="font-mono text-[11px] text-muted tabular">
              {items.length} {items.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <ol className="grid">
            {items.map((i) => (
              <Row
                key={entries[i].seq}
                x={entries[i]}
                link={links[i]}
                first={i === 0}
                actor={
                  names[entries[i].actor_id] ??
                  (entries[i].actor_id || "system")
                }
                named={!!names[entries[i].actor_id] || !entries[i].actor_id}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Row({
  x,
  link,
  first,
  actor,
  named,
}: {
  x: AuditEntry;
  link: Link;
  first: boolean;
  actor: string;
  named: boolean;
}) {
  const detail = preview(x.detail);
  return (
    <>
      <li className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <div className="relative">
          <span
            aria-hidden="true"
            className={`absolute bottom-0 left-[5px] w-px bg-line-strong ${first ? "top-4" : "top-0"}`}
          />
          <div className="relative flex items-center gap-2 pt-3">
            <span
              aria-hidden="true"
              className="size-[11px] shrink-0 rounded-full border-2 border-accent bg-bg shadow-[0_0_10px_-2px_var(--glow)]"
            />
            <span title={x.hash} className="font-mono text-[10.5px] text-ink-2">
              {short(x.hash)}
            </span>
          </div>
        </div>
        <article
          data-nav-item
          tabIndex={-1}
          className="group min-w-0 rounded-lg border border-line bg-surface transition-colors hover:border-line-strong focus-visible:border-accent/50"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 pt-3 pb-2">
            <time
              dateTime={x.at}
              className="font-mono text-xs text-muted tabular"
              title={x.at}
            >
              {x.at.slice(11, 19)} <span className="text-[10px]">UTC</span>
            </time>
            <ActionToken action={x.action} />
            <span className="text-sm">
              <span className="text-muted">by </span>
              <span
                className={named ? "text-ink" : "font-mono text-xs text-ink-2"}
              >
                {actor}
              </span>
            </span>
            {x.target && (
              <span className="text-sm">
                <span className="text-muted">on </span>
                <span className="font-mono text-xs text-ink-2">{x.target}</span>
              </span>
            )}
            <span className="ml-auto font-mono text-[11px] text-muted tabular">
              #{x.seq}
            </span>
          </div>
          <details className="group/d border-t border-line/70">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-xs text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
              <Icon
                name="chevronRight"
                size={12}
                className="shrink-0 transition-transform duration-200 group-open/d:rotate-90"
              />
              <span className="shrink-0 font-medium">Details</span>
              {detail && (
                <span className="min-w-0 truncate font-mono text-[11px] text-muted/80">
                  {detail}
                </span>
              )}
            </summary>
            <div className="grid gap-3 border-t border-line/70 bg-sunken/60 px-3.5 py-3">
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 font-mono text-[11px]">
                <dt className="text-muted">seq</dt>
                <dd className="text-ink tabular">{x.seq}</dd>
                <dt className="text-muted">prev_hash</dt>
                <dd className="break-all text-ink-2">{x.prev_hash}</dd>
                <dt className="text-muted">hash</dt>
                <dd className="break-all text-ink">{x.hash}</dd>
              </dl>
              <pre className="overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
                {JSON.stringify(x.detail ?? {}, null, 2)}
              </pre>
            </div>
          </details>
        </article>
      </li>
      <Connector link={link} prev={x.prev_hash} seq={x.seq} />
    </>
  );
}

function Connector({
  link,
  prev,
  seq,
}: {
  link: Link;
  prev: string;
  seq: number;
}) {
  const line = {
    linked: "bg-accent/60",
    mismatch: "bg-bad",
    gap: "border-l border-dashed border-line-strong bg-transparent",
    genesis: "bg-accent/60",
    edge: "border-l border-dashed border-line-strong bg-transparent",
  }[link.kind];
  let status: ReactNode;
  switch (link.kind) {
    case "linked":
      status = (
        <span className="inline-flex items-center gap-1 text-good">
          <Icon name="check" size={12} />= hash of #{link.to}
        </span>
      );
      break;
    case "mismatch":
      status = (
        <span className="inline-flex items-center gap-1 text-bad">
          <Icon name="x" size={12} />≠ hash of #{link.to}: link broken
        </span>
      );
      break;
    case "gap":
      status = (
        <span className="text-muted">
          {link.hidden} {link.hidden === 1 ? "entry" : "entries"} between #{seq}{" "}
          and #{link.to} not shown (other events or filtered), so this link
          can&apos;t be checked here
        </span>
      );
      break;
    case "genesis":
      status = (
        <span className="text-accent">
          genesis: the first entry on the instance
        </span>
      );
      break;
    case "edge":
      status = (
        <span className="text-muted">#{link.to} is outside this view</span>
      );
      break;
  }
  return (
    <li
      className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
      aria-label={`Chain link from entry ${seq}`}
    >
      <div className="relative min-h-8">
        <span
          aria-hidden="true"
          className={`absolute left-[5px] w-px ${line} ${link.kind === "genesis" ? "top-0 h-3" : "inset-y-0"}`}
        />
        {link.kind === "genesis" && (
          <span
            aria-hidden="true"
            className="absolute top-3 left-[2px] size-[7px] rounded-[2px] bg-accent/60"
          />
        )}
      </div>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 font-mono text-[10.5px] leading-snug">
        <span className="text-muted">prev_hash</span>
        <span title={prev} className="text-ink-2">
          {GENESIS.test(prev) ? "000…000" : short(prev)}
        </span>
        {status}
      </p>
    </li>
  );
}
