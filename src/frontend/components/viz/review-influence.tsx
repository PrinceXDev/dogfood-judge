"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

// "Find the review that changed everything." Each flagged review carries the
// engine's full-refit answer to one question: where would this project rank
// without that single review? Selecting a review and toggling it off slides
// the project along the rank axis between those two real positions.

export type InfluenceReview = {
  judge: string;
  judgeLabel: string;
  project: string;
  projectLabel: string;
  score: number;
  expected: number;
  z: number;
  rankWith: number;
  rankWithout: number;
};

export function ReviewInfluence({
  reviews,
  total,
}: {
  reviews: InfluenceReview[];
  total: number;
}) {
  const [sel, setSel] = useState(0);
  const [removed, setRemoved] = useState(false);
  const r = reviews[sel];
  if (!r) return null;
  const rank = removed ? r.rankWithout : r.rankWith;
  const delta = r.rankWithout - r.rankWith; // + means the review lifted the project
  const H = 360;
  const y = (k: number) => 14 + ((k - 1) / Math.max(1, total - 1)) * (H - 28);
  const ticks = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div
        className="grid content-start gap-2"
        role="listbox"
        aria-label="Flagged reviews"
      >
        {reviews.map((x, i) => (
          <button
            key={`${x.judge}-${x.project}`}
            type="button"
            role="option"
            aria-selected={i === sel}
            data-nav-item
            onClick={() => {
              setSel(i);
              setRemoved(false);
            }}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${i === sel ? "border-warn/50 bg-warn/[0.07]" : "border-line bg-surface hover:bg-surface-hover"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">
                {x.judgeLabel} → {x.projectLabel}
              </span>
              <span className="font-mono text-xs text-warn">
                z {x.z >= 0 ? "+" : ""}
                {x.z.toFixed(1)}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-muted">
              gave {x.score.toFixed(2)} · model expected {x.expected.toFixed(2)}
            </p>
          </button>
        ))}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Flagged when neither the judge's own leniency and scale nor the other
          judges' view of the project explains the score (|z| ≥ 2.5). A prompt
          to read the review, not an accusation.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            <span className="font-medium text-ink">{r.projectLabel}</span>{" "}
            {removed ? "without" : "with"} this review
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={removed}
            onClick={() => setRemoved((v) => !v)}
            className="flex items-center gap-2 rounded-full border border-line-strong bg-surface-2 py-1 pl-1 pr-3 text-xs font-medium"
          >
            <span
              className={`relative h-5 w-9 rounded-full transition-colors ${removed ? "bg-warn" : "bg-line-strong"}`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-bg transition-transform ${removed ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </span>
            Remove this review
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-6">
          <svg
            viewBox={`0 0 220 ${H}`}
            className="h-[360px] w-full"
            role="img"
            aria-label={`${r.projectLabel} ranks #${r.rankWith} with the review and #${r.rankWithout} without it.`}
          >
            <line
              x1={40}
              x2={40}
              y1={y(1)}
              y2={y(total)}
              stroke="var(--line-strong)"
            />
            {ticks.map((k) => (
              <g key={k}>
                <line
                  x1={36}
                  x2={44}
                  y1={y(k)}
                  y2={y(k)}
                  stroke="var(--line-strong)"
                />
                {(k === 1 || k % 5 === 0 || k === total) && (
                  <text
                    x={28}
                    y={y(k) + 3}
                    textAnchor="end"
                    className="fill-muted font-mono text-[9px]"
                  >
                    #{k}
                  </text>
                )}
              </g>
            ))}
            <line
              x1={40}
              x2={40}
              y1={y(r.rankWith)}
              y2={y(r.rankWithout)}
              stroke="var(--warn)"
              strokeWidth={3}
              strokeDasharray="3 4"
              opacity={removed ? 0.8 : 0}
              style={{ transition: "opacity 400ms" }}
            />
            <circle
              cx={40}
              cy={y(r.rankWith)}
              r={4}
              fill="none"
              stroke="var(--muted)"
              strokeDasharray="2 2"
            />
            <g
              style={{
                transform: `translateY(${y(rank)}px)`,
                transition: "transform 900ms cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              <circle
                cx={40}
                cy={0}
                r={7}
                fill={removed ? "var(--warn)" : "var(--accent)"}
                style={{ transition: "fill 300ms" }}
              />
              <rect
                x={56}
                y={-13}
                width={150}
                height={26}
                rx={6}
                fill="var(--surface-2)"
                stroke="var(--line-strong)"
              />
              <text x={66} y={4} className="fill-ink font-mono text-[11px]">
                {r.project} · #{rank}
              </text>
            </g>
          </svg>
          <div className="w-36 text-right">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              with → without
            </p>
            <p className="mt-2 font-mono text-3xl tabular">
              #{r.rankWith}
              <Icon
                name="arrowRight"
                size={18}
                className="mx-1 inline text-muted"
              />
              <span className="text-warn">#{r.rankWithout}</span>
            </p>
            <p className="mt-3 text-xs leading-relaxed text-ink-2">
              {delta > 0
                ? `This one review lifted the project ${delta} place${delta === 1 ? "" : "s"}.`
                : delta < 0
                  ? `This one review cost the project ${-delta} place${delta === -1 ? "" : "s"}.`
                  : "This review does not move the project's rank."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
