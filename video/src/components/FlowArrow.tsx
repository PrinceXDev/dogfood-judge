import { useCurrentFrame } from "remotion";
import { progress } from "../lib/anim";
import { C } from "../lib/theme";

/** An SVG arrow from (x1,y1) to (x2,y2) that draws itself in. */
export const FlowArrow: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  at?: number;
  dur?: number;
  color?: string;
  width?: number;
  curve?: number;
  dashed?: boolean;
}> = ({ x1, y1, x2, y2, at = 0, dur = 18, color = C.lineStrong, width = 2, curve = 0, dashed }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, dur);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - curve;
  const d = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
  const angle = Math.atan2(y2 - my, x2 - mx);
  const head = 12;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={width}
        pathLength={1}
        strokeDasharray={dashed ? "0.02 0.015" : 1}
        strokeDashoffset={dashed ? 0 : 1 - p}
        opacity={dashed ? p : 1}
        strokeLinecap="round"
      />
      {p > 0.95 ? (
        <path
          d={`M${x2 - head * Math.cos(angle - 0.45)},${y2 - head * Math.sin(angle - 0.45)} L${x2},${y2} L${
            x2 - head * Math.cos(angle + 0.45)
          },${y2 - head * Math.sin(angle + 0.45)}`}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
};
