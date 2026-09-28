"use client";

import { useState } from "react";

// "Why did this score change?" For one project: each review's raw score, the
// reviewing judge's estimated leniency and scale, the judge-corrected value
// (μ + (score − μ − leniency) / scale), and the engine's final adjusted score.
// The engine fits every review jointly with shrinkage, so the final score is
// not simply the mean of the corrected reviews; the page says so.

export type BreakdownProject = {
  id: string;
  label: string;
  rawMean: number;
  final: number;
  rawRank: number;
  finalRank: number;
  reviews: {
    judge: string;
    judgeLabel: string;
    score: number;
    bias: number;
    scale: number;
  }[];
};

export function ScoreBreakdown({
  projects,
  mu,
  scaleMin = 1,
  scaleMax = 5,
}: {
  projects: BreakdownProject[];
  mu: number;
  scaleMin?: number;
  scaleMax?: number;
}) {
  const [id, setId] = useState(projects[0]?.id ?? "");
  const [calibrated, setCalibrated] = useState(false);
  const p = projects.find((x) => x.id === id) ?? projects[0];
  if (!p) return null;
  const pct = (v: number) =>
    Math.max(0, Math.min(100, ((v - scaleMin) / (scaleMax - scaleMin)) * 100));
  const corr = (r: BreakdownProject["reviews"][number]) =>
    mu + (r.score - mu - r.bias) / (r.scale || 1);

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        {projects.length > 1 ? (
          <select
            value={p.id}
            onChange={(e) => setId(e.target.value)}
            aria-label="Project"
            className="rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-sm"
          >
            {projects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label} (#{x.rawRank} → #{x.finalRank})
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm font-medium">{p.label}</p>
        )}
        <fieldset className="flex rounded-md border border-line bg-sunken p-0.5 text-xs">
          <legend className="sr-only">Show</legend>
          {[
            [false, "Raw scores"],
            [true, "Judge-corrected"],
          ].map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={calibrated === v}
              onClick={() => setCalibrated(v as boolean)}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${calibrated === v ? "bg-surface-hover text-ink" : "text-muted hover:text-ink"}`}
            >
              {l as string}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="grid gap-3 p-5">
        {p.reviews.map((r) => {
          const v = calibrated ? corr(r) : r.score;
          return (
            <div
              key={r.judge}
              className="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-3 sm:grid-cols-[110px_minmax(0,1fr)_200px_64px]"
            >
              <span className="truncate font-mono text-xs text-ink-2">
                {r.judgeLabel}
              </span>
              <div className="relative h-7 rounded bg-surface-2">
                <div
                  className="absolute inset-y-0 w-px bg-muted/60"
                  style={{ left: `${pct(mu)}%` }}
                />
                <div
                  className={`absolute inset-y-1 left-0 rounded-sm transition-[width,background-color] duration-700 ease-out ${calibrated ? "bg-accent/70" : r.bias >= 0 ? "bg-warn/60" : "bg-info/60"}`}
                  style={{ width: `${pct(v)}%` }}
                />
              </div>
              <span className="hidden whitespace-nowrap font-mono text-[11px] text-muted sm:block">
                leniency {r.bias >= 0 ? "+" : ""}
                {r.bias.toFixed(2)} · scale {r.scale.toFixed(2)}
              </span>
              <span className="text-right font-mono text-sm tabular">
                {v.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
        {[
          ["Raw mean", p.rawMean.toFixed(2), `rank #${p.rawRank}`],
          [
            "Judge adjustment",
            `${p.final - p.rawMean >= 0 ? "+" : ""}${(p.final - p.rawMean).toFixed(2)}`,
            "from leniency and scale",
          ],
          [
            "Normalized score",
            p.final.toFixed(2),
            "what an average judge would give",
          ],
          [
            "Final rank",
            `#${p.finalRank}`,
            p.rawRank === p.finalRank
              ? "unchanged"
              : `${p.rawRank > p.finalRank ? "up" : "down"} ${Math.abs(p.rawRank - p.finalRank)}`,
          ],
        ].map(([k, v, s]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <p className="text-[11px] text-muted">{k}</p>
            <p className="mt-1 font-mono text-lg tabular text-ink">{v}</p>
            <p className="text-[11px] text-muted">{s}</p>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-muted">
        Vertical line: the overall mean μ = {mu.toFixed(2)}. The engine
        estimates every judge and project together and shrinks uncertain
        corrections, so the normalized score is not the plain average of the
        corrected reviews.
      </p>
    </div>
  );
}
