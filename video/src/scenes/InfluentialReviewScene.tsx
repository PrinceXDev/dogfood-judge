import { useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { SectionTitle } from "../components/SectionTitle";
import { Sfx } from "../components/Sfx";
import { ease, lerp, pop, progress, rand, rise } from "../lib/anim";
import { FIXTURE } from "../lib/data";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

const N = FIXTURE.reviews;
const PLOT = { x: 160, y: 250, w: 760, h: 540 };
const ROGUE = 77;

// Each review: what the model predicted vs what the judge gave. Honest
// reviews sit near the diagonal; the planted one is far below it.
const REVIEWS = Array.from({ length: N }, (_, i) => {
  const pred = 0.12 + rand(i * 1.37) * 0.76;
  const noise = (rand(i * 9.1) + rand(i * 4.3) - 1) * 0.16;
  const actual = i === ROGUE ? 0.1 : Math.min(0.97, Math.max(0.03, pred + noise));
  const fromAngle = rand(i * 2.9) * Math.PI * 2;
  return { pred: i === ROGUE ? 0.78 : pred, actual, fromAngle, delay: rand(i * 5.5) * 40 };
});

const JUDGES = [
  { id: FIXTURE.mostInfluential, agree: 0.71, infl: 0.22, tag: `most influential · τ = ${FIXTURE.influentialTau}`, tone: C.accent2 },
  { id: "jdg_26", agree: 0.64, infl: 0.08, tag: "", tone: C.ink2 },
  { id: "jdg_13", agree: 0.58, infl: 0.06, tag: "", tone: C.ink2 },
  { id: FIXTURE.flatJudge, agree: 0.12, infl: 0.03, tag: "flat scorer", tone: C.warn },
  { id: "jdg_19", agree: 0.47, infl: 0.05, tag: "", tone: C.ink2 },
];

export const InfluentialReviewScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat } = useScene();
  // Beats: 0 reviews that disagree · 1 predict + flag · 2 refit without it, #19 → #29 · 3 cost + agreement
  const flagAt = beat(1) + 40;
  const zoom = progress(frame, beat(2) - 6, 24, ease);
  const tableVis = progress(frame, beat(3), 16);

  const sx = (v: number) => PLOT.x + v * PLOT.w;
  const sy = (v: number) => PLOT.y + PLOT.h - v * PLOT.h;
  const rogue = REVIEWS[ROGUE];

  return (
    <SceneShell glow="rgba(255,95,109,0.05)">
      <SectionTitle
        eyebrow="Influential reviews"
        title="Find the review that changed everything."
        at={beat(0) - 6}
        size={54}
        style={{ position: "absolute", left: 160, top: 112, opacity: 1 - tableVis }}
      />

      {/* Predicted vs actual */}
      <div style={{ opacity: 1 - tableVis }}>
        <div style={{ position: "absolute", left: PLOT.x, top: PLOT.y, width: PLOT.w, height: PLOT.h, border: `1px solid ${C.line}`, borderRadius: 8 }} />
        {/* |z| < 2.5 band around the diagonal */}
        <svg style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, overflow: "visible", opacity: progress(frame, beat(1), 20) }}>
          <polygon
            points={`${sx(0)},${sy(0.17)} ${sx(0.83)},${sy(1)} ${sx(1)},${sy(1)} ${sx(1)},${sy(0.83)} ${sx(0.17)},${sy(0)} ${sx(0)},${sy(0)}`}
            fill={`${C.accent}10`}
            stroke={`${C.accent}55`}
            strokeDasharray="6 6"
          />
          <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke={`${C.accent}88`} strokeWidth={1.5} />
        </svg>
        <div style={{ position: "absolute", left: PLOT.x, top: PLOT.y + PLOT.h + 14, width: PLOT.w, textAlign: "center", fontFamily: fonts.mono, fontSize: 16, color: C.muted }}>
          what the model predicted this judge would give →
        </div>
        <div
          style={{
            position: "absolute",
            left: PLOT.x - 40,
            top: PLOT.y + PLOT.h / 2,
            transform: "translate(-50%, -50%) rotate(-90deg)",
            fontFamily: fonts.mono,
            fontSize: 16,
            color: C.muted,
            whiteSpace: "nowrap",
          }}
        >
          what they actually gave →
        </div>
        {REVIEWS.map((r, i) => {
          const t = progress(frame, beat(0) + r.delay, 26, ease);
          const fx = 960 + Math.cos(r.fromAngle) * 1200;
          const fy = 540 + Math.sin(r.fromAngle) * 800;
          const x = lerp(t, [0, 1], [fx, sx(r.pred)]);
          const y = lerp(t, [0, 1], [fy, sy(r.actual)]);
          const isRogue = i === ROGUE;
          const flagged = isRogue && frame >= flagAt;
          const muted = frame >= flagAt && !isRogue;
          const size = lerp(t, [0, 0.7, 1], [44, 30, 12]);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x - size / 2,
                top: y - size / 2,
                width: size,
                height: size * (t < 0.8 ? 0.7 : 1),
                borderRadius: t < 0.8 ? 4 : size,
                background: flagged ? C.bad : C.ink2,
                opacity: t * (muted ? 0.3 : 0.85),
                boxShadow: flagged ? `0 0 24px ${C.bad}` : "none",
              }}
            />
          );
        })}
        {frame >= flagAt ? (
          <div
            style={{
              position: "absolute",
              left: sx(rogue.pred) - 34,
              top: sy(rogue.actual) - 34,
              width: 68,
              height: 68,
              borderRadius: 34,
              border: `2px solid ${C.bad}`,
              transform: `scale(${1 + 0.4 * ((frame - flagAt) % 30) / 30})`,
              opacity: 1 - ((frame - flagAt) % 30) / 30,
            }}
          />
        ) : null}
        <div style={{ position: "absolute", left: sx(rogue.pred) - 90, top: sy(rogue.actual) + 30, fontFamily: fonts.mono, fontSize: 18, color: C.bad, opacity: progress(frame, flagAt, 10) }}>
          z = −3.4 · flagged
        </div>
      </div>
      <Sfx name="whoosh" at={beat(0)} volume={0.5} />
      <Sfx name="ping" at={flagAt} />

      {/* Detail card */}
      <div
        style={{
          position: "absolute",
          left: 1020,
          top: 250,
          width: 760,
          opacity: zoom * (1 - tableVis),
          transform: `translateX(${(1 - zoom) * 60}px) scale(${0.94 + 0.06 * zoom})`,
          padding: 36,
          borderRadius: 20,
          background: C.surface,
          border: `1.5px solid ${C.bad}88`,
          boxShadow: `0 0 90px -30px ${C.bad}`,
        }}
      >
        <div style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 22, letterSpacing: "0.16em", color: C.bad }}>INFLUENTIAL REVIEW DETECTED</div>
        <div style={{ display: "flex", gap: 40, marginTop: 24, fontFamily: fonts.mono, fontSize: 20, color: C.ink2 }}>
          <div>
            judge <span style={{ color: C.ink }}>J-3f9c…</span>
          </div>
          <div>
            gave <span style={{ color: C.bad }}>1 / 5</span>
          </div>
          <div>
            expected <span style={{ color: C.ink }}>3.9</span>
          </div>
        </div>
        <div style={{ height: 1, background: C.line, margin: "28px 0" }} />
        <div style={{ fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.14em", color: C.muted }}>PROJECT 19 · REFIT WITHOUT THIS ONE REVIEW</div>
        <div style={{ display: "flex", alignItems: "center", gap: 30, marginTop: 20 }}>
          {[
            { label: "with it", rank: 29, color: C.bad, at: beat(2) + 20 },
            { label: "without it", rank: 19, color: C.good, at: beat(2) + 44 },
          ].map((r, i) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 30 }}>
              {i === 1 ? <span style={{ fontFamily: fonts.sans, fontSize: 50, color: C.muted }}>→</span> : null}
              <div style={{ opacity: pop(frame, r.at), transform: `scale(${0.8 + 0.2 * pop(frame, r.at)})` }}>
                <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 104, letterSpacing: "-0.05em", color: r.color, lineHeight: 1 }}>#{r.rank}</div>
                <div style={{ fontFamily: fonts.mono, fontSize: 18, color: C.muted, marginTop: 6 }}>{r.label}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 26, fontFamily: fonts.sans, fontWeight: 600, fontSize: 32, color: C.ink, ...rise(frame, beat(2) + 60, 14) }}>
          This one review is worth <span style={{ color: C.warn }}>10 places</span>.
        </div>
        <div style={{ marginTop: 14, fontFamily: fonts.mono, fontSize: 15, color: C.muted }}>planted rogue review · judging unit test</div>
      </div>
      <Sfx name="impact" at={beat(2) + 44} volume={0.45} />

      {/* Agreement and influence */}
      <div style={{ opacity: tableVis }}>
        <SectionTitle eyebrow="Judge diagnostics" title="Not just flagged. Priced." at={beat(3)} size={60} style={{ position: "absolute", left: 160, top: 120 }} />
        <div style={{ position: "absolute", left: 160, top: 300, width: 1300 }}>
          <div style={{ display: "flex", fontFamily: fonts.mono, fontSize: 16, letterSpacing: "0.14em", color: C.muted, paddingBottom: 14, borderBottom: `1px solid ${C.line}` }}>
            <span style={{ width: 160 }}>JUDGE</span>
            <span style={{ width: 460 }}>AGREEMENT WITH EVERYONE ELSE</span>
            <span style={{ width: 300 }}>INFLUENCE ON RANKING</span>
          </div>
          {JUDGES.map((j, i) => {
            const p = progress(frame, beat(3) + 12 + i * 6, 20);
            return (
              <div key={j.id} style={{ display: "flex", alignItems: "center", height: 74, borderBottom: `1px solid ${C.line}`, opacity: p }}>
                <span style={{ width: 160, fontFamily: fonts.mono, fontSize: 22, color: C.ink }}>{j.id}</span>
                <div style={{ width: 460, display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ position: "relative", width: 340, height: 10, background: C.surface2, borderRadius: 5 }}>
                    <div style={{ position: "absolute", left: 170, top: -4, width: 1.5, height: 18, background: C.lineStrong }} />
                    <div
                      style={{
                        position: "absolute",
                        left: j.agree >= 0 ? 170 : 170 + j.agree * 170 * p,
                        width: Math.abs(j.agree) * 170 * p,
                        height: 10,
                        borderRadius: 5,
                        background: j.agree < 0 ? C.bad : j.agree < 0.3 ? C.warn : C.good,
                      }}
                    />
                  </div>
                  <span style={{ fontFamily: fonts.mono, fontSize: 18, color: C.ink2 }}>{j.agree.toFixed(2)}</span>
                </div>
                <div style={{ width: 300, display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 200 * (j.infl / 0.22) * p, height: 10, borderRadius: 5, background: C.accent2 }} />
                </div>
                {j.tag ? <span style={{ fontFamily: fonts.mono, fontSize: 18, color: j.tone }}>{j.tag}</span> : null}
              </div>
            );
          })}
          <div style={{ marginTop: 18, fontFamily: fonts.mono, fontSize: 15, color: C.muted }}>
            tags from the engine's report on the DOGFOOD fixture · bar lengths illustrative
          </div>
        </div>
      </div>
    </SceneShell>
  );
};
