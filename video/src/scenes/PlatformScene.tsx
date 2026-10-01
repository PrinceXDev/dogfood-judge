import { useCurrentFrame } from "remotion";
import { BrowserWindow } from "../components/BrowserWindow";
import { MockScreen } from "../components/MockScreens";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { lerp, pop, progress } from "../lib/anim";
import type { ScreenKey } from "../lib/assets";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

const STACK = ["Go", "SQLite", "Next.js 16", "Tailwind CSS 4", "Docker", "Self-hosted"];

const STEPS: { key: ScreenKey; label: string }[] = [
  { key: "create", label: "Create event" },
  { key: "teams", label: "Teams" },
  { key: "submissions", label: "Submissions" },
  { key: "assignment", label: "Assignment" },
  { key: "scoring", label: "Scoring" },
  { key: "analysis", label: "Analysis" },
  { key: "publish", label: "Publish" },
  { key: "verify", label: "Verify" },
];
const HERO = 5; // "Analysis": where the judging engine lives

export const PlatformScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat, beatEnd } = useScene();
  const runStart = beat(1);
  const runEnd = beatEnd(1);
  const per = (runEnd - runStart) / STEPS.length;
  const active = Math.max(0, Math.min(STEPS.length - 1, Math.floor((frame - runStart) / per)));
  const focus = progress(frame, beat(2), 20);
  const screen = frame >= beat(2) ? HERO : frame < runStart ? 0 : active;
  const screenStart = frame >= beat(2) ? beat(2) : frame < runStart ? 0 : runStart + active * per;
  const swap = progress(frame, screenStart, 10);

  const W = 1640;
  const stepW = W / STEPS.length;

  return (
    <SceneShell>
      {/* Stack */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 110, display: "flex", justifyContent: "center", gap: 14 }}>
        {STACK.map((s, i) => {
          const p = pop(frame, beat(0) + 4 + i * 5);
          return (
            <span
              key={s}
              style={{
                padding: "10px 20px",
                borderRadius: 999,
                border: `1px solid ${C.lineStrong}`,
                background: C.surface,
                fontFamily: fonts.mono,
                fontSize: 20,
                color: i < 2 ? C.accent : C.ink2,
                opacity: p,
                transform: `translateY(${(1 - p) * 12}px)`,
              }}
            >
              {s}
            </span>
          );
        })}
      </div>

      {/* Lifecycle */}
      <div style={{ position: "absolute", left: (1920 - W) / 2, top: 196, width: W, height: 70 }}>
        <div style={{ position: "absolute", left: stepW / 2, right: stepW / 2, top: 15, height: 2, background: C.line }} />
        <div
          style={{
            position: "absolute",
            left: stepW / 2,
            top: 15,
            height: 2,
            background: C.accent,
            width: (W - stepW) * lerp(frame, [runStart, runEnd], [0, 1]),
          }}
        />
        {STEPS.map((s, i) => {
          const lit = frame >= runStart + i * per;
          const hero = i === HERO;
          const dim = 1 - focus * (hero ? 0 : 0.7);
          return (
            <div key={s.key} style={{ position: "absolute", left: i * stepW, width: stepW, textAlign: "center", opacity: dim }}>
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  margin: "8px auto 0",
                  background: lit ? (hero && focus > 0 ? C.warn : C.accent) : C.bg,
                  border: `2px solid ${lit ? C.accent : C.lineStrong}`,
                  boxShadow: hero && focus > 0 ? `0 0 ${24 * focus}px ${C.warn}` : "none",
                  transform: `scale(${1 + (hero ? focus * 0.5 : 0)})`,
                }}
              />
              <div
                style={{
                  marginTop: 12,
                  fontFamily: fonts.mono,
                  fontSize: 17,
                  letterSpacing: "0.06em",
                  color: hero && focus > 0 ? C.warn : lit ? C.ink : C.muted,
                }}
              >
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
      {STEPS.map((s, i) => (
        <Sfx key={s.key} name="tick" at={runStart + i * per} volume={0.6} />
      ))}

      {/* App */}
      <div
        style={{
          position: "absolute",
          left: 260,
          top: 300,
          opacity: pop(frame, beat(0) + 10, 18),
          transform: `translateY(${(1 - pop(frame, beat(0) + 10, 18)) * 60}px) scale(${1 + focus * 0.03})`,
        }}
      >
        <BrowserWindow url={`localhost:8080 · ${STEPS[screen].label.toLowerCase()}`} width={1400} height={520}>
          <div style={{ position: "absolute", inset: 0, opacity: swap, transform: `translateX(${(1 - swap) * 30}px)` }}>
            <MockScreen screen={STEPS[screen].key} />
          </div>
        </BrowserWindow>
      </div>
      <Sfx name="whoosh" at={beat(2) - 4} />
    </SceneShell>
  );
};
