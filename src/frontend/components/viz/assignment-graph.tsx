"use client";

import { useMemo, useState } from "react";
import { Tag } from "@/components/ui";
import type { EventAssignment } from "@/lib/types";

// The review graph: judges on the left, projects on the right, one line per
// assignment. Scores can only be put on one scale within a connected group
// (JUDGING.md, identifiability), so groups get distinct colours, projects
// nobody reviews are marked, and bridge edges (whose loss would split a
// group) are drawn heavier. Clicking an edge simulates that recusal: the
// groups are recomputed here with union-find, no server call.

type Edge = EventAssignment & { key: string };

const ROW = 18;
const PALETTE = [
  "var(--accent)",
  "var(--info)",
  "var(--warn)",
  "var(--bad)",
  "var(--good)",
  "var(--ink-2)",
];

function components(nodes: string[], edges: [string, string][]) {
  const parent = new Map(nodes.map((n) => [n, n]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(x, r);
    return r;
  };
  for (const [a, b] of edges) parent.set(find(a), find(b));
  const id = new Map<string, number>();
  const of = new Map<string, number>();
  for (const n of nodes) {
    const r = find(n);
    if (!id.has(r)) id.set(r, id.size);
    of.set(n, id.get(r) as number);
  }
  return { of, count: id.size };
}

// Tarjan's bridge finding on the undirected judge-project multigraph.
function bridges(nodes: string[], edges: [string, string][]) {
  const adj = new Map<string, [string, number][]>(nodes.map((n) => [n, []]));
  edges.forEach(([a, b], i) => {
    adj.get(a)?.push([b, i]);
    adj.get(b)?.push([a, i]);
  });
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const out = new Set<number>();
  let t = 0;
  const visit = (u: string, via: number) => {
    disc.set(u, t);
    low.set(u, t);
    t++;
    for (const [v, i] of adj.get(u) ?? []) {
      if (i === via) continue;
      if (!disc.has(v)) {
        visit(v, i);
        low.set(u, Math.min(low.get(u) as number, low.get(v) as number));
        if ((low.get(v) as number) > (disc.get(u) as number)) out.add(i);
      } else {
        low.set(u, Math.min(low.get(u) as number, disc.get(v) as number));
      }
    }
  };
  for (const n of nodes) if (!disc.has(n)) visit(n, -1);
  return out;
}

export function AssignmentGraph({
  assignments,
  projects,
  assignHref,
}: {
  assignments: EventAssignment[];
  projects: { id: string; title: string }[];
  assignHref: string;
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const edges: Edge[] = useMemo(
    () => assignments.map((a) => ({ ...a, key: `${a.judge}|${a.project}` })),
    [assignments],
  );
  const judges = useMemo(
    () =>
      [...new Map(edges.map((e) => [e.judge, e.judge_name])).entries()].sort(
        (a, b) => a[1].localeCompare(b[1]),
      ),
    [edges],
  );
  const jRow = new Map(judges.map(([id], i) => [id, i]));
  // Order projects by the mean row of their judges, which keeps lines short.
  const pOrder = useMemo(() => {
    const bary = new Map<string, number[]>();
    for (const e of edges)
      bary.set(e.project, [
        ...(bary.get(e.project) ?? []),
        jRow.get(e.judge) ?? 0,
      ]);
    const mean = (xs: number[] | undefined) =>
      xs?.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1e9;
    return [...projects].sort(
      (a, b) =>
        mean(bary.get(a.id)) - mean(bary.get(b.id)) ||
        a.title.localeCompare(b.title),
    );
  }, [edges, projects, jRow]);
  const pRow = new Map(pOrder.map((p, i) => [p.id, i]));

  const live = edges.filter((e) => e.status !== "recused");
  const kept = live.filter((e) => !removed.has(e.key));
  const nodes = [
    ...judges.map(([id]) => `j:${id}`),
    ...projects.map((p) => `p:${p.id}`),
  ];
  const pairs = (es: Edge[]) =>
    es.map((e) => [`j:${e.judge}`, `p:${e.project}`] as [string, string]);
  const now = components(nodes, pairs(kept));
  const before = components(nodes, pairs(live));
  const bridgeIdx = bridges(nodes, pairs(kept));
  const bridgeKeys = new Set([...bridgeIdx].map((i) => kept[i].key));
  const degree = new Map<string, number>();
  for (const e of kept) degree.set(e.project, (degree.get(e.project) ?? 0) + 1);
  const isolated = projects.filter((p) => !degree.get(p.id));
  // Count groups by the projects in them: a project with no reviewer is a
  // group of its own, since nothing ties its scores to anyone else's.
  const projectGroups = (c: ReturnType<typeof components>) =>
    new Set(projects.map((p) => c.of.get(`p:${p.id}`))).size;
  const groups = projectGroups(now);
  const groupsBefore = projectGroups(before);
  const colour = (node: string) =>
    PALETTE[(now.of.get(node) ?? 0) % PALETTE.length];

  const h = Math.max(judges.length, pOrder.length, 1) * ROW + ROW;
  const W = 1000;
  const xJ = 190;
  const xP = W - 250;
  const yJ = (i: number) =>
    ROW + i * ((h - 2 * ROW) / Math.max(1, judges.length - 1 || 1));
  const yP = (i: number) =>
    ROW + i * ((h - 2 * ROW) / Math.max(1, pOrder.length - 1 || 1));
  const toggle = (k: string) =>
    setRemoved((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (!edges.length) return null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Tag tone={groups > 1 ? "bad" : "good"} dot>
          {groups} connected group{groups === 1 ? "" : "s"}
        </Tag>
        {isolated.length > 0 && (
          <Tag tone="warn">
            {isolated.length} project{isolated.length === 1 ? "" : "s"} with no
            reviewer
          </Tag>
        )}
        <Tag>{bridgeKeys.size} bridge edges</Tag>
        {removed.size > 0 && (
          <>
            <span className="text-ink-2">
              What-if: {removed.size} recusal{removed.size === 1 ? "" : "s"}{" "}
              {groups > groupsBefore
                ? `splits the projects into ${groups} groups (from ${groupsBefore}).`
                : "keeps every group connected."}
            </span>
            <button
              type="button"
              onClick={() => setRemoved(new Set())}
              className="text-xs text-accent hover:underline"
            >
              reset
            </button>
          </>
        )}
      </div>
      <div className="max-h-[560px] overflow-auto rounded-lg border border-line bg-surface">
        <svg
          viewBox={`0 0 ${W} ${h}`}
          className="w-full min-w-[640px]"
          style={{ height: h * 0.72 }}
          role="img"
          aria-label={`Assignment graph: ${judges.length} judges, ${projects.length} projects, ${groups} connected groups`}
        >
          {edges.map((e) => {
            const y1 = yJ(jRow.get(e.judge) ?? 0);
            const y2 = yP(pRow.get(e.project) ?? 0);
            const gone = removed.has(e.key);
            const recused = e.status === "recused";
            const lit = hover === e.judge || hover === e.project;
            const stroke = recused
              ? "var(--bad)"
              : gone
                ? "var(--muted)"
                : e.status === "done"
                  ? colour(`p:${e.project}`)
                  : "var(--line-strong)";
            const label = `${e.judge_name} → ${e.project_title}: ${e.status}${e.reason ? ` (${e.reason})` : ""}${e.recuse_reason ? `, recused: ${e.recuse_reason}` : ""}${bridgeKeys.has(e.key) ? ". Bridge: removing it splits a group" : ""}`;
            const d = `M${xJ},${y1} C${(xJ + xP) / 2},${y1} ${(xJ + xP) / 2},${y2} ${xP},${y2}`;
            const common = {
              d,
              fill: "none",
              stroke,
              strokeWidth: bridgeKeys.has(e.key) ? 2.6 : lit ? 1.8 : 1,
              strokeDasharray: recused || gone ? "4 4" : undefined,
              opacity: hover && !lit ? 0.15 : recused ? 0.5 : 0.85,
            };
            return recused ? (
              <path key={e.key} {...common}>
                <title>{label}</title>
              </path>
            ) : (
              // biome-ignore lint/a11y/useSemanticElements: a <button> can't live inside <svg>; this path is keyboard-operable
              <path
                key={e.key}
                {...common}
                role="button"
                tabIndex={0}
                aria-pressed={gone}
                aria-label={`${label}. Toggle a simulated recusal.`}
                className="cursor-pointer outline-none focus-visible:stroke-[var(--ink)]"
                onClick={() => toggle(e.key)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    toggle(e.key);
                  }
                }}
              >
                <title>{`${label}. Click to simulate a recusal.`}</title>
              </path>
            );
          })}
          {judges.map(([id, label], i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover only highlights; every edge's <title> carries the same information
            <g
              key={id}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover(null)}
            >
              <circle cx={xJ} cy={yJ(i)} r={4} fill={colour(`j:${id}`)} />
              <text
                x={xJ - 10}
                y={yJ(i) + 4}
                textAnchor="end"
                fontSize={12}
                fill="var(--ink-2)"
              >
                {label.length > 24 ? `${label.slice(0, 23)}…` : label}
              </text>
            </g>
          ))}
          {pOrder.map((p, i) => {
            const alone = !degree.get(p.id);
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover only highlights; every edge's <title> carries the same information
              <g
                key={p.id}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle
                  cx={xP}
                  cy={yP(i)}
                  r={4}
                  fill={alone ? "var(--bg)" : colour(`p:${p.id}`)}
                  stroke={alone ? "var(--warn)" : "none"}
                  strokeWidth={2}
                />
                <text
                  x={xP + 10}
                  y={yP(i) + 4}
                  fontSize={12}
                  fill={alone ? "var(--warn)" : "var(--ink-2)"}
                >
                  {p.title.length > 30 ? `${p.title.slice(0, 29)}…` : p.title}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Solid lines are finished reviews, grey lines pending, red dashes
        recusals; heavy lines are bridges. Scores in different groups can't be
        put on one scale by any method, so a split graph ranks each group only
        against itself.{" "}
        <a href={assignHref} className="text-accent hover:underline">
          The assignment engine
        </a>{" "}
        adds bridging reviews when it runs.
      </p>
    </div>
  );
}
