"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { type DemoConfig, type DemoResult, demoQuery } from "@/lib/demo";

// An educational simulation, and labelled as one: the sliders describe a
// synthetic hackathon, the Go engine that ranks real events analyzes it
// (GET /api/v1/demo/simulate), and because the world is synthetic we can
// score every ranking against the truth that generated it.

type Knob = {
  key: keyof DemoConfig;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
};

const KNOBS: Knob[] = [
  {
    key: "leniency",
    label: "Judge leniency spread",
    help: "How differently judges use the scale (SD, points)",
    min: 0,
    max: 1.5,
    step: 0.05,
    fmt: (v) => `±${v.toFixed(2)}`,
  },
  {
    key: "judges",
    label: "Number of judges",
    help: "Size of the judging pool",
    min: 3,
    max: 16,
    step: 1,
    fmt: (v) => String(v),
  },
  {
    key: "coverage",
    label: "Review coverage",
    help: "Reviews per project",
    min: 2,
    max: 6,
    step: 1,
    fmt: (v) => `${v}×`,
  },
  {
    key: "noise",
    label: "Score variance",
    help: "Per-criterion noise (SD, points)",
    min: 0.05,
    max: 1.5,
    step: 0.05,
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "projects",
    label: "Projects",
    help: "Submissions in the event",
    min: 6,
    max: 40,
    step: 1,
    fmt: (v) => String(v),
  },
];

