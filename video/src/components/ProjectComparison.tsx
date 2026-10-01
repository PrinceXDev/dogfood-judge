import { useCurrentFrame } from "remotion";
import { pop, progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";

export type Pair = { a: string; b: string; trackA: string; trackB: string; verdict: "A" | "B" | "T"; at: number };

const Card: React.FC<{ label: string; title: string; track: string; win: number; lose: number }> = ({
  label,
  title,
  track,
  win,
  lose,
}) => (
  <div
    style={{
      width: 520,
      height: 300,
      borderRadius: 20,
      padding: 34,
      background: C.surface,
      border: `1.5px solid ${win > 0 ? C.accent : C.line}`,
      boxShadow: win > 0 ? `0 0 60px -16px ${C.glow}` : "none",
      opacity: 1 - lose * 0.55,
      transform: `scale(${1 + win * 0.03 - lose * 0.03})`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    }}
  >
    <div style={{ fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.2em", color: C.muted }}>PROJECT {label}</div>
    <div>
      <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 52, letterSpacing: "-0.03em", color: C.ink }}>
        {title}
      </div>
      <div style={{ fontFamily: fonts.mono, fontSize: 18, color: C.ink2, marginTop: 8 }}>{track}</div>
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      {[0.8, 0.55, 0.7].map((w, i) => (
        <div key={i} style={{ height: 8, width: `${w * 30}%`, borderRadius: 4, background: C.line }} />
      ))}
    </div>
  </div>
);

const Key: React.FC<{ k: string; label: string; press: number }> = ({ k, label, press }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <div
      style={{
        width: 64,
        height: 64,
        borderRadius: 12,
        border: `1.5px solid ${press > 0 ? C.accent : C.lineStrong}`,
        background: press > 0 ? C.accent : C.surface2,
        color: press > 0 ? C.accentInk : C.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.mono,
        fontWeight: 600,
        fontSize: 28,
        transform: `translateY(${press * 4}px)`,
        boxShadow: press > 0 ? "none" : `0 4px 0 ${C.line}`,
      }}
    >
      {k}
    </div>
    <span style={{ fontFamily: fonts.sans, fontSize: 22, color: C.ink2 }}>{label}</span>
  </div>
);

/** The pairwise judging screen: two projects, A / B / Tie keys, verdicts animating. */
export const ProjectComparison: React.FC<{ pairs: Pair[] }> = ({ pairs }) => {
  const frame = useCurrentFrame();
  let idx = 0;
  for (let i = 0; i < pairs.length; i++) if (frame >= pairs[i].at - 14) idx = i;
  const pair = pairs[idx];
  const t = frame - pair.at;
  const pressed = t >= 0 && t < 12 ? 1 : 0;
  const decided = progress(frame, pair.at, 8);
  const next = pairs[idx + 1];
  const leave = next ? progress(frame, next.at - 14, 10) : 0;
  const enter = pop(frame, idx === 0 ? 0 : pairs[idx - 1].at + 4, 18);
  const win = (side: "A" | "B") => (pair.verdict === side ? decided : pair.verdict === "T" ? decided * 0.6 : 0);
  const lose = (side: "A" | "B") => (pair.verdict !== side && pair.verdict !== "T" ? decided : 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 46 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 50,
          opacity: enter * (1 - leave),
          transform: `translateX(${(1 - enter) * 60 - leave * 60}px)`,
        }}
      >
        <Card label="A" title={pair.a} track={pair.trackA} win={win("A")} lose={lose("A")} />
        <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 64, color: C.muted }}>vs</div>
        <Card label="B" title={pair.b} track={pair.trackB} win={win("B")} lose={lose("B")} />
      </div>
      <div style={{ display: "flex", gap: 56 }}>
        <Key k="A" label="A is better" press={pair.verdict === "A" ? pressed : 0} />
        <Key k="T" label="Tie" press={pair.verdict === "T" ? pressed : 0} />
        <Key k="B" label="B is better" press={pair.verdict === "B" ? pressed : 0} />
      </div>
    </div>
  );
};
