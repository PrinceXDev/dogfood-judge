import { useCurrentFrame } from "remotion";
import { CheckIcon, GithubIcon, LinkedinIcon } from "../components/Icons";
import { type BoardOrder, Leaderboard } from "../components/Leaderboard";
import { LogoMark, Wordmark } from "../components/Logo";
import { Backdrop } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { lerp, pop, progress, rise, windowed } from "../lib/anim";
import { PODIUM } from "../lib/data";
import { useScene } from "../lib/scene";
import { C, fonts, LINKS } from "../lib/theme";

// Everything the results page puts behind a first place.
const EVIDENCE = [
  { label: "Normalized score", sub: "leniency + scale corrected" },
  { label: "Rank interval", sub: "90% bootstrap" },
  { label: "P(Top 3)", sub: "300 replicates" },
  { label: "Judge sensitivity", sub: "30 leave-one-out refits" },
  { label: "Influential reviews", sub: "priced in ranks" },
  { label: "Audit proof", sub: "hash chain + Ed25519" },
  { label: "Verification", sub: "dogfood verify-results ✓" },
];

const CARD = { x: 640, y: 470, w: 640 };

export const FinalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat, duration } = useScene();
  // Beats: 0 back to the leaderboard · 1 evidence · 2 easy · 3 harder · 4 sign-off
  const ids = PODIUM.map((p) => p.id);
  const isolate = progress(frame, beat(1), 18);
  const evStart = beat(1) + 14;
  const defensibleAt = beat(1) + 74;
  const boardVis = windowed(frame, 0, beat(2), 14);
  const linesVis = windowed(frame, beat(2) - 4, beat(4), 12);
  const endVis = progress(frame, beat(4), 16);
  const orders: BoardOrder[] = [{ at: 0, order: ids }];

  const chipPos = (i: number) => {
    const left = i < 4;
    const k = left ? i : i - 4;
    const n = left ? 4 : 3;
    return {
      x: left ? 120 : 1360,
      y: 520 - ((n - 1) * 118) / 2 + k * 118 - 40,
      left,
    };
  };

  return (
    <div style={{ position: "absolute", inset: 0, backgroundColor: C.bg }}>
      <Backdrop glow={`rgba(60,242,192,${0.05 + 0.08 * endVis})`} />

      {/* The leaderboard from the opening, now with evidence */}
      <div style={{ opacity: boardVis }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", ...rise(frame, 4, 16), opacity: 1 - isolate }}>
          <span style={{ fontFamily: fonts.mono, fontSize: 22, letterSpacing: "0.22em", color: C.muted }}>SAMPLE HACK 2026 · FINAL STANDINGS</span>
        </div>
        <div
          style={{
            position: "absolute",
            left: CARD.x,
            top: lerp(isolate, [0, 1], [230, CARD.y - 40]),
          }}
        >
          <Leaderboard
            rows={PODIUM.map((p) => ({ id: p.id, title: p.title, sub: p.track }))}
            orders={orders}
            width={CARD.w}
            rowHeight={96}
            highlight="prj_11"
            dim={(id) => (id === "prj_11" ? 1 : 1 - isolate)}
            right={(row) =>
              row.id === "prj_11" ? (
                <span
                  style={{
                    fontFamily: fonts.mono,
                    fontWeight: 600,
                    fontSize: 18,
                    letterSpacing: "0.16em",
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: C.accent,
                    color: C.accentInk,
                    whiteSpace: "nowrap",
                    boxShadow: frame >= defensibleAt ? `0 0 ${30 * progress(frame, defensibleAt, 14)}px ${C.glow}` : "none",
                  }}
                >
                  {frame >= defensibleAt ? "DEFENSIBLE WINNER" : "WINNER"}
                </span>
              ) : null
            }
          />
        </div>

        {/* Evidence */}
        <svg style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, overflow: "visible" }}>
          {EVIDENCE.map((e, i) => {
            const p = chipPos(i);
            const t = progress(frame, evStart + i * 6 + 4, 14);
            const fx = p.left ? p.x + 440 : p.x;
            const fy = p.y + 40;
            const tx = p.left ? CARD.x : CARD.x + CARD.w;
            const ty = CARD.y + 8;
            const fade = 1 - progress(frame, defensibleAt + 26, 14);
            return (
              <line
                key={e.label}
                x1={fx}
                y1={fy}
                x2={fx + (tx - fx) * t}
                y2={fy + (ty - fy) * t}
                stroke={`${C.accent}55`}
                strokeWidth={1.5}
                opacity={fade}
              />
            );
          })}
        </svg>
        {EVIDENCE.map((e, i) => {
          const p = chipPos(i);
          const s = pop(frame, evStart + i * 6);
          const fade = 1 - progress(frame, defensibleAt + 26, 14);
          return (
            <div
              key={e.label}
              style={{
                position: "absolute",
                left: p.x,
                top: p.y,
                width: 440,
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "16px 20px",
                borderRadius: 14,
                background: C.surface,
                border: `1px solid ${C.lineStrong}`,
                opacity: s * fade,
                transform: `translateX(${(1 - s) * (p.left ? -30 : 30)}px)`,
              }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 20, background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <CheckIcon size={22} color={C.accent} stroke={2.6} />
              </div>
              <div>
                <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 25, color: C.ink }}>{e.label}</div>
                <div style={{ fontFamily: fonts.mono, fontSize: 15, color: C.muted }}>{e.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
      {EVIDENCE.map((e, i) => (
        <Sfx key={e.label} name="tick" at={evStart + i * 6} volume={0.5} />
      ))}
      <Sfx name="success" at={defensibleAt} volume={0.7} />

      {/* The two lines */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 330, textAlign: "center", opacity: linesVis }}>
        <div style={{ ...rise(frame, beat(2), 20), fontFamily: fonts.serif, fontStyle: "italic", fontSize: 104, color: frame >= beat(3) ? C.muted : C.ink }}>
          Picking a winner is easy.
        </div>
        <div style={{ ...rise(frame, beat(3), 20), fontFamily: fonts.serif, fontStyle: "italic", fontSize: 104, color: C.ink, marginTop: 10 }}>
          Proving the result is <span style={{ color: C.accent }}>fair</span> is harder.
        </div>
      </div>

      {/* Sign-off */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 220, display: "flex", flexDirection: "column", alignItems: "center", opacity: endVis }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${0.92 + 0.08 * pop(frame, beat(4), 14)})` }}>
          <div style={{ filter: `drop-shadow(0 0 30px ${C.glow})` }}>
            <LogoMark size={140} draw={progress(frame, beat(4) + 6, 22)} id="final" />
          </div>
          <Wordmark scale={1.8} />
        </div>
        <div style={{ ...rise(frame, beat(4) + 24, 18), marginTop: 34, fontFamily: fonts.serif, fontStyle: "italic", fontSize: 68, color: C.ink2 }}>
          Results you can <span style={{ color: C.accent }}>defend.</span>
        </div>
        <div style={{ ...rise(frame, beat(4) + 44, 18), marginTop: 60, display: "flex", flexDirection: "column", gap: 18, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: fonts.mono, fontSize: 28, color: C.ink }}>
            <GithubIcon size={30} color={C.ink} /> {LINKS.githubShort}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: fonts.mono, fontSize: 28, color: C.ink }}>
            <LinkedinIcon size={30} color="#4c9bff" /> {LINKS.linkedinShort}
          </div>
          <div style={{ marginTop: 10, fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.14em", color: C.muted }}>
            BUILT BY {LINKS.name.toUpperCase()} · DOGFOOD 2026 · MIT · GO + SQLITE + NEXT.JS
          </div>
        </div>
      </div>
      <Sfx name="riser" at={beat(4) - 66} volume={0.6} />
      <Sfx name="impact" at={beat(4)} />
      <div style={{ position: "absolute", inset: 0, backgroundColor: "#000", opacity: progress(frame, duration - 20, 20) }} />
    </div>
  );
};
