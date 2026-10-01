import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";

/** A horizontal bar for a probability (0–1) with the value beside it. */
export const ProbabilityBar: React.FC<{
  value: number;
  at?: number;
  width?: number;
  height?: number;
  color?: string;
  showValue?: boolean;
  /** Draw a tick at 50%, where a prize is a coin flip. */
  midline?: boolean;
  style?: CSSProperties;
}> = ({ value, at = 0, width = 260, height = 10, color = C.accent, showValue = true, midline, style }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 26) * value;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, ...style }}>
      <div
        style={{
          position: "relative",
          width,
          height,
          borderRadius: height,
          background: C.surface2,
          border: `1px solid ${C.line}`,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${p * 100}%`, height: "100%", background: color, borderRadius: height }} />
        {midline ? (
          <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1.5, background: C.ink2, opacity: 0.6 }} />
        ) : null}
      </div>
      {showValue ? (
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: height * 2.1,
            color: C.ink,
            minWidth: 64,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(p * 100)}%
        </span>
      ) : null}
    </div>
  );
};