export function SimulationLab({ initial }: { initial: DemoResult }) {
  const [cfg, setCfg] = useState<DemoConfig>(initial.config);
  const [data, setData] = useState<DemoResult>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tie, setTie] = useState(0.75);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/v1/demo/simulate?${demoQuery({ ...cfg, coverage: Math.min(cfg.coverage, cfg.judges) })}`,
          { signal: ctl.signal },
        );
        if (r.status === 429) {
          setError(
            "The public demo allows 40 new simulations a minute. Wait a moment and move a slider again.",
          );
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        setData(await r.json());
        setError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setError("The engine could not be reached. Is the API running?");
      } finally {
        setLoading(false);
      }
    }, 260);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [cfg]);

  const rep = data.report;
  const truth = useMemo(
    () => new Map(data.truth.map((t) => [t.id, t.true_rank])),
    [data],
  );
  const rb = rep.robustness;
  const k = rep.top_k;
  const ties = rep.projects.filter(
    (p, i) =>
      i < rep.projects.length - 1 &&
      p.ahead_of_next > 0 &&
      p.ahead_of_next < tie,
  ).length;
  const acc = data.accuracy;

  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-5 py-3">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          <span
            className={`size-2 rounded-full ${loading ? "animate-pulse bg-warn" : "bg-accent"}`}
          />
          Educational simulation · synthetic data · real engine
        </p>
        <button
          type="button"
          onClick={() => setCfg((c) => ({ ...c, seed: (c.seed % 100000) + 1 }))}
          className={buttonClass("secondary", "sm")}
        >
          <Icon name="sparkles" size={13} /> Draw a new world
        </button>
      </div>

      <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="grid content-start gap-5 border-b border-line p-5 lg:border-b-0 lg:border-r">
          {KNOBS.map((kn) => {
            const v = cfg[kn.key] as number;
            const max =
              kn.key === "coverage" ? Math.min(kn.max, cfg.judges) : kn.max;
            return (
              <label key={kn.key} className="grid gap-2">
                <span className="flex items-baseline justify-between text-[13px] font-medium">
                  {kn.label}
                  <span className="font-mono text-xs text-accent">
                    {kn.fmt(Math.min(v, max))}
                  </span>
                </span>
                <input
                  type="range"
                  min={kn.min}
                  max={max}
                  step={kn.step}
                  value={Math.min(v, max)}
                  onChange={(e) =>
                    setCfg((c) => ({ ...c, [kn.key]: Number(e.target.value) }))
                  }
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-[var(--accent)]"
                />
                <span className="text-[11px] text-muted">{kn.help}</span>
              </label>
            );
          })}
          <label className="grid gap-2 border-t border-line pt-5">
            <span className="flex items-baseline justify-between text-[13px] font-medium">
              Tie threshold
              <span className="font-mono text-xs text-accent">
                {Math.round(tie * 100)}%
              </span>
            </span>
            <input
              type="range"
              min={0.5}
              max={0.95}
              step={0.01}
              value={tie}
              onChange={(e) => setTie(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-[var(--accent)]"
            />
            <span className="text-[11px] text-muted">
              Neighbours are a tie when P(ahead of next) is below this
            </span>
          </label>
        </div>

        <div
          className={`grid gap-5 p-5 transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          {error && (
            <p
              role="alert"
              className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink"
            >
              {error}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            <Score
              label="Agreement with truth"
              raw={acc.raw_tau}
              norm={acc.adjusted_tau}
              fmt={(v) => `τ ${v.toFixed(2)}`}
            />
            <Score
              label={`True top ${k} recovered`}
              raw={acc.raw_top_k}
              norm={acc.adjusted_top_k}
              fmt={(v) => `${v}/${k}`}
            />
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-[11px] text-muted">True winner found</p>
              <p className="mt-2 flex items-center gap-3 font-mono text-sm">
                <span className="text-muted">
                  raw {acc.raw_winner ? "✓" : "✗"}
                </span>
                <span
                  className={acc.adjusted_winner ? "text-accent" : "text-warn"}
                >
                  norm {acc.adjusted_winner ? "✓" : "✗"}
                </span>
              </p>
            </div>
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-[11px] text-muted">Winner stability</p>
              <p
                className={`mt-1.5 font-mono text-lg ${rb && rb.winner_held === rb.refits ? "text-accent" : "text-warn"}`}
              >
                {rb ? `${rb.winner_held}/${rb.refits}` : "·"}
              </p>
              <p className="text-[10.5px] text-muted">
                {ties} statistical tie{ties === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <Bump data={data} truth={truth} />
            <Intervals data={data} truth={truth} tie={tie} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Score({
  label,
  raw,
  norm,
  fmt,
}: {
  label: string;
  raw: number;
  norm: number;
  fmt: (v: number) => string;
}) {
  const better = norm > raw + 1e-9;
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1.5 font-mono text-sm text-muted">raw {fmt(raw)}</p>
      <p className={`font-mono text-lg ${better ? "text-accent" : "text-ink"}`}>
        {fmt(norm)}
      </p>
    </div>
  );
}

function Bump({
  data,
  truth,
}: {
  data: DemoResult;
  truth: Map<string, number>;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const ps = data.report.projects;
  const n = ps.length;
  const ROW = n > 26 ? 9 : 12;
  const H = 26 + n * ROW;
  const X = [40, 180, 320];
  const y = (r: number) => 24 + (r - 1) * ROW + ROW / 2;
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 p-3">
      <p className="mb-1 text-[11px] text-muted">
        Where each project lands, by method
      </p>
      <svg
        viewBox={`0 0 360 ${H}`}
        className="block w-full"
        role="img"
        aria-label="Bump chart comparing true rank, raw-mean rank and normalized rank."
        onMouseLeave={() => setHover(null)}
      >
        {["TRUTH", "RAW MEAN", "NORMALIZED"].map((t, i) => (
          <text
            key={t}
            x={X[i]}
            y={12}
            textAnchor="middle"
            className="fill-muted font-mono text-[8px] tracking-[0.14em]"
          >
            {t}
          </text>
        ))}
        {ps.map((p) => {
          const t = truth.get(p.project) ?? 0;
          const err =
            Math.abs(p.ranks.biasscale - t) < Math.abs(p.ranks.raw - t);
          const on = hover === p.project;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover highlight only
            <g
              key={p.project}
              onMouseEnter={() => setHover(p.project)}
              opacity={hover && !on ? 0.15 : 1}
            >
              <polyline
                points={`${X[0]},${y(t)} ${X[1]},${y(p.ranks.raw)} ${X[2]},${y(p.ranks.biasscale)}`}
                fill="none"
                stroke={
                  on
                    ? "var(--ink)"
                    : t <= 3
                      ? "var(--accent)"
                      : err
                        ? "var(--accent-2)"
                        : "var(--line-strong)"
                }
                strokeWidth={on || t <= 3 ? 1.6 : 0.9}
                style={{ transition: "all 600ms cubic-bezier(0.22,1,0.36,1)" }}
              />
              {X.map((x, i) => (
                <circle
                  key={x}
                  cx={x}
                  cy={y(
                    i === 0 ? t : i === 1 ? p.ranks.raw : p.ranks.biasscale,
                  )}
                  r={t <= 3 ? 2.6 : 1.8}
                  fill={t <= 3 ? "var(--accent)" : "var(--muted)"}
                  style={{
                    transition: "all 600ms cubic-bezier(0.22,1,0.36,1)",
                  }}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[10.5px] text-muted">
        Green: the true top 3. Blue: normalization moved it closer to its true
        rank.
      </p>
    </div>
  );
}

function Intervals({
  data,
  truth,
  tie,
}: {
  data: DemoResult;
  truth: Map<string, number>;
  tie: number;
}) {
  const ps = data.report.projects.slice(0, 12);
  const n = data.report.projects.length;
  const x = (r: number) => 60 + ((r - 1) / Math.max(1, n - 1)) * 250;
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 p-3">
      <p className="mb-1 text-[11px] text-muted">
        How certain is each rank? (90% interval, top 12)
      </p>
      <svg
        viewBox={`0 0 320 ${20 + ps.length * 20}`}
        className="block w-full"
        role="img"
        aria-label="Rank intervals for the top twelve projects."
      >
        {ps.map((p, i) => {
          const yy = 16 + i * 20;
          const isTie =
            i < ps.length - 1 && p.ahead_of_next > 0 && p.ahead_of_next < tie;
          return (
            <g key={p.project}>
              <text
                x={4}
                y={yy + 3.5}
                className="fill-ink-2 font-mono text-[9px]"
              >
                {p.ranks.biasscale}. {p.project}
              </text>
              <line x1={x(1)} x2={x(n)} y1={yy} y2={yy} stroke="var(--line)" />
              <rect
                x={x(p.rank_low) - 2}
                y={yy - 3.5}
                width={Math.max(4, x(p.rank_high) - x(p.rank_low) + 4)}
                height={7}
                rx={3.5}
                fill="var(--accent)"
                opacity={0.25}
                style={{ transition: "all 600ms cubic-bezier(0.22,1,0.36,1)" }}
              />
              <circle
                cx={x(p.ranks.biasscale)}
                cy={yy}
                r={3}
                fill="var(--accent)"
                style={{ transition: "all 600ms cubic-bezier(0.22,1,0.36,1)" }}
              />
              <circle
                cx={x(truth.get(p.project) ?? 1)}
                cy={yy}
                r={2.6}
                fill="none"
                stroke="var(--warn)"
                style={{ transition: "all 600ms cubic-bezier(0.22,1,0.36,1)" }}
              />
              {isTie && (
                <text
                  x={316}
                  y={yy + 3}
                  textAnchor="end"
                  className="fill-warn font-mono text-[8px]"
                >
                  tie
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[10.5px] text-muted">
        Dot: estimated rank. Band: 90% bootstrap interval. Ring: true rank.
      </p>
    </div>
  );
}
