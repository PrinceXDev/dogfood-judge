"use client";

import { useState } from "react";
import { pct } from "@/lib/format";

// Where each project lands across the bootstrap replicates: one strip per
// project, shaded by how often it finished at each rank. Strips that overlap
// are statistical ties, visible without reading numbers. P(top n) for any n
// is read off the same counts, so moving the cut-off needs no refit.

export type RankDensityRow = { id: string; label: string; dist: number[] };

export function RankDensity({
  rows,
  k,
  show = 10,
}: {
  rows: RankDensityRow[];
  k: number;
  show?: number;
}) {
  const n = Math.max(1, ...rows.map((r) => r.dist.length));
  const [cut, setCut] = useState(Math.min(k, n));
  const top = rows.slice(0, show);
  const ranks = Math.min(n, Math.max(show + 5, 15));
  const total = (d: number[]) =>
    Math.max(
      1,
      d.reduce((a, b) => a + b, 0),
    );
  const probTop = (d: number[], m: number) =>
    d.slice(0, m).reduce((a, b) => a + b, 0) / total(d);

  return (
    <div className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <label className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
        P(top
        <input
          type="range"
          min={1}
          max={n}
          value={cut}
          onChange={(e) => setCut(Number(e.target.value))}
          className="w-40 accent-[var(--accent)]"
          aria-label="Cut-off rank"
        />
        <span className="w-6 font-mono text-ink tabular">{cut}</span>)
        <span className="text-xs text-muted">
          read from the same resamples; no refit
        </span>
      </label>
      <div className="mt-4 grid gap-1">
        <div
          className="grid items-end gap-3 pb-1 font-mono text-[10px] text-muted"
          style={{ gridTemplateColumns: "minmax(0,160px) 1fr 52px" }}
        >
          <span>Project</span>
          <span
            className="grid"
            style={{ gridTemplateColumns: `repeat(${ranks}, 1fr)` }}
          >
            {Array.from({ length: ranks }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the index is the rank
              <span key={i} className="text-center">
                {i === 0 || (i + 1) % 5 === 0 ? i + 1 : ""}
              </span>
            ))}
          </span>
          <span className="text-right">P(top {cut})</span>
        </div>
        {top.map((r) => {
          const t = total(r.dist);
          const peak = Math.max(1, ...r.dist);
          return (
            <div
              key={r.id}
              className="grid items-center gap-3"
              style={{ gridTemplateColumns: "minmax(0,160px) 1fr 52px" }}
            >
              <span className="truncate text-[13px] text-ink">{r.label}</span>
              <span
                className="relative grid h-5 overflow-hidden rounded-sm bg-surface-2"
                style={{ gridTemplateColumns: `repeat(${ranks}, 1fr)` }}
              >
                {Array.from({ length: ranks }, (_, i) => {
                  const c = r.dist[i] ?? 0;
                  return (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: the index is the rank
                      key={i}
                      title={`#${i + 1}: ${pct(c / t)}`}
                      className={i < cut ? "bg-accent" : "bg-accent-2"}
                      style={{ opacity: c ? 0.12 + (0.88 * c) / peak : 0 }}
                    />
                  );
                })}
                {cut <= ranks && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 w-0.5 bg-ink"
                    style={{ left: `calc(${(100 * cut) / ranks}% - 1px)` }}
                  />
                )}
              </span>
              <span className="text-right font-mono text-xs text-ink tabular">
                {pct(probTop(r.dist, cut))}
              </span>
            </div>
          );
        })}
      </div>
      {n > ranks && (
        <p className="mt-3 text-xs text-muted">
          Ranks beyond #{ranks} are counted in P(top n) but not drawn.
        </p>
      )}
    </div>
  );
}
