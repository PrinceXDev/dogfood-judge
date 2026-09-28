"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { prefersReduced } from "@/components/motion";

// The defensibility graph. The winner sits in the middle; every judge sits on
// the ring. "Test winner stability" replays the engine's leave-one-judge-out
// refits one judge at a time: each judge disappears and the centre reports
// whether first place held. It only replays what the engine computed
// (robustness.winner_flips); it never invents a counterfactual ranking.

export type DefJudge = {
  id: string;
  label: string;
  flips: boolean; // removing this judge changes the winner
  influence: number; // 1 − Kendall τ of the ranking without them
  flipsTopK?: number;
};

type Props = {
  winner: { id: string; label: string };
  judges: DefJudge[];
  refits: number;
  held: number;
  topK: number;
  probTopK?: number;
  rankLow?: number;
  rankHigh?: number;
  margin?: number; // winner's lead in combined SEs
  compact?: boolean;
};

const S = 460;
const C = S / 2;

export function DefensibilityGraph({
  winner,
  judges,
  refits,
  held,
  topK,
  probTopK,
  rankLow,
  rankHigh,
  margin,
  compact = false,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [at, setAt] = useState(-1); // judge currently removed
  const [seen, setSeen] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const n = judges.length;
  const R = n > 16 ? 178 : 160;
  const stable = held === refits;
  const pos = (i: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: C + Math.cos(a) * R, y: C + Math.sin(a) * R };
  };
  const heldSoFar = judges.slice(0, seen).filter((j) => !j.flips).length;
  const current = at >= 0 ? judges[at] : null;
  const maxInf = Math.max(0.01, ...judges.map((j) => j.influence));

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = () => {
    clearTimeout(timer.current);
    if (prefersReduced()) {
      setSeen(n);
      setAt(-1);
      setPhase("done");
      return;
    }
    setPhase("running");
    setSeen(0);
    const per = Math.max(180, Math.min(520, 7000 / n));
    let i = 0;
    const tick = () => {
      if (i >= n) {
        setAt(-1);
        setPhase("done");
        return;
      }
      setAt(i);
      timer.current = setTimeout(() => {
        i++;
        setSeen(i);
        tick();
      }, per);
    };
    tick();
  };

  const centerTone = current?.flips
    ? "var(--warn)"
    : phase === "done" && !stable
      ? "var(--warn)"
      : "var(--accent)";
  const hj = hover ? judges.find((j) => j.id === hover) : null;

  return (
    <div
      className={`grid items-center gap-8 ${compact ? "" : "lg:grid-cols-[minmax(0,1fr)_320px]"}`}
    >
      <div className="relative mx-auto w-full max-w-[520px]">
        <svg
          viewBox={`0 0 ${S} ${S}`}
          className="block w-full overflow-visible"
          role="img"
          aria-label={`Winner ${winner.label} stays first in ${held} of ${refits} refits with one judge removed.`}
        >
          <defs>
            <radialGradient id="def-core">
              <stop offset="0%" stopColor={centerTone} stopOpacity="0.35" />
              <stop offset="100%" stopColor={centerTone} stopOpacity="0" />
            </radialGradient>
          </defs>
          {[0.36, 0.62, 0.9].map((f) => (
            <circle
              key={f}
              cx={C}
              cy={C}
              r={R * f + 10}
              fill="none"
              stroke="var(--line)"
              strokeDasharray="2 5"
            />
          ))}
          <circle cx={C} cy={C} r={R + 26} fill="none" stroke="var(--line)" />

          {judges.map((j, i) => {
            const p = pos(i);
            const gone = phase === "running" && i === at;
            const revealed =
              phase === "done" || (phase === "running" && i < seen);
            const on = hover === j.id;
            const tone =
              revealed || on
                ? j.flips
                  ? "var(--warn)"
                  : "var(--accent-2)"
                : "var(--line-strong)";
            return (
              <line
                key={`e-${j.id}`}
                x1={p.x}
                y1={p.y}
                x2={C}
                y2={C}
                stroke={tone}
                strokeWidth={0.6 + (j.influence / maxInf) * 2.2}
                opacity={gone ? 0 : on ? 1 : revealed ? 0.55 : 0.35}
                style={{ transition: "opacity 260ms, stroke 260ms" }}
              />
            );
          })}

          <circle
            cx={C}
            cy={C}
            r={90}
            fill="url(#def-core)"
            style={{ transition: "all 300ms" }}
          />
          <circle
            cx={C}
            cy={C}
            r={46}
            fill="var(--surface)"
            stroke={centerTone}
            strokeWidth={1.5}
            className={
              current?.flips
                ? "animate-[fade_300ms_ease-in-out_2_alternate]"
                : ""
            }
            style={{ transition: "stroke 250ms" }}
          />
          <text
            x={C}
            y={C - 10}
            textAnchor="middle"
            className="fill-muted font-mono text-[9px] tracking-[0.2em]"
          >
            WINNER
          </text>
          <text
            x={C}
            y={C + 8}
            textAnchor="middle"
            className="fill-ink text-[15px] font-semibold"
          >
            {winner.label.length > 16
              ? `${winner.label.slice(0, 15)}…`
              : winner.label}
          </text>
          <text
            x={C}
            y={C + 24}
            textAnchor="middle"
            className="font-mono text-[10px]"
            fill={centerTone}
          >
            {phase === "running" && current
              ? current.flips
                ? "#1 changes"
                : "#1 holds"
              : phase === "done"
                ? stable
                  ? "STABLE"
                  : "SENSITIVE"
                : `${held}/${refits} held`}
          </text>

          {judges.map((j, i) => {
            const p = pos(i);
            const gone = phase === "running" && i === at;
            const revealed =
              phase === "done" || (phase === "running" && i < seen);
            const on = hover === j.id;
            return (
              // biome-ignore lint/a11y/useSemanticElements: an SVG node cannot be a <button>; it is focusable and labelled
              <g
                key={j.id}
                role="button"
                tabIndex={0}
                aria-label={`${j.label}: ${j.flips ? "removing this judge changes the winner" : "the winner holds without this judge"}. Influence ${j.influence.toFixed(3)}.`}
                onMouseEnter={() => setHover(j.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(j.id)}
                onBlur={() => setHover(null)}
                className="cursor-pointer outline-none"
                style={{
                  transform: `translate(${p.x}px, ${p.y}px) scale(${gone ? 0.2 : on ? 1.25 : 1})`,
                  opacity: gone ? 0 : 1,
                  transition:
                    "transform 260ms cubic-bezier(0.22,1,0.36,1), opacity 260ms",
                }}
              >
                <circle
                  r={n > 16 ? 7 : 9}
                  fill="var(--surface)"
                  stroke={
                    revealed || on
                      ? j.flips
                        ? "var(--warn)"
                        : "var(--accent-2)"
                      : "var(--line-strong)"
                  }
                  strokeWidth={1.5}
                />
                <circle
                  r={n > 16 ? 2.5 : 3.2}
                  fill={
                    revealed || on
                      ? j.flips
                        ? "var(--warn)"
                        : "var(--accent-2)"
                      : "var(--muted)"
                  }
                />
                {(!compact || n <= 16) && (
                  <text
                    y={p.y > C ? 22 : -14}
                    textAnchor="middle"
                    className={`font-mono text-[9px] ${on ? "fill-ink" : "fill-muted"}`}
                  >
                    {j.id}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hj && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto w-fit max-w-full animate-fade rounded-md border border-line-strong bg-surface px-3 py-2 text-xs shadow-xl">
            <span className="font-medium">What if {hj.label} disappears?</span>{" "}
            <span className={hj.flips ? "text-warn" : "text-accent"}>
              {hj.flips ? "The winner changes." : "The winner stays #1."}
            </span>{" "}
            <span className="font-mono text-muted">
              influence {hj.influence.toFixed(3)}
              {hj.flipsTopK ? ` · reshapes top ${topK}` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <Cell
            label="Winner held"
            value={`${phase === "idle" ? held : phase === "done" ? held : heldSoFar}/${phase === "running" ? seen : refits}`}
            tone={stable ? "accent" : "warn"}
          />
          {probTopK !== undefined && (
            <Cell
              label={`P(top ${topK})`}
              value={`${Math.round(probTopK * 100)}%`}
            />
          )}
          {rankLow !== undefined && (
            <Cell
              label="90% rank interval"
              value={`#${rankLow}–#${rankHigh}`}
            />
          )}
          {margin !== undefined && (
            <Cell
              label="Lead over #2"
              value={`${margin.toFixed(2)} SE`}
              tone={margin < 1 ? "warn" : undefined}
            />
          )}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={phase === "running"}
          className={`${buttonClass("accent", "lg")} w-full`}
        >
          <Icon name="activity" size={16} />
          {phase === "running"
            ? `Refitting without ${current?.id ?? "…"}`
            : phase === "done"
              ? "Run the test again"
              : "Test winner stability"}
        </button>
        <p
          className="min-h-[3.5rem] text-sm leading-relaxed text-ink-2"
          aria-live="polite"
        >
          {phase === "done" ? (
            <>
              <span
                className={`mr-2 inline-flex rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold ${stable ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn"}`}
              >
                {stable ? "STABLE" : "SENSITIVE"}
              </span>
              Winner remains #1 across {held}/{refits} judge-removal refits.
              {!stable &&
                ` ${refits - held} judge${refits - held === 1 ? "" : "s"} can each change first place alone.`}
            </>
          ) : (
            "Each judge is removed in turn and the whole model refitted. If first place survives every removal, no single judge decided it."
          )}
        </p>
        <ul className="sr-only">
          {judges.map((j) => (
            <li key={j.id}>
              {j.label}: {j.flips ? "changes the winner" : "winner holds"}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "accent" | "warn";
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p
        className={`mt-1 font-mono text-xl tabular ${tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}
