import { Tag } from "@/components/ui";
import { f2, pct } from "@/lib/format";
import type { Convergence } from "@/lib/types";

// The review-count learning curve. Each point refits the model with every
// project keeping only part of its reviews; the band is the 10th–90th
// percentile of top-N order agreement across those refits, the dashed line
// the share of refits that keep the same prize set. A curve that is already
// flat before the full data means more reviews would change little. When
// write times can order the reviews, the dots show the real trajectory.

const W = 640;
const H = 250;
const PAD = { l: 44, r: 16, t: 14, b: 38 };

export function ConvergenceChart({
  c,
  total,
}: {
  c: Convergence;
  total: number;
}) {
  const curve = c.curve ?? [];
  const arrival = c.arrival ?? [];
  if (curve.length < 2) return null;
  const lo = Math.min(
    0,
    ...curve.map((p) => p.tau_low),
    ...arrival.map((p) => p.tau),
  );
  const xMax = Math.max(total, ...curve.map((p) => p.reviews));
  const x = (v: number) => PAD.l + ((W - PAD.l - PAD.r) * v) / xMax;
  const y = (v: number) => PAD.t + ((H - PAD.t - PAD.b) * (1 - v)) / (1 - lo);
  const line = (pts: [number, number][]) =>
    pts
      .map(
        ([a, b], i) => `${i ? "L" : "M"}${x(a).toFixed(1)} ${y(b).toFixed(1)}`,
      )
      .join(" ");
  const band = `${line(curve.map((p) => [p.reviews, p.tau_high]))} ${[...curve]
    .reverse()
    .map((p) => `L${x(p.reviews).toFixed(1)} ${y(p.tau_low).toFixed(1)}`)
    .join(" ")} Z`;
  const check = curve.find((p) => Math.abs(p.fraction - 0.8) < 1e-9);
  // Keep lo only when it is far enough below 0 for the labels not to collide.
  const ticks = [...(lo < -0.15 ? [lo] : []), 0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={c.settled ? "good" : "warn"}>
          {c.settled ? "Settled" : "Still moving"}
        </Tag>
        <p className="min-w-0 flex-1 text-sm text-ink-2">
          {c.verdict.replace(/^(Settled|Still moving): /, "")}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-4 h-auto w-full"
        role="img"
        aria-label={`Top-${c.top_n} order agreement against reviews kept. ${c.verdict}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(t)}
              y2={y(t)}
              className="stroke-line"
              strokeWidth={1}
            />
            <text
              x={PAD.l - 8}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-muted font-mono text-[10px]"
            >
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(0.9)}
          y2={y(0.9)}
          className="stroke-good"
          strokeDasharray="2 4"
          strokeWidth={1}
        />
        <text
          x={W - PAD.r}
          y={y(0.9) - 4}
          textAnchor="end"
          className="fill-good font-mono text-[10px]"
        >
          τ 0.90 bar
        </text>
        {check && (
          <line
            x1={x(check.reviews)}
            x2={x(check.reviews)}
            y1={PAD.t}
            y2={H - PAD.b}
            className="stroke-line-strong"
            strokeDasharray="3 3"
          />
        )}
        <path d={band} className="fill-accent" opacity={0.14} />
        <path
          d={line(curve.map((p) => [p.reviews, p.tau_mean]))}
          className="stroke-accent"
          fill="none"
          strokeWidth={2}
        />
        <path
          d={line(curve.map((p) => [p.reviews, p.top_k_same]))}
          className="stroke-warn"
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        {curve.map((p) => (
          <circle
            key={p.fraction}
            cx={x(p.reviews)}
            cy={y(p.tau_mean)}
            r={3}
            className="fill-accent"
          >
            <title>
              {`${pct(p.fraction)} of reviews (${p.per_project.toFixed(1)} per project): top-${c.top_n} τ ${f2(p.tau_mean)} (${f2(p.tau_low)}–${f2(p.tau_high)}), same top ${c.top_k} in ${pct(p.top_k_same)}, same winner in ${pct(p.winner_same)}`}
            </title>
          </circle>
        ))}
        {arrival.map((p) => (
          <circle
            key={p.reviews}
            cx={x(p.reviews)}
            cy={y(p.tau)}
            r={2.5}
            className={p.top_k_same ? "fill-ink" : "fill-bad"}
          >
            <title>{`After ${p.reviews} reviews in write order: τ ${f2(p.tau)} vs final, top ${c.top_k} ${p.top_k_same ? "already final" : "not yet final"}`}</title>
          </circle>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <text
            key={t}
            x={x(t * xMax)}
            y={H - PAD.b + 16}
            textAnchor="middle"
            className="fill-muted font-mono text-[10px]"
          >
            {Math.round(t * xMax)}
          </text>
        ))}
        <text
          x={(W + PAD.l) / 2}
          y={H - 6}
          textAnchor="middle"
          className="fill-muted text-[11px]"
        >
          reviews kept
        </text>
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-accent" /> top-{c.top_n} order τ vs all
          reviews, 10–90% band
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-warn" /> same
          top {c.top_k} (share of {c.subsamples} refits)
        </li>
        {arrival.length > 0 ? (
          <li className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-ink" /> real order of
            arrival
            <span className="size-2 rounded-full bg-bad" /> top {c.top_k} not
            yet final
          </li>
        ) : (
          <li className="text-muted">
            No arrival line: these reviews share write times (imported), so
            their order is unknown.
          </li>
        )}
      </ul>
    </div>
  );
}
