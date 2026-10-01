import { useCurrentFrame } from "remotion";
import { type Pair, ProjectComparison } from "../components/ProjectComparison";
import { SceneShell } from "../components/SceneShell";
import { SectionTitle } from "../components/SectionTitle";
import { Sfx } from "../components/Sfx";
import { easeInOut, pop, progress, rise, windowed } from "../lib/anim";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

const NODES = [
  { name: "Salt Ledger", s: 1.42 },
  { name: "Iron Switch", s: 1.31 },
  { name: "Salt Loom", s: 1.12 },
  { name: "Dry Relay", s: 0.86 },
  { name: "North Drift", s: 0.71 },
  { name: "Glass Signal", s: 0.52 },
  { name: "Small Relay", s: 0.38 },
  { name: "Quiet Forge", s: 0.25 },
];
// Server-chosen pairs: informative ones first (close in strength, few comparisons).
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], [1, 2], [3, 4], [5, 6], [0, 2], [1, 3], [2, 4], [0, 7], [3, 6], [1, 5],
];

export const PairwiseScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat } = useScene();
  // Beats: 0 pairwise mode · 1 A, B or tie · 2 server picks pairs · 3 Bradley–Terry
  const pairs: Pair[] = [
    { a: "Salt Ledger", b: "Iron Switch", trackA: "Developer tools", trackB: "Fintech", verdict: "A", at: beat(1) + 14 },
    { a: "Dry Relay", b: "Salt Loom", trackA: "Health", trackB: "Climate", verdict: "B", at: beat(1) + 44 },
    { a: "North Drift", b: "Glass Signal", trackA: "Education", trackB: "Developer tools", verdict: "T", at: beat(1) + 72 },
  ];
  const cmpVis = windowed(frame, beat(0), beat(2) + 4, 12);
  const graphVis = progress(frame, beat(2), 14);
  const rankMorph = progress(frame, beat(3), 30, easeInOut);
  const edgeAt = (i: number) => beat(2) + 10 + i * 6;

  const CX = 1250;
  const CY = 560;
  const R = 250;
  const circle = (i: number) => {
    const a = (i / NODES.length) * Math.PI * 2 - Math.PI / 2;
    return { x: CX + Math.cos(a) * R, y: CY + Math.sin(a) * R };
  };
  const ranked = (i: number) => ({ x: 1120, y: 300 + i * 62 });
  const pos = (i: number) => {
    const c = circle(i);
    const r = ranked(i);
    return { x: c.x + (r.x - c.x) * rankMorph, y: c.y + (r.y - c.y) * rankMorph };
  };

  return (
    <SceneShell glow="rgba(56,214,245,0.06)">
      {/* Comparisons */}
      <div style={{ opacity: cmpVis }}>
        <SectionTitle eyebrow="Pairwise mode" title="Sometimes a score isn't enough." at={beat(0) - 6} size={54} align="center" style={{ position: "absolute", left: 0, right: 0, top: 110 }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: 330, display: "flex", justifyContent: "center" }}>
          <ProjectComparison pairs={pairs} />
        </div>
      </div>
      {pairs.map((p) => (
        <Sfx key={p.at} name="key" at={p.at} volume={2.5} />
      ))}

      {/* The comparison graph, then the fitted ranking */}
      <div style={{ opacity: graphVis }}>
        <div style={{ position: "absolute", left: 150, top: 300, width: 640, opacity: 1 - progress(frame, beat(3), 8) }}>
          <div style={{ ...rise(frame, beat(2), 14), fontFamily: fonts.mono, fontSize: 20, letterSpacing: "0.18em", color: C.accent2 }}>SERVER-SELECTED PAIRS</div>
          <div style={{ ...rise(frame, beat(2) + 6, 14), fontFamily: fonts.sans, fontWeight: 600, fontSize: 46, letterSpacing: "-0.03em", color: C.ink, marginTop: 14 }}>
            Judges can't steer which projects meet.
          </div>
        </div>
        <svg style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, overflow: "visible", opacity: 1 - rankMorph }}>
          {EDGES.map(([a, b], i) => {
            const p = progress(frame, edgeAt(i), 10);
            const A = circle(a);
            const B = circle(b);
            const fresh = frame >= edgeAt(i) && frame < edgeAt(i) + 16;
            return (
              <line
                key={i}
                x1={A.x}
                y1={A.y}
                x2={A.x + (B.x - A.x) * p}
                y2={A.y + (B.y - A.y) * p}
                stroke={fresh ? C.accent2 : C.lineStrong}
                strokeWidth={fresh ? 3 : 2}
              />
            );
          })}
        </svg>
        {NODES.map((n, i) => {
          const p = pos(i);
          const s = pop(frame, beat(2) + i * 2);
          const barW = n.s * 260 * rankMorph;
          return (
            <div key={n.name} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-11px, -50%)", opacity: s }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: i < 3 ? C.accent2 : C.ink2,
                    boxShadow: i < 3 ? `0 0 18px ${C.accent2}` : "none",
                  }}
                />
                <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 22, color: C.ink, whiteSpace: "nowrap", width: 170 }}>{n.name}</span>
                <div style={{ position: "relative", width: barW, height: 12, borderRadius: 6, background: `${C.accent2}88` }}>
                  {rankMorph > 0.9 ? (
                    <div style={{ position: "absolute", right: -26, top: 5, width: 52, height: 2, background: C.ink2 }}>
                      <div style={{ position: "absolute", left: 0, top: -5, width: 2, height: 12, background: C.ink2 }} />
                      <div style={{ position: "absolute", right: 0, top: -5, width: 2, height: 12, background: C.ink2 }} />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 150, top: 160, opacity: progress(frame, beat(3) + 12, 14) }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 20, letterSpacing: "0.18em", color: C.accent2 }}>FITTED STRENGTHS ± SE</div>
          <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 64, letterSpacing: "-0.035em", color: C.ink, marginTop: 14, lineHeight: 1.05 }}>
            Bradley–Terry
            <br />
            pairwise ranking
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 40 }}>
            {["Fitted by MM with a regularizing prior", "Adaptive pair selection, validated vs random", "Standard errors from the information matrix", "Davidson model for honest tie rates"].map((t, i) => (
              <div key={t} style={{ ...rise(frame, beat(3) + 20 + i * 8, 12), display: "flex", alignItems: "center", gap: 14, fontFamily: fonts.sans, fontSize: 26, color: C.ink2 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: C.accent2 }} />
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
      {EDGES.map((e, i) => (
        <Sfx key={i} name="tick" at={edgeAt(i)} volume={0.4} />
      ))}
      <Sfx name="whoosh" at={beat(3)} volume={0.6} />
    </SceneShell>
  );
};
