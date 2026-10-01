import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { pop } from "../lib/anim";
import { C, fonts } from "../lib/theme";

/** A labelled metric tile: mono label on top, value below. */
export const MetricBadge: React.FC<{
  label: string;
  value: React.ReactNode;
  at?: number;
  tone?: "accent" | "warn" | "bad" | "good" | "ink";
  width?: number;
  sub?: React.ReactNode;
  style?: CSSProperties;
}> = ({ label, value, at = 0, tone = "ink", width = 300, sub, style }) => {
  const frame = useCurrentFrame();
  const s = pop(frame, at);
  const color = { accent: C.accent, warn: C.warn, bad: C.bad, good: C.good, ink: C.ink }[tone];
  return (
    <div
      style={{
        width,
        padding: "20px 24px",
        borderRadius: 14,
        background: C.surface,
        border: `1px solid ${C.line}`,
        opacity: s,
        transform: `translateY(${(1 - s) * 20}px) scale(${0.96 + 0.04 * s})`,
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 15,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: C.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: fonts.sans,
          fontWeight: 600,
          fontSize: 44,
          letterSpacing: "-0.03em",
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ marginTop: 6, fontFamily: fonts.sans, fontSize: 18, color: C.ink2 }}>{sub}</div> : null}
    </div>
  );
};
