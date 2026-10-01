import { useCurrentFrame } from "remotion";
import { CheckIcon } from "../components/Icons";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { type TermLine, TerminalWindow } from "../components/TerminalWindow";
import { pop, progress, rise } from "../lib/anim";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

// What tests/ and tools/extended_check.py exercise against the real portal.
const COVERED = [
  "44-case authorization matrix",
  "Deadlines enforced in the database",
  "Conflict-of-interest triggers",
  "Audit-chain tamper detection",
  "CSRF protection",
  "CSV formula injection",
  "Login rate limiting",
  "Signed webhooks + retries",
  "Import / export round trip",
  "Verifiable results bundle",
  "Merkle inclusion proofs",
  "Tie-breaker targeting",
  "Planted rogue review is caught",
  "Hidden results while voting",
];

export const EngineeringScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat, beatEnd } = useScene();
  // Beats: 0 tested end to end · 1 real SQLite + HTTP · 2 checkers T1–T4 · 3 what's covered
  const b2 = beat(2);
  const mid = Math.round((beat(2) + beatEnd(2)) / 2);
  const lines: TermLine[] = [
    { at: beat(0), text: "docker compose up -d", kind: "cmd", speed: 2.5 },
    { at: beat(0) + 14, text: "✓ Container dogfood-api   Healthy", kind: "ok" },
    { at: beat(0) + 18, text: "✓ Container dogfood-web   Started", kind: "ok" },
    { at: beat(1) - 6, text: "go test ./...", kind: "cmd", speed: 2.5 },
    { at: beat(1) + 20, text: "ok    dogfood/src/judging    6.2s" },
    { at: beat(1) + 40, text: "ok    dogfood/tests         24.8s   (real SQLite, real HTTP)" },
    { at: b2 - 4, text: "python3 run.py .dogfood.toml", kind: "cmd", speed: 2.8 },
    { at: b2 + 16, text: "T2  judge cannot see peer scores ...... PASS" },
    { at: b2 + 20, text: "claimed T1 T2 T3 T4, verified T1 T2", kind: "accent" },
    { at: mid - 6, text: "python3 tools/extended_check.py .dogfood.toml", kind: "cmd", speed: 3.2 },
    { at: mid + 14, text: "T3: 11/11 checks passed", kind: "ok" },
    { at: mid + 18, text: "T4: 9/9 checks passed", kind: "ok" },
    { at: mid + 22, text: "BONUS: 4/4 checks passed", kind: "ok" },
  ];
  const tiers = [
    { t: "T1", at: b2 + 20 },
    { t: "T2", at: b2 + 24 },
    { t: "T3", at: mid + 14 },
    { t: "T4", at: mid + 18 },
  ];
  const wall = progress(frame, beat(3), 12);

  return (
    <SceneShell>
      <div style={{ position: "absolute", left: 120, top: 112, ...rise(frame, beat(0) - 6, 16) }}>
        <div style={{ fontFamily: fonts.mono, fontSize: 20, letterSpacing: "0.22em", color: C.accent }}>BUILT TO BE TESTED</div>
      </div>
      <div style={{ position: "absolute", left: 120, top: 160, transform: `scale(${1 - wall * 0.2})`, transformOrigin: "top left" }}>
        <TerminalWindow lines={lines} width={1040} height={600} fontSize={20} title="dogfood-judge — tests" />
      </div>

      {/* Tier badges */}
      <div style={{ position: "absolute", left: 1220, top: 170, display: "grid", gridTemplateColumns: "repeat(2, 260px)", gap: 20 }}>
        {tiers.map(({ t, at }) => {
          const s = pop(frame, at, 11);
          return (
            <div
              key={t}
              style={{
                height: 130,
                borderRadius: 18,
                border: `1.5px solid ${s > 0.1 ? C.good : C.line}`,
                background: s > 0.1 ? `${C.good}12` : C.surface,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 18,
                transform: `scale(${0.9 + 0.1 * s})`,
              }}
            >
              <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 56, color: s > 0.1 ? C.ink : C.muted }}>{t}</span>
              <span style={{ opacity: s }}>
                <CheckIcon size={50} color={C.good} stroke={3} />
              </span>
            </div>
          );
        })}
      </div>
      {tiers.map(({ t, at }) => (
        <Sfx key={t} name="success" at={at} volume={0.45} />
      ))}

      {/* What the suite covers */}
      <div style={{ position: "absolute", left: 120, top: 680, width: 1680, display: "flex", flexWrap: "wrap", gap: 12, opacity: wall }}>
        {COVERED.map((c, i) => {
          const on = frame >= beat(3) + 6 + i * 5;
          return (
            <span
              key={c}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 16px",
                borderRadius: 999,
                fontFamily: fonts.mono,
                fontSize: 17,
                color: on ? C.ink : C.muted,
                background: on ? `${C.accent}12` : C.surface,
                border: `1px solid ${on ? `${C.accent}66` : C.line}`,
              }}
            >
              {on ? <CheckIcon size={16} color={C.accent} stroke={2.6} /> : null}
              {c}
            </span>
          );
        })}
      </div>
      {COVERED.map((c, i) => (
        <Sfx key={c} name="tick" at={beat(3) + 6 + i * 5} volume={0.35} />
      ))}
    </SceneShell>
  );
};
