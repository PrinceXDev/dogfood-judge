import type { CSSProperties } from "react";
import { C, fonts } from "../lib/theme";
import { LockIcon } from "./Icons";

/** Minimal browser chrome used to frame product UI. */
export const BrowserWindow: React.FC<{
  url: string;
  width: number;
  height: number;
  children: React.ReactNode;
  style?: CSSProperties;
}> = ({ url, width, height, children, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 16,
      overflow: "hidden",
      background: C.surface,
      border: `1px solid ${C.lineStrong}`,
      boxShadow: "0 40px 80px -30px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.02) inset",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
  >
    <div
      style={{
        height: 46,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 18px",
        borderBottom: `1px solid ${C.line}`,
        background: C.surface2,
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85 }} />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          maxWidth: 560,
          margin: "0 auto",
          height: 28,
          borderRadius: 8,
          background: C.bg,
          border: `1px solid ${C.line}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          fontFamily: fonts.mono,
          fontSize: 14,
          color: C.ink2,
        }}
      >
        <LockIcon size={13} color={C.muted} />
        {url}
      </div>
      <div style={{ width: 52 }} />
    </div>
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>{children}</div>
  </div>
);
