"use client";

import { useState } from "react";
import { Tag } from "@/components/ui";
import { f2, signedf } from "@/lib/format";

// Judge calibration. The forest plot shows each judge's estimated leniency
// with a 90% interval (±1.645 SE), so a judge is only "lenient" when the
// interval clears zero. The strip beside it counts the criterion values the
// judge actually used. Selecting a judge shows the leave-one-judge-out refit
// the engine already ran: the top k without them.

export type CalibrationJudge = {
  id: string;
  label: string;
  bias: number;
  biasSe: number;
  reviews: number;
  flags: string[];
  /** Every criterion value the judge gave. */
  values: number[];
};

const Z90 = 1.645;

export function Calibration({
  judges,
  scaleMin,
  scaleMax,
  topK,
  refitTopK,
  titles,
}: {
  judges: CalibrationJudge[];
  scaleMin: number;
  scaleMax: number;
  topK: string[];
  refitTopK: Record<string, string[] | null>;
  titles: Record<string, string>;
}) {
  const sorted = [...judges].sort((a, b) => b.bias - a.bias);
  const [pick, setPick] = useState<string | null>(null);
  const span = Math.max(
    0.5,
    ...judges.map((j) => Math.abs(j.bias) + Z90 * j.biasSe),
  );
  const x = (v: number) => 50 + (50 * v) / span;
  const levels = Array.from(
    { length: Math.max(1, scaleMax - scaleMin + 1) },
    (_, i) => scaleMin + i,
  );
  const excl = judges.filter(
    (j) => Math.abs(j.bias) > Z90 * j.biasSe && j.reviews >= 3,
  ).length;
  const chosen = judges.find((j) => j.id === pick);
  const without = pick ? (refitTopK[pick] ?? null) : null;
  const inTop = new Set(topK);
  const name = (p: string) => titles[p] ?? p;

  return (
    <div className="grid gap-4">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted sm:grid-cols-[minmax(0,170px)_minmax(0,1fr)_150px]">
          <span>Judge</span>
          <span className="flex justify-between">
            <span>harsher</span>
            <span>leniency, 90% interval</span>
            <span>kinder</span>
          </span>
          <span className="hidden sm:block">
            values used {scaleMin}–{scaleMax}
          </span>
        </div>
        <ul>
          {sorted.map((j) => {
            const lo = j.bias - Z90 * j.biasSe;
            const hi = j.bias + Z90 * j.biasSe;
            const clear = (lo > 0 || hi < 0) && j.reviews >= 3;
            const counts = levels.map(
              (l) => j.values.filter((v) => v === l).length,
            );
            const peak = Math.max(1, ...counts);
            const on = pick === j.id;
            return (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => setPick(on ? null : j.id)}
                  aria-pressed={on}
                  className={`grid w-full grid-cols-[minmax(0,150px)_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 py-1.5 text-left last:border-0 sm:grid-cols-[minmax(0,170px)_minmax(0,1fr)_150px] ${on ? "bg-accent/[0.07]" : "hover:bg-surface-hover/60"}`}
                >
                  <span className="min-w-0 truncate text-[13px]">
                    <span className={on ? "text-accent" : "text-ink"}>
                      {j.label}
                    </span>{" "}
                    <span className="font-mono text-[11px] text-muted">
                      {j.reviews}
                    </span>
                  </span>
                  <svg
                    viewBox="0 0 100 10"
                    preserveAspectRatio="none"
                    className="h-4 w-full"
                    role="img"
                    aria-label={`${j.label}: leniency ${signedf(j.bias)}, 90% interval ${f2(lo)} to ${f2(hi)}`}
                  >
                    <line
                      x1={50}
                      x2={50}
                      y1={0}
                      y2={10}
                      stroke="var(--line-strong)"
                      strokeWidth={0.4}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={x(lo)}
                      x2={x(hi)}
                      y1={5}
                      y2={5}
                      stroke={clear ? "var(--warn)" : "var(--muted)"}
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={x(j.bias) - 0.8}
                      y={2.5}
                      width={1.6}
                      height={5}
                      fill={clear ? "var(--warn)" : "var(--ink)"}
                    />
                  </svg>
                  <span
                    className="hidden h-5 items-end gap-px sm:flex"
                    title={levels
                      .map((l, i) => `${l}: ${counts[i]}`)
                      .join(" · ")}
                  >
                    {counts.map((c, i) => (
                      <span
                        key={levels[i]}
                        className={`flex-1 rounded-sm ${c ? "bg-accent-2/70" : "bg-line"}`}
                        style={{ height: `${c ? 20 + (80 * c) / peak : 8}%` }}
                      />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs text-muted">
        {excl === 0
          ? "No judge's interval clears zero: nobody is measurably kinder or harsher than the rest."
          : `${excl} judge${excl === 1 ? "'s" : "s'"} interval${excl === 1 ? " clears" : "s clear"} zero (amber): measurably kinder or harsher, and already corrected for.`}{" "}
        Select a judge to see the ranking without them.
      </p>

      {chosen && (
        <div className="rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="text-ink">
            Without <b>{chosen.label}</b>
            {chosen.flags.length > 0 && (
              <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                {chosen.flags.map((f) => (
                  <Tag key={f} tone="warn">
                    <span title={f}>{f.split(":")[0]}</span>
                  </Tag>
                ))}
              </span>
            )}
          </p>
          {without ? (
            <>
              <ol className="mt-3 grid gap-1.5">
                {without.map((p, i) => (
                  <li key={p} className="flex items-center gap-3">
                    <span className="w-6 font-mono text-xs text-muted tabular">
                      #{i + 1}
                    </span>
                    <span className="min-w-0 truncate">{name(p)}</span>
                    {!inTop.has(p) ? (
                      <Tag tone="warn">enters the top {topK.length}</Tag>
                    ) : topK[i] !== p ? (
                      <Tag>was #{topK.indexOf(p) + 1}</Tag>
                    ) : null}
                  </li>
                ))}
              </ol>
              {topK
                .filter((p) => !without.includes(p))
                .map((p) => (
                  <p key={p} className="mt-2 text-xs text-warn">
                    {name(p)} drops out of the top {topK.length}.
                  </p>
                ))}
              {without.every((p, i) => topK[i] === p) && (
                <p className="mt-2 text-xs text-good">
                  The top {topK.length} is unchanged, in the same order.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-muted">
              The engine had nothing left to refit without this judge.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
