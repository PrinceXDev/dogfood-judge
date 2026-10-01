import { useCurrentFrame } from "remotion";
import { type BoardOrder, Leaderboard } from "../components/Leaderboard";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { easeInOut, lerp, pop, progress, rise, windowed } from "../lib/anim";
import { FIXTURE } from "../lib/data";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

const JUDGES = Array.from({ length: FIXTURE.judges }, (_, i) => i + 1);
const deciding = (j: number) => FIXTURE.decidingJudges.includes(j);
const jid = (j: number) => `jdg_${String(j).padStart(2, "0")}`;

/** The first-place gap with each project's ±1 SE, drawn to scale. */
const Gap: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 30);
  const rows = [
    { title: FIXTURE.winner, v: 0.62, se: 0.13, color: C.accent },
    { title: FIXTURE.runnerUp, v: 0.611, se: 0.13, color: C.accent2 },
  ];
  const X = (v: number) => 200 + v * 1000;
  return (
    <div style={{ position: "relative", width: 1300, height: 230 }}>
      {rows.map((r, i) => (
        <div key={r.title} style={{ position: "absolute", top: 30 + i * 100, left: 0, right: 0, height: 60 }}>
          <div style={{ position: "absolute", left: 0, top: 14, fontFamily: fonts.sans, fontWeight: 600, fontSize: 28, color: C.ink }}>{r.title}</div>
          <div style={{ position: "absolute", left: 200, top: 18, height: 24, width: (X(r.v) - 200) * p, background: `${r.color}55`, borderRadius: 6 }} />
          <div
            style={{
              position: "absolute",
              left: X(r.v - r.se * p),
              width: (X(r.v + r.se) - X(r.v - r.se)) * p,
              top: 28,
              height: 4,
              background: r.color,
              opacity: p,
            }}
          />
          {[-1, 1].map((d) => (
            <div key={d} style={{ position: "absolute", left: X(r.v + d * r.se * p) - 1, top: 18, width: 3, height: 24, background: r.color, opacity: p }} />
          ))}
          <div style={{ position: "absolute", left: X(r.v) - 7, top: 23, width: 14, height: 14, borderRadius: 7, background: r.color, opacity: p }} />
        </div>
      ))}
    </div>
  );
};

