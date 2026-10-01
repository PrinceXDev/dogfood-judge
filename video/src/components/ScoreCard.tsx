import type { CSSProperties } from "react";
import { C, fonts } from "../lib/theme";

/** One review as a small card: judge → project, with the score. */
export const ScoreCard: React.FC<{
  judge: string;
  project: string;
  score: string;
  tone?: string;
  width?: number;
  style?: CSSProperties;
}> = ({ judge, project, score, tone = C.ink2, width = 210, style }) => (
  <div
    style={{
      width,
      padding: "12px 14px",
      borderRadius: 10,
      background: C.surface,
      border: `1px solid ${C.line}`,
      display: "flex",
      alignItems: "center",
      gap: 12,
      ...style,
    }}
  >
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 12, color: C.muted }}>{judge}</div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 500,
          fontSize: 16,
          color: C.ink,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {project}
      </div>
    </div>
    <div style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 22, color: tone }}>{score}</div>
  </div>
);
