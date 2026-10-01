import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { pop, progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";

/** Large VERIFIED ✓ / FAILED ✗ stamp with a ring that draws on. */
export const VerificationBadge: React.FC<{
  ok: boolean;
  at: number;
  label?: string;
  size?: number;
  style?: CSSProperties;
}> = ({ ok, at, label, size = 140, style }) => {
  const frame = useCurrentFrame();
  const s = pop(frame, at, 11, 0.7);
  const ring = progress(frame, at, 18);
  const mark = progress(frame, at + 8, 14);
  const color = ok ? C.good : C.bad;
  const r = size / 2 - 6;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size * 0.22,
        opacity: Math.min(1, s * 1.5),
        transform: `scale(${0.8 + 0.2 * s})`,
        ...style,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
        <circle cx={size / 2} cy={size / 2} r={r + 10} fill={color} opacity={0.08 * ring} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - ring}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <path
          d={
            ok
              ? `M${size * 0.3},${size * 0.52} L${size * 0.45},${size * 0.66} L${size * 0.72},${size * 0.37}`
              : `M${size * 0.34},${size * 0.34} L${size * 0.66},${size * 0.66} M${size * 0.66},${size * 0.34} L${size * 0.34},${size * 0.66}`
          }
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - mark}
        />
      </svg>
      {label !== "" ? (
        <div
          style={{
            fontFamily: fonts.mono,
            fontWeight: 600,
            fontSize: size * 0.4,
            letterSpacing: "0.08em",
            color,
            textShadow: `0 0 40px ${color}55`,
          }}
        >
          {label ?? (ok ? "VERIFIED" : "VERIFICATION FAILED")}
        </div>
      ) : null}
    </div>
  );
};
