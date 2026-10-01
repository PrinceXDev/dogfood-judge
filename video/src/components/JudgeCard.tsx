import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { pop, progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";
import { UserIcon } from "./Icons";

/**
 * A judge with the scores they gave, and a histogram of where on the 1–10
 * scale those scores fall, so "this judge only uses 5 and 6" is visible.
 */
export const JudgeCard: React.FC<{
  name: string;
  tag: string;
  scores: number[];
  tone: string;
  at: number;
  width?: number;
  style?: CSSProperties;
}> = ({ name, tag, scores, tone, at, width = 460, style }) => {
  const frame = useCurrentFrame();
  const s = pop(frame, at);
  const counts = Array.from({ length: 10 }, (_, i) => scores.filter((x) => x === i + 1).length);
  const max = Math.max(...counts, 1);
  return (
    <div
      style={{
        width,
        padding: 28,
        borderRadius: 18,
        background: C.surface,
        border: `1px solid ${C.line}`,
        opacity: s,
        transform: `translateY(${(1 - s) * 40}px)`,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            background: `${tone}1f`,
            border: `1px solid ${tone}66`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <UserIcon size={26} color={tone} />
        </div>
        <div>
          <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 28, color: C.ink }}>{name}</div>
          <div style={{ fontFamily: fonts.mono, fontSize: 16, color: tone }}>{tag}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
        {scores.map((v, i) => {
          const p = pop(frame, at + 8 + i * 4, 14);
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: 74,
                borderRadius: 12,
                background: C.surface2,
                border: `1px solid ${C.lineStrong}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: fonts.mono,
                fontWeight: 600,
                fontSize: 38,
                color: C.ink,
                opacity: p,
                transform: `scale(${0.7 + 0.3 * p})`,
              }}
            >
              {v}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70, marginTop: 26 }}>
        {counts.map((c, i) => {
          const h = progress(frame, at + 22 + i, 16) * (c / max);
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: "100%",
                  height: Math.max(3, h * 46),
                  borderRadius: 4,
                  background: c ? tone : C.line,
                  opacity: c ? 0.9 : 1,
                }}
              />
              <span style={{ fontFamily: fonts.mono, fontSize: 13, color: C.muted }}>{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
