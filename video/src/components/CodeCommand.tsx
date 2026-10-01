import type { CSSProperties } from "react";
import { C, fonts } from "../lib/theme";

/** An inline shell command pill: `❯ docker compose up`. */
export const CodeCommand: React.FC<{ children: string; size?: number; style?: CSSProperties }> = ({
  children,
  size = 24,
  style,
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      padding: `${size * 0.45}px ${size * 0.8}px`,
      borderRadius: 10,
      background: C.surface,
      border: `1px solid ${C.lineStrong}`,
      fontFamily: fonts.mono,
      fontSize: size,
      color: C.ink,
      whiteSpace: "pre",
      ...style,
    }}
  >
    <span style={{ color: C.accent }}>❯</span>
    {children}
  </span>
);
