"use client";

import { useMemo, useState } from "react";

// Normalization, made visible. Left: how projects move between the raw mean,
// the leniency-only correction and the final leniency + scale model (all
// three are engine outputs). Right: pick a judge to see the scores they gave,
// where their average sits against everyone's, and how far the engine
// trusted that difference (shrinkage) given how many reviews they wrote.

export type NormProject = {
  id: string;
  label: string;
  raw: number;
  bias: number;
  final: number;
  rawScore: number;
  finalScore: number;
};

export type NormJudge = {
  id: string;
  label: string;
  bias: number;
  biasSe: number;
  scale: number;
  mean: number;
  sd: number;
  reviews: number;
  flags: string[];
  scores: { project: string; score: number }[];
};

const COLS = [
  { key: "raw", label: "RAW MEAN" },
  { key: "bias", label: "LENIENCY-CORRECTED" },
  { key: "final", label: "FINAL (LENIENCY + SCALE)" },
] as const;

export function NormalizationView({
  projects,
  judges,
  mu,
  scaleMin = 1,
  scaleMax = 5,
}: {
  projects: NormProject[];
  judges: NormJudge[];
  mu: number;
  scaleMin?: number;
  scaleMax?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [jid, setJid] = useState(
    () =>
      [...judges].sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias))[0]?.id ??
      "",
  );
  const judge = judges.find((j) => j.id === jid);
  const n = projects.length;
  const ROW = n > 30 ? 13 : 16;
  const H = 30 + n * ROW;
  const X = [70, 270, 470];
  const y = (r: number) => 30 + (r - 1) * ROW + ROW / 2;
  const judged = useMemo(
    () => new Set(judge?.scores.map((s) => s.project) ?? []),
    [judge],
  );

  const ax = (v: number) => 20 + ((v - scaleMin) / (scaleMax - scaleMin)) * 460;
  const naive = judge ? judge.mean - mu : 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="max-h-[640px] overflow-y-auto">
          <svg
            viewBox={`0 0 560 ${H}`}
            className="block w-full"
            role="img"
            aria-label="Slope chart of project ranks: raw mean, leniency-corrected, and final."
            onMouseLeave={() => setHover(null)}
          >
            {COLS.map((c, i) => (
              <text
                key={c.key}
                x={X[i]}
                y={16}
                textAnchor="middle"
                className="fill-muted font-mono text-[8.5px] tracking-[0.14em]"
              >
                {c.label}
              </text>
            ))}
            {projects.map((p) => {
              const on = hover === p.id;
              const mine = judged.has(p.id);
              const moved = p.raw - p.final;
              const stroke = on
                ? "var(--ink)"
                : mine
                  ? "var(--accent-2)"
                  : moved > 0
                    ? "var(--accent)"
                    : moved < 0
                      ? "var(--bad)"
                      : "var(--line-strong)";
              const dim = hover ? !on : false;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover highlight only
                <g
                  key={p.id}
                  onMouseEnter={() => setHover(p.id)}
                  opacity={dim ? 0.18 : 1}
                  style={{ transition: "opacity 150ms" }}
                >
                  <path
                    d={`M ${X[0] + 26} ${y(p.raw)} C ${X[0] + 110} ${y(p.raw)}, ${X[1] - 90} ${y(p.bias)}, ${X[1] - 26} ${y(p.bias)} M ${X[1] + 26} ${y(p.bias)} C ${X[1] + 110} ${y(p.bias)}, ${X[2] - 90} ${y(p.final)}, ${X[2] - 26} ${y(p.final)}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={on ? 1.8 : 1}
                    opacity={moved === 0 && !on && !mine ? 0.5 : 0.85}
                  />
                  {COLS.map((c, i) => (
                    <text
                      key={c.key}
                      x={X[i]}
                      y={y(p[c.key]) + 3.5}
                      textAnchor="middle"
                      className={`font-mono ${n > 30 ? "text-[8px]" : "text-[9px]"} ${on || mine ? "fill-ink" : "fill-ink-2"}`}
                    >
                      {p.label}
                    </text>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-accent" /> moved up
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-bad" /> moved down
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-accent-2" /> reviewed by selected
            judge
          </span>
          {hover &&
            (() => {
              const p = projects.find((x) => x.id === hover);
              return p ? (
                <span className="ml-auto font-mono text-ink-2">
                  {p.label}: #{p.raw} → #{p.bias} → #{p.final} ·{" "}
                  {p.rawScore.toFixed(2)} → {p.finalScore.toFixed(2)}
                </span>
              ) : null;
            })()}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-5">
        <label className="flex flex-wrap items-center justify-between gap-3 text-sm font-medium">
          Inspect a judge
          <select
            value={jid}
            onChange={(e) => setJid(e.target.value)}
            className="rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink"
          >
            {judges.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label} · {j.bias >= 0 ? "+" : ""}
                {j.bias.toFixed(2)}
              </option>
            ))}
          </select>
        </label>
        {judge && (
          <>
            <svg
              viewBox="0 0 500 120"
              className="mt-5 block w-full"
              role="img"
              aria-label={`${judge.label}'s scores on the ${scaleMin} to ${scaleMax} scale.`}
            >
              <line
                x1={20}
                x2={480}
                y1={70}
                y2={70}
                stroke="var(--line-strong)"
              />
              {Array.from(
                { length: scaleMax - scaleMin + 1 },
                (_, i) => scaleMin + i,
              ).map((v) => (
                <g key={v}>
                  <line
                    x1={ax(v)}
                    x2={ax(v)}
                    y1={66}
                    y2={74}
                    stroke="var(--line-strong)"
                  />
                  <text
                    x={ax(v)}
                    y={90}
                    textAnchor="middle"
                    className="fill-muted font-mono text-[10px]"
                  >
                    {v}
                  </text>
                </g>
              ))}
              <line
                x1={ax(mu)}
                x2={ax(mu)}
                y1={24}
                y2={80}
                stroke="var(--muted)"
                strokeDasharray="3 3"
              />
              <text
                x={ax(mu)}
                y={18}
                textAnchor="middle"
                className="fill-muted font-mono text-[9px]"
              >
                everyone μ {mu.toFixed(2)}
              </text>
              <line
                x1={ax(judge.mean)}
                x2={ax(judge.mean)}
                y1={36}
                y2={80}
                stroke="var(--accent-2)"
              />
              <text
                x={ax(judge.mean)}
                y={112}
                textAnchor="middle"
                className="fill-accent-2 font-mono text-[9px]"
              >
                their mean {judge.mean.toFixed(2)}
              </text>
              {judge.scores.map((s, i) => (
                <circle
                  key={s.project}
                  cx={ax(s.score)}
                  cy={56 - (i % 4) * 7}
                  r={3.4}
                  fill="var(--accent-2)"
                  opacity={0.75}
                >
                  <title>{`${s.project}: ${s.score.toFixed(2)}`}</title>
                </circle>
              ))}
            </svg>
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line text-sm">
              {[
                ["Reviews", String(judge.reviews)],
                ["Spread given (SD)", judge.sd.toFixed(2)],
                [
                  "Naive offset (mean − μ)",
                  `${naive >= 0 ? "+" : ""}${naive.toFixed(2)}`,
                ],
                [
                  "Estimated leniency",
                  `${judge.bias >= 0 ? "+" : ""}${judge.bias.toFixed(2)} ± ${judge.biasSe.toFixed(2)}`,
                ],
                ["Scale use", `${judge.scale.toFixed(2)}×`],
                [
                  "Confidence",
                  Math.abs(judge.bias) > 2 * judge.biasSe
                    ? "clear signal"
                    : "within noise",
                ],
              ].map(([k, v]) => (
                <div key={k} className="bg-surface px-3 py-2.5">
                  <p className="text-[11px] text-muted">{k}</p>
                  <p className="mt-0.5 font-mono text-ink">{v}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink-2">
              {Math.abs(judge.bias) < Math.abs(naive) - 0.02
                ? `Shrinkage: the engine pulled this judge's correction from ${naive >= 0 ? "+" : ""}${naive.toFixed(2)} toward zero to ${judge.bias >= 0 ? "+" : ""}${judge.bias.toFixed(2)}, because ${judge.reviews} reviews are limited evidence and part of the gap reflects which projects they happened to see.`
                : "The estimated leniency is close to the naive offset: the evidence supports the full correction."}{" "}
              {judge.scale < 0.8
                ? "A scale below 1 means they compress differences; their gaps are stretched back out."
                : judge.scale > 1.2
                  ? "A scale above 1 means they exaggerate differences; their gaps are compressed."
                  : ""}
            </p>
            {judge.flags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {judge.flags.map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] text-warn"
                  >
                    {f.split(":")[0]}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
