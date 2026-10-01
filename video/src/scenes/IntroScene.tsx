import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { type BoardOrder, Leaderboard } from "../components/Leaderboard";
import { LogoMark, Wordmark } from "../components/Logo";
import { ScoreCard } from "../components/ScoreCard";
import { Backdrop } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { lerp, pop, progress, rand, rise, windowed } from "../lib/anim";
import { PODIUM, PROJECT_NAMES } from "../lib/data";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

const STATS = [
  { n: 41, label: "Projects" },
  { n: 30, label: "Judges" },
  { n: 126, label: "Reviews" },
];

/** A wall of review cards whose scores keep changing: judging as noise. */
const ScoreField: React.FC<{ reveal: number; frame: number }> = ({ reveal, frame }) => {
  const cols = 5;
  const rows = 8;
  return (
    <div
      style={{
        position: "absolute",
        right: 90,
        top: 70,
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 196px)`,
        gap: 14,
        transform: "perspective(1400px) rotateY(-14deg) rotateX(6deg)",
        maskImage: "linear-gradient(90deg, transparent, black 30%, black 85%, transparent)",
      }}
    >
      {Array.from({ length: cols * rows }, (_, i) => {
        const shown = rand(i * 3.1) < reveal;
        const tick = Math.floor(frame / (5 + (i % 4)));
        const score = 1 + Math.floor(rand(i * 7.7 + tick) * 10);
        const tone = score >= 8 ? C.good : score <= 4 ? C.bad : C.ink2;
        return (
          <ScoreCard
            key={i}
            width={196}
            judge={`jdg_${String(1 + ((i * 7) % 30)).padStart(2, "0")}`}
            project={PROJECT_NAMES[i % PROJECT_NAMES.length]}
            score={`${score}`}
            tone={tone}
            style={{ opacity: shown ? 0.55 : 0, transition: "none" }}
          />
        );
      })}
    </div>
  );
};

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat, duration } = useScene();
  const [b0, b1, b2, b3, b4, b5] = [0, 1, 2, 3, 4, 5].map(beat);

  // Phase A: the numbers. Phase B: one winner. Phase C: doubt. Phase D: reveal.
  const statsOut = progress(frame, b3 - 8, 14);
  const fieldReveal = lerp(frame, [b0, b2 + 30], [0.05, 1]);
  const boardIn = windowed(frame, b3 - 2, b5 + 4, 12);

  // Rapid reshuffles that settle on the final order just as "One winner" lands.
  const ids = PODIUM.map((p) => p.id);
  const orders: BoardOrder[] = [{ at: 0, order: [...ids].reverse() }];
  for (let k = 0; k < 7; k++) {
    const key = (id: string) => rand(k * 13 + ids.indexOf(id) * 1.7);
    const shuffled = [...ids].sort((a, b) => key(a) - key(b));
    orders.push({ at: b3 - 18 + k * 5, order: shuffled });
  }
  orders.push({ at: b3 + 18, order: ids });
  // Doubt: first and second swap back and forth.
  orders.push({ at: b4 + 10, order: [ids[1], ids[0], ...ids.slice(2)] });
  orders.push({ at: b4 + 30, order: ids });
  orders.push({ at: b4 + 50, order: [ids[1], ids[0], ...ids.slice(2)] });
  orders.push({ at: b4 + 70, order: ids });

  const doubt = progress(frame, b4, 14);
  const reveal = frame >= b5 - 4;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ opacity: lerp(frame, [b0, b1], [0, 0.8]) * (1 - statsOut) }}>
        <Backdrop glow="rgba(60,242,192,0.03)" />
        <ScoreField reveal={fieldReveal} frame={frame} />
      </AbsoluteFill>

      {/* Phase A: 41 / 30 / 126 */}
      <div style={{ position: "absolute", left: 150, top: 200, opacity: 1 - statsOut }}>
        {STATS.map((s, i) => {
          const at = [b0, b1, b2][i];
          return (
            <div key={s.label} style={{ ...rise(frame, at - 4, 30), display: "flex", alignItems: "baseline", gap: 30, height: 200 }}>
              <AnimatedNumber
                to={s.n}
                at={at - 4}
                dur={16}
                style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 180, letterSpacing: "-0.05em", color: C.ink, width: 360, display: "inline-block" }}
              />
              <span style={{ fontFamily: fonts.mono, fontSize: 30, letterSpacing: "0.24em", textTransform: "uppercase", color: C.muted }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <Sfx name="tick" at={b0} />
      <Sfx name="tick" at={b1} />
      <Sfx name="tick" at={b2} />

      {/* Phase B + C: one winner, then doubt */}
      {frame >= b3 - 20 && !reveal ? (
        <AbsoluteFill style={{ opacity: boardIn, alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 48, marginTop: -40 }}>
            <div style={{ position: "relative", height: 110, width: 1500, textAlign: "center" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  fontFamily: fonts.serif,
                  fontStyle: "italic",
                  fontSize: 104,
                  color: C.ink,
                  opacity: progress(frame, b3, 14) * (1 - doubt),
                }}
              >
                One winner.
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  fontFamily: fonts.serif,
                  fontStyle: "italic",
                  fontSize: 84,
                  color: C.ink,
                  opacity: doubt,
                  transform: `translateY(${(1 - doubt) * 16}px)`,
                }}
              >
                But can you <span style={{ color: C.warn }}>prove</span> they deserved to win?
              </div>
            </div>
            <Leaderboard
              rows={PODIUM.map((p) => ({ id: p.id, title: p.title, sub: p.track }))}
              orders={orders}
              width={760}
              rowHeight={78}
              moveFrames={8}
              highlight={frame >= b3 + 18 ? "prj_11" : null}
              highlightColor={frame >= b4 ? C.warn : C.accent}
              right={(row, i) =>
                i === 0 && frame >= b3 + 22 ? (
                  <span
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 16,
                      letterSpacing: "0.18em",
                      padding: "6px 12px",
                      borderRadius: 6,
                      color: frame >= b4 ? C.warn : C.accentInk,
                      background: frame >= b4 ? "transparent" : C.accent,
                      border: `1px solid ${frame >= b4 ? C.warn : C.accent}`,
                    }}
                  >
                    {frame >= b4 ? "WINNER?" : "WINNER"}
                  </span>
                ) : null
              }
            />
          </div>
        </AbsoluteFill>
      ) : null}
      <Sfx name="whoosh" at={b3 - 18} />
      <Sfx name="pop" at={b3 + 18} />
      <Sfx name="riser" at={b5 - 66} />

      {/* Phase D: the reveal */}
      {reveal ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Backdrop glow={`rgba(60,242,192,${0.12 * progress(frame, b5, 30)})`} gridOpacity={progress(frame, b5, 30)} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40, marginTop: -60 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 34,
                transform: `scale(${0.9 + 0.1 * pop(frame, b5 - 2, 14)})`,
                opacity: pop(frame, b5 - 2, 14),
              }}
            >
              <div style={{ filter: `drop-shadow(0 0 ${30 * progress(frame, b5, 20)}px ${C.glow})` }}>
                <LogoMark size={150} draw={progress(frame, b5 + 4, 24)} id="intro" />
              </div>
              <Wordmark scale={1.9} />
            </div>
            <div
              style={{
                ...rise(frame, b5 + 30, 20, 26),
                fontFamily: fonts.serif,
                fontStyle: "italic",
                fontSize: 70,
                color: C.ink2,
              }}
            >
              Results you can <span style={{ color: C.accent }}>defend.</span>
            </div>
          </div>
        </AbsoluteFill>
      ) : null}
      <Sfx name="impact" at={b5 - 2} />
      {/* Fade to the next scene. */}
      <AbsoluteFill style={{ backgroundColor: C.bg, opacity: progress(frame, duration - 10, 10), pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
