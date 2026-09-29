"use client";

import { useState } from "react";
import { f2, signedf } from "@/lib/format";
import type { CriterionCell, CriterionLeniency } from "@/lib/types";

// Leniency by judge and criterion. A cell is coloured only when its 90%
// interval clears zero (warm = kinder than co-judges on the same projects,
// cool = harsher); everything else stays grey, because a colour grid that
// tints noise invites reading patterns into it. Offsets are already shrunk
// toward zero by how much the data supports, so small samples fade out.

export function CriterionHeatmap({
  data,
  judgeLabel,
  criterionLabel,
}: {
  data: CriterionLeniency;
  judgeLabel: Record<string, string>;
  criterionLabel: Record<string, string>;
}) {
  const criteria = data.criteria ?? [];
  const cells = data.cells ?? [];
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const byJudge = new Map<string, Map<string, CriterionCell>>();
  for (const c of cells) {
    if (!byJudge.has(c.judge)) byJudge.set(c.judge, new Map());
    byJudge.get(c.judge)?.set(c.criterion, c);
  }
  const flagged = (c?: CriterionCell) =>
    c?.signal === "lenient" || c?.signal === "harsh";
  const judges = [...byJudge.keys()]
    .map((j) => {
      const row = byJudge.get(j) ?? new Map<string, CriterionCell>();
      const vals = [...row.values()];
      return {
        id: j,
        row,
        flags: vals.filter((c) => flagged(c)).length,
        peak: Math.max(0, ...vals.map((c) => Math.abs(c.shrunk))),
      };
    })
    .sort(
      (a, b) =>
        b.flags - a.flags || b.peak - a.peak || a.id.localeCompare(b.id),
    );
  const shown = onlyFlagged ? judges.filter((j) => j.flags > 0) : judges;
  const span = Math.max(
    0.25,
    ...cells.filter(flagged).map((c) => Math.abs(c.shrunk)),
  );
  const total = judges.reduce((a, j) => a + j.flags, 0);
  const cols = `minmax(0,170px) repeat(${criteria.length}, minmax(64px,1fr))`;

  if (!criteria.length || !cells.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-sm text-ink-2">
          <span className="font-medium text-ink">{total}</span> of{" "}
          {cells.length} judge × criterion offsets clear zero at 90%.
          {total === 0 &&
            " With this many reviews per judge, no single criterion separates from noise; the composite model above pools all criteria and has more power."}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Only judges with a measurable offset
        </label>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[420px] p-2 sm:p-3">
          <div
            className="grid items-end gap-1 px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted"
            style={{ gridTemplateColumns: cols }}
          >
            <span>Judge</span>
            {criteria.map((c) => (
              <span
                key={c.criterion}
                className="truncate text-center"
                title={criterionLabel[c.criterion]}
              >
                {criterionLabel[c.criterion] ?? c.criterion}
              </span>
            ))}
          </div>
          {shown.map((j) => (
            <div
              key={j.id}
              className="grid items-center gap-1 px-1 py-0.5"
              style={{ gridTemplateColumns: cols }}
            >
              <span className="truncate text-[13px] text-ink">
                {judgeLabel[j.id] ?? j.id}
              </span>
              {criteria.map((cr) => {
                const c = j.row.get(cr.criterion);
                if (!c)
                  return (
                    <span
                      key={cr.criterion}
                      className="h-8 rounded-sm border border-dashed border-line"
                    />
                  );
                const on = flagged(c);
                const tone = c.signal === "lenient" ? "bg-warn" : "bg-info";
                return (
                  <span
                    key={cr.criterion}
                    title={`${judgeLabel[j.id] ?? j.id} · ${criterionLabel[c.criterion] ?? c.criterion}: ${signedf(c.shrunk)} pts (90% ${f2(c.low)} to ${f2(c.high)}), raw ${signedf(c.raw)} from ${c.reviews} co-judged review(s), shrinkage λ ${f2(c.lambda)} · ${c.signal}`}
                    className={`relative grid h-8 place-items-center overflow-hidden rounded-sm font-mono text-[11px] tabular ${
                      on
                        ? "text-ink"
                        : c.signal === "low data"
                          ? "bg-surface-2/50 text-muted"
                          : "bg-surface-2 text-muted"
                    }`}
                  >
                    {on && (
                      <span
                        aria-hidden
                        className={`absolute inset-0 ${tone}`}
                        style={{
                          opacity: 0.18 + (0.62 * Math.abs(c.shrunk)) / span,
                        }}
                      />
                    )}
                    <span className="relative">
                      {c.signal === "low data" ? "n<3" : signedf(c.shrunk)}
                    </span>
                  </span>
                );
              })}
            </div>
          ))}
          {shown.length === 0 && (
            <p className="px-1 py-4 text-sm text-muted">
              No judge has an offset the data can tell apart from noise.
            </p>
          )}
          <div
            className="mt-2 grid items-center gap-1 border-t border-line px-1 pt-2 font-mono text-[10.5px] text-muted"
            style={{ gridTemplateColumns: cols }}
          >
            <span>real spread τ</span>
            {criteria.map((c) => (
              <span
                key={c.criterion}
                className="text-center tabular"
                title={`Noise per review: ${f2(c.sigma)} pts`}
              >
                {f2(c.tau)}
                {c.flagged > 0 && (
                  <span className="text-ink"> · {c.flagged}⚑</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-ink-2">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-warn/70" /> kinder than
          co-judges
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-info/70" /> harsher
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-surface-2 ring-1 ring-line" />{" "}
          within noise
        </li>
        <li className="text-muted">
          Values in scale points, after empirical-Bayes shrinkage.
        </li>
      </ul>
    </div>
  );
}
