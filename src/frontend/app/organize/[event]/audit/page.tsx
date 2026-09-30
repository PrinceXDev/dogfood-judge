import Link from "next/link";
import { ChainStatus } from "@/components/audit/chain-status";
import { AuditTimeline, chainLinks } from "@/components/audit/timeline";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { EmptyState, PageHeader, Problem } from "@/components/ui";
import { load, requireMe } from "@/lib/api";
import type { AuditLog, Event } from "@/lib/types";

const FILTERS: [string, string][] = [
  ["", "All"],
  ["event.", "Event settings"],
  ["review.", "Reviews"],
  ["assignment.", "Assignments"],
  ["project.", "Projects"],
  ["team.", "Teams"],
  ["deadline.", "Deadline extensions"],
  ["rubric.", "Rubric"],
  ["results.", "Publishing"],
  ["vote.", "Votes"],
  ["comment.", "Comments"],
  ["invitation.", "Invitations"],
  ["pairwise.", "Pairwise"],
];

export default async function Audit({
  params,
  searchParams,
}: PageProps<"/organize/[event]/audit">) {
  const { event } = await params;
  const here = `/organize/${event}/audit`;
  await requireMe(here);
  const filter = String((await searchParams).action ?? "");
  const er = await load<Event>(`/events/${event}`, here);
  if (!er.ok) return <Problem error={er.error} />;
  const ar = await load<AuditLog>(`/events/${er.data.id}/audit`, here);
  if (!ar.ok) return <Problem error={ar.error} />;
  const { verification: v, names } = ar.data;
  const all = ar.data.entries ?? [];
  const entries = all.filter((x) => !filter || x.action.startsWith(filter));
  const links = chainLinks(entries);
  const linked = links.filter((l) => l.kind === "linked").length;
  const gaps = links.filter((l) => l.kind === "gap").length;
  const broken = links.filter((l) => l.kind === "mismatch").length;
  const label = FILTERS.find(([p]) => p === filter)?.[1] ?? filter;
  const json = `/api/v1/events/${er.data.id}/audit`;

  return (
    <>
      <PageHeader
        eyebrow="Audit"
        title="Review trail"
        sub="Every setting change, assignment, review and publication for this event, in one append-only log where each entry is chained to the last by its hash."
        actions={
          <>
            <a
              href="/api/v1/audit/checkpoint"
              download="audit-checkpoint.json"
              title="The chain's latest hash, signed by this instance. Anyone who keeps a copy can later detect a rewritten history."
              className={buttonClass("secondary", "sm")}
            >
              <Icon name="shieldCheck" size={13} />
              Signed checkpoint
            </a>
            <a href={json} className={buttonClass("secondary", "sm")}>
              <Icon name="file" size={13} />
              Full log (JSON)
            </a>
          </>
        }
      />

      <ChainStatus verification={v}>
        <dl className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line text-center sm:w-auto">
          {(
            [
              ["On this page", entries.length, "text-ink"],
              ["Links checked", linked, broken ? "text-bad" : "text-good"],
              ["Gaps", gaps, "text-muted"],
            ] as const
          ).map(([k, n, cls]) => (
            <div
              key={k}
              className="flex flex-col-reverse bg-surface-2 px-4 py-2.5"
            >
              <dt className="whitespace-nowrap text-[11px] text-muted">{k}</dt>
              <dd className={`font-mono text-lg tabular ${cls}`}>{n}</dd>
            </div>
          ))}
        </dl>
      </ChainStatus>

      <nav
        aria-label="Filter by action"
        className="mt-8 flex flex-wrap gap-1.5"
      >
        {FILTERS.map(([prefix, name]) => {
          const n = prefix
            ? all.filter((x) => x.action.startsWith(prefix)).length
            : all.length;
          const on = prefix === filter;
          return (
            <Link
              key={prefix}
              href={
                prefix ? `${here}?action=${encodeURIComponent(prefix)}` : here
              }
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors ${
                on
                  ? "border-accent/40 bg-accent/10 text-ink"
                  : n
                    ? "border-line-strong bg-surface text-ink-2 hover:border-muted/50 hover:text-ink"
                    : "border-line bg-transparent text-muted hover:text-ink-2"
              }`}
            >
              {name}
              <span
                className={`font-mono text-[10.5px] tabular ${on ? "text-accent" : "text-muted"}`}
              >
                {n}
              </span>
            </Link>
          );
        })}
      </nav>

      <p className="mt-3 mb-6 text-xs text-muted">
        Showing {entries.length} of the latest{" "}
        <span className="font-mono tabular">{all.length}</span> entries for this
        event{filter && <> matching {label.toLowerCase()}</>}. The API returns
        at most 500; the{" "}
        <a href={json} className="text-accent hover:underline">
          full log
        </a>{" "}
        has the rest. Seq numbers are shared by every event on the instance, so
        gaps between them are expected.
      </p>

      {broken > 0 && (
        <p
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-md border border-bad/30 bg-bad/[0.07] px-3 py-2 text-sm"
        >
          <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-bad" />
          {broken} {broken === 1 ? "entry's" : "entries'"} prev_hash
          doesn&apos;t match the hash of the entry right before it. Look for the
          red links below.
        </p>
      )}

      {entries.length ? (
        <AuditTimeline entries={entries} names={names} />
      ) : (
        <EmptyState
          icon="commit"
          title={
            filter
              ? `No ${label.toLowerCase()} entries yet.`
              : "Nothing recorded yet."
          }
          action={
            filter ? (
              <Link href={here} className={buttonClass("secondary", "sm")}>
                Show all entries
              </Link>
            ) : undefined
          }
        >
          {filter
            ? "Nothing with this action appears in the latest entries for this event."
            : "Changes to this event, its reviews and its results will appear here as they happen."}
        </EmptyState>
      )}
    </>
  );
}
