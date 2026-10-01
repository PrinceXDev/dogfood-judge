import { useCurrentFrame } from "remotion";
import { UserIcon } from "../components/Icons";
import { ProbabilityBar } from "../components/ProbabilityBar";
import { SceneShell } from "../components/SceneShell";
import { SectionTitle } from "../components/SectionTitle";
import { Sfx } from "../components/Sfx";
import { ease, pop, progress, rise } from "../lib/anim";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

// Fixture standings with bootstrap P(top 3) (JUDGING.md §1.1).
const ROWS = [
  { title: "Salt Ledger", p: 0.55, judge: "jdg_05" },
  { title: "Iron Switch", p: 0.65, judge: "jdg_21" },
  { title: "Salt Loom", p: 0.49, judge: "jdg_17" },
  { title: "Dry Relay", p: 0.24, judge: "jdg_11" },
  { title: "North Drift", p: 0.2, judge: "jdg_28" },
  { title: "Glass Signal", p: 0.03 },
  { title: "Small Relay", p: 0.01 },
  { title: "Quiet Forge", p: 0.0 },
];
const UNCERTAIN = ROWS.map((r, i) => ({ ...r, i }))
  .filter((r) => r.p > 0.05 && r.p < 0.95)
  .sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5));
const ROW_H = 74;
const TOP = 250;

export const TieBreakerScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat } = useScene();
  // Beats: 0 podium close · 1 most are settled · 2 coin flips get a judge · 3 judge time
  const settled = progress(frame, beat(1) + 6, 16);
  const target = progress(frame, beat(2), 14);
  const assignAt = (k: number) => beat(2) + 24 + k * 16;

  return (
    <SceneShell glow="rgba(244,184,74,0.05)">
      <SectionTitle eyebrow="Smart tie-breaking" title="Review where it can change a prize." at={beat(0) - 6} size={54} style={{ position: "absolute", left: 150, top: 110 }} />

      {/* Standings */}
      <div style={{ position: "absolute", left: 150, top: TOP, width: 920 }}>
        {ROWS.map((r, i) => {
          const s = pop(frame, beat(0) + i * 3);
          const isSettled = r.p <= 0.05 || r.p >= 0.95;
          const uncertainIdx = UNCERTAIN.findIndex((u) => u.i === i);
          const assigned = uncertainIdx >= 0 && frame >= assignAt(uncertainIdx) + 12;
          const glow = uncertainIdx >= 0 ? target : 0;
          return (
            <div
              key={r.title}
              style={{
                position: "absolute",
                top: i * ROW_H + (i >= 3 ? 26 : 0),
                width: 920,
                height: ROW_H - 10,
                display: "flex",
                alignItems: "center",
                gap: 22,
                padding: "0 22px",
                borderRadius: 12,
                background: glow ? `rgba(244,184,74,${0.07 * glow})` : C.surface,
                border: `1px solid ${glow ? `rgba(244,184,74,${0.2 + 0.5 * glow})` : C.line}`,
                opacity: s * (isSettled ? 1 - settled * 0.6 : 1),
                transform: `translateX(${(1 - s) * -30}px)`,
              }}
            >
              <span style={{ fontFamily: fonts.mono, fontSize: 22, color: C.muted, width: 34 }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 26, color: C.ink, width: 220 }}>{r.title}</span>
              <ProbabilityBar value={r.p} at={beat(0) + 6 + i * 3} width={280} height={11} midline color={glow ? C.warn : C.accent} />
              {isSettled ? (
                <span style={{ fontFamily: fonts.mono, fontSize: 16, color: C.muted, opacity: settled, letterSpacing: "0.1em" }}>SETTLED</span>
              ) : null}
              {assigned ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    borderRadius: 999,
                    background: C.warn,
                    color: "#1d1404",
                    fontFamily: fonts.mono,
                    fontWeight: 600,
                    fontSize: 16,
                    transform: `scale(${pop(frame, assignAt(uncertainIdx) + 12)})`,
                  }}
                >
                  <UserIcon size={16} color="#1d1404" stroke={2.4} /> +1 review
                </span>
              ) : null}
            </div>
          );
        })}
        {/* the prize line */}
        <div style={{ position: "absolute", top: 3 * ROW_H - 2, left: -20, width: 960, display: "flex", alignItems: "center", gap: 14, opacity: progress(frame, beat(0) + 20, 14) }}>
          <div style={{ flex: 1, borderTop: `2px dashed ${C.warn}` }} />
          <span style={{ fontFamily: fonts.mono, fontSize: 16, letterSpacing: "0.2em", color: C.warn }}>PRIZE LINE</span>
          <div style={{ width: 40, borderTop: `2px dashed ${C.warn}` }} />
        </div>
        <div style={{ position: "absolute", top: 8 * ROW_H + 34, fontFamily: fonts.mono, fontSize: 17, color: C.muted, opacity: settled }}>
          + 32 more projects at P(top 3) ≈ 0% · settled
        </div>
      </div>

      {/* Flying judges + assignment log */}
      {UNCERTAIN.map((u, k) => {
        const t = progress(frame, assignAt(k), 14, ease);
        const x0 = 1500;
        const y0 = 300 + k * 70;
        const x1 = 150 + 860;
        const y1 = TOP + u.i * ROW_H + (u.i >= 3 ? 26 : 0) + 32;
        return (
          <div
            key={u.title}
            style={{
              position: "absolute",
              left: x0 + (x1 - x0) * t - 22,
              top: y0 + (y1 - y0) * t - 22,
              width: 44,
              height: 44,
              borderRadius: 22,
              background: C.surface,
              border: `1.5px solid ${C.warn}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: frame >= assignAt(k) - 6 && t < 1 ? 1 : 0,
            }}
          >
            <UserIcon size={24} color={C.warn} />
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 1130, top: 270, width: 650, opacity: target }}>
        <div style={{ fontFamily: fonts.mono, fontSize: 17, letterSpacing: "0.16em", color: C.muted, marginBottom: 14 }}>TIE-BREAKER ROUND · ORDERED BY |P − ½|</div>
        {UNCERTAIN.map((u, k) => (
          <div
            key={u.title}
            style={{
              ...rise(frame, assignAt(k) + 8, 10, 12),
              fontFamily: fonts.mono,
              fontSize: 18,
              color: C.ink2,
              padding: "10px 0",
              borderBottom: `1px solid ${C.line}`,
            }}
          >
            <span style={{ color: C.warn }}>+ {u.judge}</span> → <span style={{ color: C.ink }}>{u.title}</span>
            <div style={{ color: C.muted, fontSize: 15, marginTop: 2 }}>tie-breaker: P(top 3) = {Math.round(u.p * 100)}%</div>
          </div>
        ))}
      </div>
      {UNCERTAIN.map((u, k) => (
        <Sfx key={u.title} name="pop" at={assignAt(k) + 12} />
      ))}

      <div
        style={{
          position: "absolute",
          left: 1130,
          top: 720,
          width: 650,
          fontFamily: fonts.serif,
          fontStyle: "italic",
          fontSize: 40,
          lineHeight: 1.15,
          color: C.ink,
          ...rise(frame, beat(3), 20),
        }}
      >
        Judge time goes where another review can <span style={{ color: C.warn }}>change the outcome</span>.
      </div>
    </SceneShell>
  );
};
