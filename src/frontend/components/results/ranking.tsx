import Link from "next/link";
import { Tag } from "@/components/ui";
import { f2, pct } from "@/lib/format";
import type { ResultRow } from "@/lib/types";

// The ranking, with its uncertainty drawn inline: each row shows the 90%
// bootstrap rank interval as a band on a track of every rank, the chance of
// finishing in the top k, and whether the gap to the next project is a
// statistical tie. `detail` adds the organizer-only columns.

export function RankingTable({
  rows,
  k,
  detail = false,
}: {
  rows: ResultRow[];
  k: number;
  detail?: boolean;
}) {
  const ranked = rows.filter((r) => r.ranks.biasscale);
  const n = Math.max(1, ranked.length);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
            <th className="w-14 px-4 py-2.5 text-right font-medium">#</th>
            <th className="px-3 py-2.5 font-medium">Project</th>
            <th className="px-3 py-2.5 text-right font-medium">Score</th>
            <th className="w-[22%] px-3 py-2.5 font-medium">
              90% rank interval
            </th>
            <th className="px-3 py-2.5 text-right font-medium">P(top {k})</th>
            <th className="px-3 py-2.5 text-right font-medium">
              Ahead of next
            </th>
            {detail && (
              <th className="px-3 py-2.5 text-right font-medium">Raw → Δ</th>
            )}
            <th className="px-4 py-2.5 text-right font-medium">Reviews</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const rank = x.ranks.biasscale;
            const prize = rank && rank <= k;
            const tie = x.ahead_of_next > 0 && x.ahead_of_next < 0.75;
            return (
              <tr
                key={x.project.id}
                className={`border-b border-line last:border-0 transition-colors hover:bg-surface-hover/60 ${prize ? "bg-accent/[0.03]" : ""}`}
              >
                <td className="px-4 py-3 text-right align-middle">
                  <span
                    className={`font-mono text-lg tabular ${prize ? "text-accent" : rank ? "text-ink" : "text-muted"}`}
                  >
                    {rank ?? "·"}
                  </span>
                </td>
                <td className="min-w-[240px] px-3 py-3 align-middle">
                  <Link
                    href={`/p/${x.project.id}`}
                    data-nav-item
                    className="font-medium hover:text-accent"
                  >
                    {x.project.title}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {x.project.team_name}
                    {x.project.track_name ? ` · ${x.project.track_name}` : ""}
                    {detail && (
                      <span className="ml-2 font-mono">{x.project.id}</span>
                    )}
                  </p>
                </td>
                <td className="px-3 py-3 text-right align-middle font-mono tabular">
                  {x.scores.biasscale !== undefined ? (
                    <>
                      <span className="text-ink">{f2(x.scores.biasscale)}</span>
                      <span className="ml-1 text-[11px] text-muted">
                        ±{f2(x.se)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">·</span>
                  )}
                </td>
                <td className="px-3 py-3 align-middle">
                  {rank ? (
                    <div className="flex items-center gap-2.5">
                      <div
                        className="relative h-3 flex-1"
                        role="img"
                        aria-label={`Rank ${rank}, 90% interval ${x.rank_low} to ${x.rank_high} of ${n}`}
                      >
                        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
                        <div
                          className={`absolute inset-y-0 rounded-full ${prize ? "bg-accent/30" : "bg-accent-2/20"}`}
                          style={{
                            left: `${(100 * (x.rank_low - 1)) / n}%`,
                            width: `${Math.max(1.5, (100 * (x.rank_high - x.rank_low + 1)) / n)}%`,
                          }}
                        />
                        <div
                          className={`absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${prize ? "bg-accent" : "bg-accent-2"}`}
                          style={{ left: `${(100 * (rank - 0.5)) / n}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted">
                        {x.rank_low}–{x.rank_high}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">not yet reviewed</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right align-middle">
                  {x.reviews ? (
                    <div className="ml-auto flex w-24 items-center justify-end gap-2">
                      <div className="h-1 w-10 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: pct(x.prob_top_k) }}
                        />
                      </div>
                      <span className="w-9 font-mono text-xs tabular">
                        {pct(x.prob_top_k)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted">·</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular">
                  {x.ahead_of_next ? (
                    <span className={tie ? "text-warn" : "text-ink-2"}>
                      {pct(x.ahead_of_next)}
                      {tie && (
                        <span className="ml-1.5 rounded-sm bg-warn/15 px-1 text-[10px]">
                          tie
                        </span>
                      )}
                    </span>
                  ) : (
                    ""
                  )}
                </td>
                {detail && (
                  <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular">
                    <span className="text-muted">{x.ranks.raw ?? "·"}</span>{" "}
                    <span
                      className={
                        x.rank_change > 0
                          ? "text-good"
                          : x.rank_change < 0
                            ? "text-bad"
                            : "text-muted"
                      }
                    >
                      {x.rank_change > 0
                        ? `▲${x.rank_change}`
                        : x.rank_change < 0
                          ? `▼${-x.rank_change}`
                          : "·"}
                    </span>
                  </td>
                )}
                <td className="px-4 py-3 text-right align-middle font-mono text-xs tabular">
                  {x.reviews}
                  {x.provisional && (
                    <Tag tone="warn" className="ml-2">
                      {x.reviews ? "few" : "none"}
                    </Tag>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
