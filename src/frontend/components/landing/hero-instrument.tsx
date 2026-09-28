"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { prefersReduced } from "@/components/motion";
import { type DemoResult, jLabel, pLabel } from "@/lib/demo";

// The hero's instrument panel: the story world's judges, projects and every
// review between them, drawn from the engine's real output. It alternates
// between the raw-mean order and the normalized order so the reordering is
// the first thing a visitor sees. Hover a judge or a project to inspect it.

const W = 560;
const ROW = 17;
const TOP = 34;
const JX = 92;
const PX = 330;

type Mode = "raw" | "biasscale";

export function HeroInstrument({ data }: { data: DemoResult }) {
  const [mode, setMode] = useState<Mode>("raw");
  const [auto, setAuto] = useState(true);
  const [hover, setHover] = useState<{ kind: "j" | "p"; id: string } | null>(
    null,
  );
  const rep = data.report;
  const projects = rep.projects;
  const judges = rep.judges;
  const trueWinner = data.truth.find((t) => t.true_rank === 1)?.id;
  const h = TOP + projects.length * ROW + 10;
  const jGap = (h - TOP - 20) / judges.length;

  useEffect(() => {
    if (!auto || prefersReduced()) return;
    const t = setInterval(
      () => setMode((m) => (m === "raw" ? "biasscale" : "raw")),
      3600,
    );
    return () => clearInterval(t);
  }, [auto]);

  const jy = useMemo(
    () =>
      new Map(judges.map((j, i) => [j.judge, TOP + 10 + i * jGap + jGap / 2])),
    [judges, jGap],
  );
  const py = (id: string) => {
    const p = projects.find((x) => x.project === id);
    return TOP + ((p?.ranks[mode] ?? 1) - 1) * ROW + ROW / 2;
  };
  const maxBias = Math.max(...judges.map((j) => Math.abs(j.bias)), 0.01);
  const lit = (r: { judge: string; project: string }) =>
    hover &&
    (hover.kind === "j" ? r.judge === hover.id : r.project === hover.id);

  const hp =
    hover?.kind === "p" ? projects.find((p) => p.project === hover.id) : null;
  const hj =
    hover?.kind === "j" ? judges.find((j) => j.judge === hover.id) : null;

  const stages = ["Projects", "Judges", "Reviews", "Normalization", "Results"];
  const stage = mode === "raw" ? 2 : 4;

  return (
    <div className="glow-edge relative overflow-hidden rounded-xl border border-line-strong bg-surface/80 shadow-[0_40px_120px_-40px_var(--glow)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
          <span className="size-2 animate-pulse-dot rounded-full bg-accent" />
          the pack · simulated world #{data.config.seed}
        </div>
        <fieldset className="flex rounded-md border border-line bg-sunken p-0.5 font-mono text-[10.5px]">
          <legend className="sr-only">Ranking method</legend>
          {(
            [
              ["raw", "raw mean"],
              ["biasscale", "normalized"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setAuto(false);
                setMode(m);
              }}
              className={`rounded px-2 py-1 uppercase tracking-wider transition-colors ${mode === m ? "bg-surface-hover text-accent" : "text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>

      <svg
        viewBox={`0 0 ${W} ${h}`}
        className="block w-full"
        role="img"
        aria-label={`${judges.length} judges and ${projects.length} projects connected by ${data.reviews.length} reviews, ordered by ${mode === "raw" ? "raw mean" : "normalized score"}.`}
        onMouseLeave={() => setHover(null)}
      >
        <text
          x={JX}
          y={18}
          textAnchor="middle"
          className="fill-muted font-mono text-[10px] tracking-[0.18em]"
        >
          JUDGES
        </text>
        <text
          x={PX + 60}
          y={18}
          textAnchor="middle"
          className="fill-muted font-mono text-[10px] tracking-[0.18em]"
        >
          {mode === "raw" ? "RAW RANK" : "NORMALIZED RANK"}
        </text>

        {data.reviews.map((r) => {
          const y1 = jy.get(r.judge) ?? 0;
          const y2 = py(r.project);
          const on = lit(r);
          return (
            <path
              key={`${r.judge}-${r.project}`}
              style={
                {
                  d: `path("M ${JX + 12} ${y1} C ${JX + 120} ${y1}, ${PX - 110} ${y2}, ${PX - 8} ${y2}")`,
                  transition:
                    "d 900ms cubic-bezier(0.22,1,0.36,1), stroke 200ms, opacity 200ms",
                } as CSSProperties
              }
              fill="none"
              stroke={on ? "var(--accent)" : "var(--line-strong)"}
              strokeWidth={on ? 1.4 : 0.8}
              opacity={hover && !on ? 0.25 : on ? 1 : 0.7}
            />
          );
        })}

        {judges.map((j) => {
          const y = jy.get(j.judge) ?? 0;
          const on = hover?.kind === "j" && hover.id === j.judge;
          const bw = (Math.abs(j.bias) / maxBias) * 26;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover preview; the same data is in the caption below
            <g
              key={j.judge}
              onMouseEnter={() => setHover({ kind: "j", id: j.judge })}
              className="cursor-pointer"
            >
              <rect
                x={JX - 30 - (j.bias < 0 ? bw : 0)}
                y={y - 1.5}
                width={bw}
                height={3}
                rx={1.5}
                className={j.bias >= 0 ? "fill-warn/70" : "fill-info/70"}
              />
              <line
                x1={JX - 30}
                x2={JX - 30}
                y1={y - 5}
                y2={y + 5}
                stroke="var(--line-strong)"
              />
              <circle
                cx={JX}
                cy={y}
                r={on ? 7 : 5.5}
                className={`transition-all ${j.flips_first ? "fill-warn" : "fill-accent-2"}`}
              />
              <text
                x={JX + 14}
                y={y + 3.5}
                className={`font-mono text-[11px] ${on ? "fill-ink" : "fill-muted"}`}
              >
                {j.judge}
              </text>
            </g>
          );
        })}

        {projects.map((p) => {
          const y = TOP + (p.ranks[mode] - 1) * ROW + ROW / 2;
          const top = p.ranks[mode] <= 3;
          const on = hover?.kind === "p" && hover.id === p.project;
          const score = p.scores[mode];
          const barW =
            mode === "raw"
              ? ((score - 1) / 4) * 120
              : Math.max(4, ((score - 2) / 3) * 120);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover preview; the same data is in the caption below
            <g
              key={p.project}
              style={{
                transform: `translateY(${y}px)`,
                transition: "transform 900ms cubic-bezier(0.22,1,0.36,1)",
              }}
              onMouseEnter={() => setHover({ kind: "p", id: p.project })}
              className="cursor-pointer"
            >
              <rect
                x={PX - 14}
                y={-ROW / 2 + 1}
                width={W - PX + 6}
                height={ROW - 2}
                rx={3}
                className={on ? "fill-surface-hover" : "fill-transparent"}
              />
              <text
                x={PX - 4}
                y={3.5}
                textAnchor="end"
                className="fill-muted font-mono text-[9.5px]"
              >
                {p.ranks[mode]}
              </text>
              <circle
                cx={PX + 4}
                cy={0}
                r={3}
                className={top ? "fill-accent" : "fill-muted"}
              />
              <text
                x={PX + 13}
                y={3.5}
                className={`font-mono text-[11px] ${top || on ? "fill-ink" : "fill-ink-2"}`}
              >
                {p.project}
              </text>
              <rect
                x={PX + 44}
                y={-2}
                width={Math.max(2, barW)}
                height={4}
                rx={2}
                className={top ? "fill-accent" : "fill-line-strong"}
                style={{
                  transition: "width 900ms cubic-bezier(0.22,1,0.36,1)",
                }}
              />
              {p.project === trueWinner && (
                <text
                  x={W - 8}
                  y={3.5}
                  textAnchor="end"
                  className="fill-warn font-mono text-[9.5px]"
                >
                  true #1
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div
        className="min-h-[52px] border-t border-line px-4 py-2.5 font-mono text-[11px] leading-relaxed text-muted"
        aria-live="polite"
      >
        {hp ? (
          <span>
            <span className="text-ink">{pLabel(hp.project)}</span> · raw mean{" "}
            {hp.scores.raw.toFixed(2)} → normalized{" "}
            {hp.scores.biasscale.toFixed(2)} · rank #{hp.ranks.raw} →{" "}
            <span className="text-accent">#{hp.ranks.biasscale}</span> · P(top
            3) {Math.round(hp.prob_top_k * 100)}%
          </span>
        ) : hj ? (
          <span>
            <span className="text-ink">{jLabel(hj.judge)}</span> · leniency{" "}
            {hj.bias >= 0 ? "+" : ""}
            {hj.bias.toFixed(2)} pts · scale {hj.scale.toFixed(2)} ·{" "}
            {hj.reviews} reviews
            {hj.flips_first ? (
              <span className="text-warn">
                {" "}
                · removing them changes the winner
              </span>
            ) : (
              " · winner survives without them"
            )}
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {stages.map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className={
                    i <= stage
                      ? i === stage
                        ? "text-accent"
                        : "text-ink-2"
                      : "text-muted/60"
                  }
                >
                  {s.toUpperCase()}
                </span>
                {i < stages.length - 1 && (
                  <span className="text-muted/50">→</span>
                )}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
