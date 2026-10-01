import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";

/**
 * A 90% rank interval on a 1..maxRank axis: a band from `lo` to `hi` with a dot
 * at the point estimate, like the results page's rank strips.
 */
export const RankInterval: React.FC<{
  lo: number;
  hi: number;
  rank: number;
  maxRank?: number;
  at?: number;
  width?: number;
  color?: string;
  labels?: boolean;
  style?: CSSProperties;
}> = ({ lo, hi, rank, maxRank = 10, at = 0, width = 420, color = C.accent, labels = true, style }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 28);
  const x = (r: number) => ((r - 1) / (maxRank - 1)) * width;
  const center = x(rank);
  const left = center - (center - x(lo)) * p;
  const right = center + (x(hi) - center) * p;
  return (
    <div style={{ width, ...style }}>
      <div style={{ position: "relative", height: 28 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 13, height: 2, background: C.line }} />
        {Array.from({ length: maxRank }, (_, i) => (
          <div key={i} style={{ position: "absolute", left: x(i + 1) - 1, top: 9, width: 2, height: 10, background: C.lineStrong }} />
        ))}
        <div
          style={{
            position: "absolute",
            left,
            width: right - left,
            top: 6,
            height: 16,
            borderRadius: 8,
            background: `${color}33`,
            border: `1.5px solid ${color}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: center - 8,
            top: 6,
            width: 16,
            height: 16,
            borderRadius: 8,
            background: color,
            boxShadow: `0 0 18px ${color}`,
          }}
        />
      </div>
      {labels ? (
        <div
          style={{
            position: "relative",
            height: 22,
            marginTop: 6,
            fontFamily: fonts.mono,
            fontSize: 15,
            color: C.muted,
          }}
        >
          {Array.from({ length: maxRank }, (_, i) => (
            <span key={i} style={{ position: "absolute", left: x(i + 1) - 10, width: 20, textAlign: "center" }}>
              {i + 1}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};
