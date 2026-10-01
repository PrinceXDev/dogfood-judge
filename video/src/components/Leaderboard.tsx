import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { easeInOut, progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";

export type BoardRow = {
  id: string;
  title: string;
  sub?: string;
  value?: string;
};

/** A keyframe: from frame `at`, rows sit in `order` (ids, top to bottom). */
export type BoardOrder = { at: number; order: string[] };

/**
 * A ranked list whose rows glide between orderings. Rows not in an ordering
 * keep their last position, so partial orders work for "the top changes".
 */
export const Leaderboard: React.FC<{
  rows: BoardRow[];
  orders: BoardOrder[];
  width?: number;
  rowHeight?: number;
  highlight?: string | null;
  highlightColor?: string;
  dim?: (id: string) => number;
  moveFrames?: number;
  right?: (row: BoardRow, index: number) => React.ReactNode;
  style?: CSSProperties;
  showRank?: boolean;
}> = ({
  rows,
  orders,
  width = 720,
  rowHeight = 72,
  highlight,
  highlightColor = C.accent,
  dim,
  moveFrames = 12,
  right,
  style,
  showRank = true,
}) => {
  const frame = useCurrentFrame();
  const indexAt = (id: string, k: number) => {
    const i = orders[k].order.indexOf(id);
    return i === -1 ? rows.findIndex((r) => r.id === id) : i;
  };
  const position = (id: string) => {
    let y = indexAt(id, 0);
    for (let k = 1; k < orders.length; k++) {
      const p = progress(frame, orders[k].at, moveFrames, easeInOut);
      y += (indexAt(id, k) - indexAt(id, k - 1)) * p;
    }
    return y;
  };
  return (
    <div style={{ position: "relative", width, height: rows.length * rowHeight, ...style }}>
      {rows.map((row) => {
        const y = position(row.id);
        const rank = Math.round(y) + 1;
        const hot = highlight === row.id;
        const o = dim ? dim(row.id) : 1;
        return (
          <div
            key={row.id}
            style={{
              position: "absolute",
              left: 0,
              top: y * rowHeight,
              width,
              height: rowHeight - 10,
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "0 22px",
              borderRadius: 12,
              background: hot ? `${highlightColor}14` : C.surface,
              border: `1px solid ${hot ? highlightColor : C.line}`,
              boxShadow: hot ? `0 0 40px -10px ${highlightColor}88` : "none",
              opacity: o,
              zIndex: hot ? 2 : 1,
            }}
          >
            {showRank ? (
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: rowHeight * 0.3,
                  width: rowHeight * 0.55,
                  color: hot ? highlightColor : C.muted,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {String(rank).padStart(2, "0")}
              </span>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: fonts.sans,
                  fontWeight: 600,
                  fontSize: rowHeight * 0.32,
                  color: C.ink,
                  letterSpacing: "-0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                {row.title}
              </div>
              {row.sub ? (
                <div style={{ fontFamily: fonts.mono, fontSize: rowHeight * 0.19, color: C.muted, marginTop: 2 }}>
                  {row.sub}
                </div>
              ) : null}
            </div>
            {right ? right(row, rank - 1) : null}
            {row.value ? (
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: rowHeight * 0.3,
                  color: hot ? highlightColor : C.ink2,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {row.value}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
