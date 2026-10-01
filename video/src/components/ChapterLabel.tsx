import { useCurrentFrame } from "remotion";
import { progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";
import { TIMELINE, TOTAL_FRAMES } from "../lib/timeline";
import { LogoMark } from "./Logo";

/**
 * Top bar: chapter number and name on the left, mark on the right, and a thin
 * progress line, so a judge always knows where they are in the story.
 */
export const ChapterLabel: React.FC = () => {
  const frame = useCurrentFrame();
  const scene = TIMELINE.find((s) => frame >= s.from && frame < s.from + s.duration) ?? TIMELINE[0];
  // Hidden during the cold open and the end card.
  if (scene.id === "intro" || scene.id === "final") return null;
  const local = frame - scene.from;
  const p = Math.min(progress(frame, scene.from + 6, 16), 1 - progress(local, scene.duration - 10, 8));
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, height: 3, width: `${(frame / TOTAL_FRAMES) * 100}%`, background: C.accent, opacity: 0.7 }} />
      <div
        style={{
          position: "absolute",
          left: 64,
          top: 44,
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontFamily: fonts.mono,
          fontSize: 17,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          opacity: p,
        }}
      >
        <span style={{ color: C.accent }}>{String(scene.index).padStart(2, "0")}</span>
        <span style={{ width: 24, height: 1, background: C.lineStrong }} />
        <span style={{ color: C.ink2 }}>{scene.title}</span>
      </div>
      <div style={{ position: "absolute", right: 64, top: 36, opacity: 0.8 }}>
        <LogoMark size={36} id="chapter" />
      </div>
    </>
  );
};
