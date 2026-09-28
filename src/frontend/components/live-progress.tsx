"use client";

import { useEffect, useState } from "react";
import { Bar, Panel, StatusDot } from "@/components/ui";
import type { Progress } from "@/lib/types";

/**
 * The organizer's live judging health. Polls the progress endpoint every five
 * seconds through the same-origin /api proxy (the session cookie rides along;
 * read-only requests need no CSRF token), and pauses while the tab is hidden.
 */
export function LiveProgress({
  initial,
  target,
}: {
  initial: Progress;
  target: number;
}) {
  const [p, setP] = useState(initial);
  const [updated, setUpdated] = useState<string>("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/v1/events/${initial.event_id}/progress`, {
          credentials: "same-origin",
        });
        if (r.ok && !stop) {
          const next: Progress = await r.json();
          setP((prev) => {
            if (prev.done !== next.done || prev.votes !== next.votes) {
              setFlash(true);
              setTimeout(() => setFlash(false), 900);
            }
            return next;
          });
          setUpdated(new Date().toLocaleTimeString());
        }
      } catch {
        // offline for a moment; the next tick retries
      }
    };
    const id = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [initial.event_id]);

  const judges = p.judges ?? [];
  const active = judges.filter((j) => j.done > 0).length;
  const remaining = Math.max(0, p.assignments - p.done);
  const hist = Object.entries(p.review_histogram ?? {})
    .map(([k, v]) => [Number(k), v] as const)
    .sort((a, b) => a[0] - b[0]);
  const maxBar = Math.max(1, ...hist.map(([, v]) => v));

  const metrics: [string, string, string, string?][] = [
    [
      "Fully reviewed",
      `${p.fully_reviewed}/${p.projects}`,
      `≥ ${target} reviews`,
    ],
    [
      "Reviews remaining",
      String(remaining),
      `${p.done} of ${p.assignments} done`,
    ],
    [
      "Judge utilization",
      judges.length ? `${active}/${judges.length}` : "·",
      "judges with ≥ 1 review",
    ],
    [
      "Under-assigned",
      String(p.unassigned),
      `fewer than ${target} reviewers`,
      p.unassigned ? "warn" : undefined,
    ],
    ["Pairwise", String(p.comparisons), "comparisons"],
    [
      "Community votes",
      String(p.votes),
      p.flagged_votes ? `${p.flagged_votes} held for review` : "none held",
      p.flagged_votes ? "warn" : undefined,
    ],
  ];

  return (
    <Panel
      title="Judging health"
      icon="gavel"
      aside={
        <span className="flex items-center gap-2 font-mono">
          <StatusDot tone="good" pulse />
          live{updated && ` · ${updated}`}
        </span>
      }
      bodyClass="p-0"
    >
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs text-muted">Judging complete</p>
              <p
                className={`font-mono text-5xl font-medium tabular transition-colors duration-500 ${flash ? "text-ink" : "text-accent"}`}
              >
                {Math.round(p.percent)}
                <span className="text-2xl text-muted">%</span>
              </p>
            </div>
            <p className="pb-2 text-right text-xs text-muted">
              {p.projects} submitted · {p.drafts} draft
              {p.drafts === 1 ? "" : "s"}
            </p>
          </div>
          <Bar
            value={p.percent}
            className="mt-3 h-2"
            label="Judging complete"
          />
          <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
            {metrics.map(([k, v, s, tone]) => (
              <div key={k} className="bg-surface px-3.5 py-3">
                <dt className="text-[11px] text-muted">{k}</dt>
                <dd
                  className={`mt-1 font-mono text-lg tabular ${tone === "warn" ? "text-warn" : "text-ink"}`}
                >
                  {v}
                </dd>
                <dd className="text-[10.5px] text-muted">{s}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-lg border border-line bg-surface-2/50 p-4">
          <p className="text-xs text-muted">Completed reviews per project</p>
          <div
            className="mt-3 flex h-32 items-end gap-1.5"
            role="img"
            aria-label={hist
              .map(([n, v]) => `${v} projects with ${n} reviews`)
              .join(", ")}
          >
            {hist.map(([n, v]) => (
              <div
                key={n}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1 font-mono text-[10px] text-muted"
              >
                <span>{v}</span>
                <div
                  className={`w-full rounded-t-sm ${n >= target ? "bg-accent" : "bg-warn/70"}`}
                  style={{ height: `${(100 * v) / maxBar}%` }}
                />
                <span>{n}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-muted">
            x: reviews done · amber: below target
          </p>
        </div>
      </div>
      {!!judges.length && (
        <div className="border-t border-line">
          <p className="px-5 pt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            Judges · least complete first
          </p>
          <ul className="grid gap-x-8 px-5 pb-5 pt-2 sm:grid-cols-2">
            {judges.map((j) => (
              <li
                key={j.id}
                className="grid grid-cols-[minmax(0,1fr)_90px_48px] items-center gap-3 border-b border-line py-2 text-sm last:border-0"
              >
                <span className="truncate">
                  {j.name}
                  {j.last_review_at && (
                    <span className="ml-2 font-mono text-[10.5px] text-muted">
                      {j.last_review_at.slice(11, 16)}
                    </span>
                  )}
                </span>
                <Bar
                  value={j.assigned ? (100 * j.done) / j.assigned : 0}
                  tone={j.done >= j.assigned && j.assigned ? "good" : "accent"}
                />
                <span className="text-right font-mono text-xs tabular text-ink-2">
                  {j.done}/{j.assigned}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
