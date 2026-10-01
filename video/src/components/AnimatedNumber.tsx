import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { progress } from "../lib/anim";

/** Counts from `from` to `to` between frames `at` and `at + dur`. */
export const AnimatedNumber: React.FC<{
  to: number;
  from?: number;
  at?: number;
  dur?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: CSSProperties;
}> = ({ to, from = 0, at = 0, dur = 30, decimals = 0, prefix = "", suffix = "", style }) => {
  const frame = useCurrentFrame();
  const v = from + (to - from) * progress(frame, at, dur);
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
};
