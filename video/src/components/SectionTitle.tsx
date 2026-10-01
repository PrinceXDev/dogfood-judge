import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { progress, rise } from "../lib/anim";
import { C, fonts } from "../lib/theme";

/** Mono eyebrow + large heading, revealed with a mask wipe. */
export const SectionTitle: React.FC<{
  eyebrow?: string;
  title: React.ReactNode;
  at?: number;
  size?: number;
  serif?: boolean;
  align?: "left" | "center";
  style?: CSSProperties;
  color?: string;
}> = ({ eyebrow, title, at = 0, size = 76, serif, align = "left", style, color = C.ink }) => {
  const frame = useCurrentFrame();
  const wipe = progress(frame, at + 4, 26);
  return (
    <div style={{ textAlign: align, ...style }}>
      {eyebrow ? (
        <div
          style={{
            ...rise(frame, at, 12, 18),
            fontFamily: fonts.mono,
            fontSize: 20,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: C.accent,
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 14,
            justifyContent: align === "center" ? "center" : "flex-start",
          }}
        >
          <span style={{ width: 28, height: 1.5, background: C.accent, display: "inline-block" }} />
          {eyebrow}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: serif ? fonts.serif : fonts.sans,
          fontStyle: serif ? "italic" : "normal",
          fontWeight: serif ? 400 : 600,
          fontSize: size,
          lineHeight: 1.05,
          letterSpacing: serif ? "-0.01em" : "-0.035em",
          color,
          clipPath: `inset(-10% ${(1 - wipe) * 100}% -20% 0)`,
          transform: `translateY(${(1 - wipe) * 14}px)`,
        }}
      >
        {title}
      </div>
    </div>
  );
};
