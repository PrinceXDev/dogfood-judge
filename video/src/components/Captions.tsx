import { useCurrentFrame } from "remotion";
import { progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";
import { type Beat, TIMELINE } from "../lib/timeline";

const BEATS: Beat[] = TIMELINE.flatMap((s) => s.beats);
const MAX_WORDS = 9;

// Split a line into short phrases at sentence and clause breaks, so a caption
// never runs past two lines.
const chunk = (text: string): string[] => {
  // Break only after punctuation followed by a space, so "Next.js" stays whole.
  const parts = text.split(/(?<=[.?!:;,])\s+/).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const words = part.split(/\s+/);
    const prev = out[out.length - 1];
    if (prev && prev.split(/\s+/).length + words.length <= MAX_WORDS && !/[.?!]$/.test(prev)) {
      out[out.length - 1] = `${prev} ${part}`;
      continue;
    }
    for (let i = 0; i < words.length; i += MAX_WORDS) out.push(words.slice(i, i + MAX_WORDS).join(" "));
  }
  return out;
};

const CHUNKS = BEATS.flatMap((b) => {
  const parts = chunk(b.text);
  const total = parts.reduce((n, p) => n + p.length, 0);
  let t = b.abs;
  return parts.map((text) => {
    const dur = Math.max(12, Math.round((text.length / total) * b.dur));
    const c = { text, from: t, to: t + dur };
    t += dur;
    return c;
  });
});

/** Burned-in subtitles, kept left of the presenter badge. */
export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const c = CHUNKS.find((x) => frame >= x.from && frame < x.to + 4);
  if (!c) return null;
  const p = progress(frame, c.from, 6);
  return (
    <div
      style={{
        position: "absolute",
        left: 100,
        width: 1280,
        bottom: 62,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          padding: "12px 26px",
          borderRadius: 12,
          background: "rgba(4, 5, 5, 0.78)",
          border: `1px solid ${C.line}`,
          fontFamily: fonts.sans,
          fontWeight: 500,
          fontSize: 34,
          lineHeight: 1.3,
          color: C.ink,
          textAlign: "center",
          letterSpacing: "-0.01em",
          opacity: p,
          transform: `translateY(${(1 - p) * 6}px)`,
        }}
      >
        {c.text}
      </div>
    </div>
  );
};