export const DefensibleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat, beatEnd } = useScene();
  // Beats: 0 losing teams ask · 1 the question · 2 remove each judge · 3 24/30 · 4 0.05 SE · 5 coin flip
  const titleUp = progress(frame, beat(2) - 4, 20, easeInOut);
  const sweepStart = beat(2) + 24;
  const sweepEnd = beatEnd(3) - 16;
  const per = (sweepEnd - sweepStart) / JUDGES.length;
  const tested = Math.max(0, Math.min(JUDGES.length, Math.floor((frame - sweepStart) / per) + 1));
  const current = JUDGES[Math.min(JUDGES.length - 1, Math.max(0, tested - 1))];
  const held = JUDGES.slice(0, frame >= sweepStart ? tested : 0).filter((j) => !deciding(j)).length;
  const gridVis = windowed(frame, beat(2), beat(4) + 6, 14);
  const done = frame >= sweepEnd + 4;
  const gapVis = windowed(frame, beat(4), beat(5) + 10, 14);
  const flipVis = progress(frame, beat(5), 14);

  const ids = ["prj_11", "prj_34", "prj_37"];
  const flipped = frame >= sweepStart && deciding(current) && !done;
  const orders: BoardOrder[] = [{ at: 0, order: flipped ? ["prj_34", "prj_11", "prj_37"] : ids }];

  return (
    <SceneShell glow="rgba(244,184,74,0.06)">
      {/* The question */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: lerp(titleUp, [0, 1], [380, 110]),
          textAlign: "center",
          transform: `scale(${1 - titleUp * 0.45})`,
          opacity: 1 - progress(frame, beat(4) - 6, 12),
        }}
      >
        <div style={{ ...rise(frame, beat(0), 12), fontFamily: fonts.mono, fontSize: 24, letterSpacing: "0.22em", color: C.muted, marginBottom: 24 }}>
          THE QUESTION EVERY LOSING TEAM ASKS
        </div>
        <div style={{ ...rise(frame, beat(1) - 4, 30), fontFamily: fonts.serif, fontStyle: "italic", fontSize: 140, color: C.ink, lineHeight: 1 }}>
          Is the winner <span style={{ color: C.warn }}>defensible?</span>
        </div>
      </div>
      <Sfx name="impact" at={beat(1) - 4} volume={0.6} />

      {/* Leave-one-judge-out */}
      <div style={{ opacity: gridVis }}>
        <div style={{ position: "absolute", left: 150, top: 300, display: "grid", gridTemplateColumns: "repeat(6, 132px)", gap: 14 }}>
          {JUDGES.map((j) => {
            const t = sweepStart + (j - 1) * per;
            const s = pop(frame, beat(2) + j * 0.8, 18);
            const isCur = frame >= t && frame < t + per && !done;
            const result = frame >= t + per * 0.6 || done;
            const bad = deciding(j);
            const color = !result ? C.lineStrong : bad ? C.warn : C.good;
            const pulse = done && bad ? 0.5 + 0.5 * Math.sin((frame - sweepEnd) * 0.25) : 0;
            return (
              <div
                key={j}
                style={{
                  height: 62,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  fontFamily: fonts.mono,
                  fontSize: 19,
                  color: result ? color : C.ink2,
                  background: result ? `${color}14` : C.surface,
                  border: `1.5px solid ${isCur ? C.ink : color}`,
                  opacity: s * (isCur ? 0.45 : 1),
                  transform: `scale(${(isCur ? 0.92 : 1) + pulse * 0.05})`,
                  boxShadow: pulse ? `0 0 ${24 * pulse}px ${C.warn}` : "none",
                  textDecoration: isCur ? "line-through" : "none",
                }}
              >
                {jid(j)}
              </div>
            );
          })}
        </div>

        {/* Live refit */}
        <div style={{ position: "absolute", left: 1110, top: 300, width: 660 }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.14em", color: C.muted, marginBottom: 16 }}>
            {done ? "FULL MODEL" : frame >= sweepStart ? `REFIT WITHOUT ${jid(current).toUpperCase()}` : "REFIT"}
          </div>
          <Leaderboard
            rows={[
              { id: "prj_11", title: "Salt Ledger" },
              { id: "prj_34", title: "Iron Switch" },
              { id: "prj_37", title: "Salt Loom" },
            ]}
            orders={orders}
            width={620}
            rowHeight={70}
            highlight={flipped ? "prj_34" : "prj_11"}
            highlightColor={flipped ? C.warn : C.good}
          />
          <div style={{ marginTop: 30, display: "flex", alignItems: "baseline", gap: 18 }}>
            <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 96, letterSpacing: "-0.04em", color: done ? C.warn : C.ink, fontVariantNumeric: "tabular-nums" }}>
              {held}
              <span style={{ color: C.muted }}> / {done ? FIXTURE.judges : frame >= sweepStart ? tested : 0}</span>
            </span>
          </div>
          <div style={{ fontFamily: fonts.sans, fontSize: 26, color: C.ink2 }}>refits where first place holds</div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 150,
            top: 690,
            fontFamily: fonts.sans,
            fontSize: 30,
            color: C.ink,
            opacity: progress(frame, sweepEnd + 4, 14),
          }}
        >
          Remove <span style={{ color: C.warn, fontWeight: 600 }}>any one of these 6 judges</span> and the winner changes.
        </div>
      </div>
      {JUDGES.map((j) => (
        <Sfx key={j} name={deciding(j) ? "pop" : "tick"} at={sweepStart + (j - 1) * per + per * 0.6} volume={deciding(j) ? 0.8 : 0.35} />
      ))}

      {/* The gap */}
      <div style={{ opacity: gapVis }}>
        <div style={{ position: "absolute", left: 160, top: 150, ...rise(frame, beat(4), 16) }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 22, letterSpacing: "0.18em", color: C.muted }}>LEAD OVER SECOND PLACE</div>
          <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 150, letterSpacing: "-0.05em", color: C.bad, lineHeight: 1.1 }}>
            {lerp(frame, [beat(4) + 6, beat(4) + 30], [1, FIXTURE.leadSE]).toFixed(2)} <span style={{ fontSize: 60, color: C.ink2, letterSpacing: "-0.02em" }}>standard errors</span>
          </div>
        </div>
        <div style={{ position: "absolute", left: 160, top: 470 }}>
          <Gap at={beat(4) + 16} />
        </div>
      </div>

      {/* Coin flip */}
      <div style={{ opacity: flipVis }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 170, display: "flex", flexDirection: "column", alignItems: "center", gap: 46 }}>
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: `radial-gradient(circle at 35% 30%, #ffe3a3, ${C.warn} 55%, #a8731c)`,
              transform: `scaleX(${Math.cos((frame - beat(5)) * 0.32 * Math.max(0, 1 - (frame - beat(5)) / 60))})`,
              boxShadow: `0 0 80px -10px ${C.warn}88`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: fonts.serif,
              fontStyle: "italic",
              fontSize: 90,
              color: "#5a3d0c",
            }}
          >
            ?
          </div>
          <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 76, color: C.ink, ...rise(frame, beat(5) + 10, 20) }}>
            First place is a <span style={{ color: C.warn }}>coin flip</span>. Dogfood says so.
          </div>
          <div style={{ display: "flex", gap: 22 }}>
            {["Add tie-breaker reviews", "Shared prize"].map((t, i) => {
              const s = pop(frame, beat(5) + 40 + i * 8);
              return (
                <div
                  key={t}
                  style={{
                    padding: "18px 30px",
                    borderRadius: 12,
                    fontFamily: fonts.sans,
                    fontWeight: 600,
                    fontSize: 26,
                    background: i === 0 ? C.accent : C.surface,
                    color: i === 0 ? C.accentInk : C.ink,
                    border: `1px solid ${i === 0 ? C.accent : C.lineStrong}`,
                    opacity: s,
                    transform: `translateY(${(1 - s) * 14}px)`,
                  }}
                >
                  {t}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Sfx name="whoosh" at={beat(5)} volume={0.6} />
    </SceneShell>
  );
};
