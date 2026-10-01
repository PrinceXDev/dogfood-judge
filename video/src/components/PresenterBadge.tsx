import { Img, staticFile, useCurrentFrame } from "remotion";
import { lerp, progress } from "../lib/anim";
import { C, fonts, LINKS } from "../lib/theme";
import { type Beat, TIMELINE } from "../lib/timeline";
import { GithubIcon, LinkedinIcon } from "./Icons";

const BEATS: Beat[] = TIMELINE.flatMap((s) => s.beats);

/** 0..1: how much the narrator is speaking at this frame, with soft edges. */
const speaking = (frame: number) => {
  let v = 0;
  for (const b of BEATS) {
    if (frame < b.abs - 6 || frame > b.abs + b.dur + 6) continue;
    v = Math.max(v, Math.min(lerp(frame, [b.abs - 4, b.abs + 2], [0, 1]), lerp(frame, [b.abs + b.dur - 2, b.abs + b.dur + 6], [1, 0])));
  }
  return v;
};

/**
 * The narrator, bottom-right on every screen: photo with a live "speaking"
 * ring and voice bars, name, and where to find the project.
 */
export const PresenterBadge: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const frame = useCurrentFrame();
  const talk = speaking(frame);
  const enter = progress(frame, 12, 24);
  const size = 132;
  const bars = [0, 1, 2, 3, 4].map((i) => {
    const wobble =
      0.5 + 0.3 * Math.sin(frame * (0.55 + i * 0.13) + i * 1.7) + 0.2 * Math.sin(frame * (1.31 + i * 0.07) + i);
    return 0.18 + 0.82 * talk * wobble;
  });
  return (
    <div
      style={{
        position: "absolute",
        right: 40,
        bottom: 40,
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "14px 14px 14px 24px",
        borderRadius: 999,
        background: "rgba(8, 11, 11, 0.86)",
        border: `1px solid ${C.lineStrong}`,
        boxShadow: "0 24px 50px -20px rgba(0,0,0,0.9)",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 30}px)`,
      }}
    >
      {!compact ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 3, height: 18 }}>
              {bars.map((h, i) => (
                <span key={i} style={{ width: 3, height: 18 * h, borderRadius: 2, background: C.accent, opacity: 0.4 + 0.6 * talk }} />
              ))}
            </div>
            <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 24, color: C.ink, letterSpacing: "-0.02em" }}>
              {LINKS.name}
            </span>
          </div>
          <span style={{ fontFamily: fonts.mono, fontSize: 14, color: C.accent, letterSpacing: "0.06em" }}>
            {LINKS.role.toUpperCase()}
          </span>
          <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 13, color: C.ink2 }}>
              <GithubIcon size={14} color={C.ink2} /> PrinceXDev/dogfood-judge
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 13, color: C.ink2 }}>
              <LinkedinIcon size={14} color={C.ink2} /> prince-panchani
            </span>
          </div>
        </div>
      ) : null}
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <div
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: "50%",
            border: `2px solid ${C.accent}`,
            opacity: 0.25 + 0.75 * talk,
            boxShadow: `0 0 ${10 + 24 * talk}px ${C.glow}`,
            transform: `scale(${1 + 0.025 * talk * (0.5 + 0.5 * Math.sin(frame * 0.9))})`,
          }}
        />
        <Img
          src={staticFile("presenter.webp")}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            objectFit: "cover",
            objectPosition: "50% 18%",
            border: `2px solid ${C.bg}`,
          }}
        />
      </div>
    </div>
  );
};
