import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { C, fonts } from "../lib/theme";
import { Sfx } from "./Sfx";

export type TermLine = {
  /** Frame (relative to the enclosing sequence) where the line starts. */
  at: number;
  text: string;
  /** cmd lines are typed out after a `$` prompt; the rest appear at once. */
  kind?: "cmd" | "out" | "ok" | "fail" | "dim" | "accent" | "warn";
  /** Characters typed per frame for cmd lines. */
  speed?: number;
};

const COLORS: Record<NonNullable<TermLine["kind"]>, string> = {
  cmd: C.ink,
  out: C.ink2,
  ok: C.good,
  fail: C.bad,
  dim: C.muted,
  accent: C.accent,
  warn: C.warn,
};

/** Marks a leading OK / FAIL / PASS token in its own colour, like the CLI. */
const Colored: React.FC<{ text: string; kind: NonNullable<TermLine["kind"]> }> = ({ text, kind }) => {
  const m = text.match(/^(OK|FAIL|PASS|✓|✗)(\s.*)$/);
  if (m) {
    const good = m[1] === "OK" || m[1] === "PASS" || m[1] === "✓";
    return (
      <>
        <span style={{ color: good ? C.good : C.bad, fontWeight: 600 }}>{m[1]}</span>
        <span style={{ color: C.ink2 }}>{m[2]}</span>
      </>
    );
  }
  const pass = text.match(/^(.*?)(\s\.{3,}\s)(PASS)$/);
  if (pass) {
    return (
      <>
        <span style={{ color: C.ink2 }}>{pass[1]}</span>
        <span style={{ color: C.lineStrong }}>{pass[2]}</span>
        <span style={{ color: C.good, fontWeight: 600 }}>{pass[3]}</span>
      </>
    );
  }
  return <span style={{ color: COLORS[kind] }}>{text}</span>;
};

export const TerminalWindow: React.FC<{
  lines: TermLine[];
  width: number;
  height: number;
  title?: string;
  fontSize?: number;
  style?: CSSProperties;
  typingSound?: boolean;
}> = ({ lines, width, height, title = "zsh — dogfood-judge", fontSize = 22, style, typingSound = true }) => {
  const frame = useCurrentFrame();
  const visible = lines.filter((l) => frame >= l.at);
  const last = visible[visible.length - 1];
  const lineHeight = fontSize * 1.55;
  const maxRows = Math.floor((height - 70) / lineHeight);
  const shown = visible.slice(-maxRows);
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 16,
        overflow: "hidden",
        background: "#070a0a",
        border: `1px solid ${C.lineStrong}`,
        boxShadow: "0 40px 80px -30px rgba(0,0,0,0.9)",
        ...style,
      }}
    >
      <div
        style={{
          height: 42,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 8,
          borderBottom: `1px solid ${C.line}`,
          background: C.surface2,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85 }} />
        ))}
        <span style={{ flex: 1, textAlign: "center", fontFamily: fonts.mono, fontSize: 14, color: C.muted }}>
          {title}
        </span>
        <span style={{ width: 52 }} />
      </div>
      <div style={{ padding: "18px 26px", fontFamily: fonts.mono, fontSize, lineHeight: `${lineHeight}px` }}>
        {shown.map((l) => {
          const kind = l.kind ?? "out";
          if (kind === "cmd") {
            const typed = Math.floor((frame - l.at) * (l.speed ?? 1.4));
            const text = l.text.slice(0, typed);
            const typing = typed < l.text.length;
            const cursorOn = l === last && (typing || Math.floor(frame / 15) % 2 === 0);
            return (
              <div key={`${l.at}-${l.text}`} style={{ whiteSpace: "pre" }}>
                <span style={{ color: C.accent }}>❯ </span>
                <span style={{ color: C.ink }}>{text}</span>
                {cursorOn ? (
                  <span
                    style={{
                      display: "inline-block",
                      width: fontSize * 0.55,
                      height: fontSize * 1.1,
                      background: C.accent,
                      verticalAlign: "text-bottom",
                      marginLeft: 2,
                    }}
                  />
                ) : null}
              </div>
            );
          }
          return (
            <div key={`${l.at}-${l.text}`} style={{ whiteSpace: "pre" }}>
              <Colored text={l.text} kind={kind} />
            </div>
          );
        })}
      </div>
      {typingSound
        ? lines
            .filter((l) => l.kind === "cmd")
            .flatMap((l) => {
              const frames = Math.ceil(l.text.length / (l.speed ?? 1.4));
              return Array.from({ length: Math.ceil(frames / 3) }, (_, i) => (
                <Sfx key={`${l.at}-${i}`} name="key" at={l.at + i * 3} volume={0.7 + ((i * 37) % 5) / 10} />
              ));
            })
        : null}
    </div>
  );
};
