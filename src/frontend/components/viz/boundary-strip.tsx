"use client";

import { type ReactNode, useMemo, useState } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";

// "Spend judge time where it matters." Projects laid out by the bootstrap
// probability of finishing in the top k. Far left and far right are decided;
// the band between is the prize boundary. The preview applies the engine's
// own tie-breaker rule (judging.Tiebreak: 5% < P < 95%, closest to a coin
// flip first, at most `max`), so it shows exactly who the real action picks.

export type BoundaryProject = { id: string; label: string; p: number };

export function BoundaryStrip({
  projects,
  k,
  max = 5,
  lo = 0.05,
  hi = 0.95,
  action,
}: {
  projects: BoundaryProject[];
  k: number;
  max?: number;
  lo?: number;
  hi?: number;
  action?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const picked = useMemo(
    () =>
      projects
        .filter((x) => x.p > lo && x.p < hi)
        .sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5))
        .slice(0, max)
        .map((x) => x.id),
    [projects, lo, hi, max],
  );
  const decidedIn = projects.filter((x) => x.p >= hi).length;
  const decidedOut = projects.filter((x) => x.p <= lo).length;
  const boundary = projects.length - decidedIn - decidedOut;

  // Stack dots that would overlap into lanes.
  const placed = useMemo(() => {
    const lanes: number[][] = [];
    return [...projects]
      .sort((a, b) => a.p - b.p)
      .map((x) => {
        const px = x.p * 100;
        let lane = lanes.findIndex((l) =>
          l.every((v) => Math.abs(v - px) > 2.4),
        );
        if (lane < 0) {
          lane = lanes.length;
          lanes.push([]);
        }
        lanes[lane].push(px);
        return { ...x, lane: Math.min(lane, 7) };
      });
  }, [projects]);
  const hp = hover ? projects.find((x) => x.id === hover) : null;

  return (
    <div className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          [
            "Decided out",
            decidedOut,
            `P(top ${k}) ≤ ${lo * 100}%`,
            "text-muted",
          ],
          [
            "On the prize boundary",
            boundary,
            `${lo * 100}% < P < ${hi * 100}%`,
            "text-warn",
          ],
          [
            "Decided in",
            decidedIn,
            `P(top ${k}) ≥ ${hi * 100}%`,
            "text-accent",
          ],
        ].map(([label, n, sub, cls]) => (
          <div key={label as string}>
            <p className={`font-mono text-3xl tabular ${cls}`}>{n}</p>
            <p className="mt-1 text-xs font-medium">{label}</p>
            <p className="font-mono text-[10.5px] text-muted">{sub}</p>
          </div>
        ))}
      </div>

      <div className="relative mt-8 h-44">
        <div
          className="absolute bottom-6 top-0 rounded-md bg-warn/[0.06] ring-1 ring-warn/20 ring-inset"
          style={{ left: `${lo * 100}%`, right: `${(1 - hi) * 100}%` }}
        />
        <div className="absolute inset-x-0 bottom-6 h-px bg-line-strong" />
        {[0, 25, 50, 75, 100].map((t) => (
          <span
            key={t}
            className="absolute bottom-0 -translate-x-1/2 font-mono text-[10px] text-muted"
            style={{ left: `${t}%` }}
          >
            {t}%
          </span>
        ))}
        {placed.map((x) => {
          const pick = shown && picked.includes(x.id);
          const order = picked.indexOf(x.id) + 1;
          return (
            <button
              key={x.id}
              type="button"
              onMouseEnter={() => setHover(x.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(x.id)}
              onBlur={() => setHover(null)}
              aria-label={`${x.label}: P(top ${k}) ${Math.round(x.p * 100)}%${pick ? `, tie-breaker #${order}` : ""}`}
              className="absolute -translate-x-1/2"
              style={{ left: `${x.p * 100}%`, bottom: `${34 + x.lane * 15}px` }}
            >
              <span
                className={`block size-3 rounded-full border transition-all duration-300 ${pick ? "scale-125 border-warn bg-warn shadow-[0_0_12px_var(--warn)]" : x.p >= hi ? "border-accent bg-accent/70" : x.p <= lo ? "border-line-strong bg-line-strong" : "border-warn/60 bg-surface"}`}
              />
              {pick && (
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 animate-rise whitespace-nowrap rounded bg-warn px-1 font-mono text-[9px] font-semibold text-bg">
                  +1
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p
        className="mt-2 min-h-5 font-mono text-xs text-muted"
        aria-live="polite"
      >
        {hp
          ? `${hp.label} · P(top ${k}) ${Math.round(hp.p * 100)}%`
          : `x: bootstrap probability of finishing in the top ${k}`}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className={buttonClass(shown ? "secondary" : "primary")}
        >
          <Icon name="split" size={15} />
          {shown ? "Hide tie-breaker picks" : "Preview tie-breaker assignment"}
        </button>
        {action}
        <p className="basis-full text-sm text-ink-2" aria-live="polite">
          {shown
            ? picked.length
              ? `${picked.length} extra review${picked.length === 1 ? "" : "s"} go to the projects closest to a coin flip. The ${decidedIn + decidedOut} decided projects get none.`
              : "No project is on the prize boundary; the rule adds nothing."
            : `The rule sends at most ${max} extra reviews, only where one more opinion can change a prize.`}
        </p>
      </div>
    </div>
  );
}
