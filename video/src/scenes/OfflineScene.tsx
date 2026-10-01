import { useCurrentFrame } from "remotion";
import { BrowserWindow } from "../components/BrowserWindow";
import { WifiIcon } from "../components/Icons";
import { MockScreen } from "../components/MockScreens";
import { SceneShell } from "../components/SceneShell";
import { SectionTitle } from "../components/SectionTitle";
import { Sfx } from "../components/Sfx";
import { type TermLine, TerminalWindow } from "../components/TerminalWindow";
import { pop, progress, rise } from "../lib/anim";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

export const OfflineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat } = useScene();
  // Beats: 0 your own machine · 1 docker compose up · 2 network off, still running
  const offAt = beat(2) + 24;
  const off = frame >= offAt;
  const knob = progress(frame, offAt, 8);
  const lines: TermLine[] = [
    { at: beat(1), text: "docker compose up", kind: "cmd", speed: 2 },
    { at: beat(1) + 16, text: "api  | seeded Sample Hack 2026 (41 projects, 30 judges)", kind: "dim" },
    { at: beat(1) + 22, text: "api  | listening on :8080", kind: "out" },
    { at: beat(1) + 28, text: "web  | ✓ Ready", kind: "ok" },
    { at: offAt + 6, text: "net  | interface down", kind: "warn" },
    { at: offAt + 30, text: "api  | GET /api/v1/events/evt_01/results 200", kind: "out" },
  ];

  return (
    <SceneShell>
      <SectionTitle eyebrow="Offline · self-hosted" title="It all runs on your own machine." at={beat(0) - 6} size={56} style={{ position: "absolute", left: 140, top: 110 }} />

      <div style={{ position: "absolute", left: 140, top: 290, ...rise(frame, beat(0) + 6, 30) }}>
        <TerminalWindow lines={lines} width={820} height={380} fontSize={18} title="~/dogfood-judge" />
      </div>

      <div style={{ position: "absolute", left: 1010, top: 290, ...rise(frame, beat(0) + 12, 30) }}>
        <BrowserWindow url="localhost:8080" width={780} height={380}>
          <div style={{ position: "absolute", inset: 0, transform: "scale(0.82)", transformOrigin: "top left", width: "122%", height: "122%" }}>
            <MockScreen screen="analysis" />
          </div>
          <div
            style={{
              position: "absolute",
              right: 16,
              top: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: 999,
              background: C.surface2,
              border: `1px solid ${C.line}`,
              fontFamily: fonts.mono,
              fontSize: 14,
              color: C.good,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: C.good, opacity: 0.6 + 0.4 * Math.sin(frame * 0.2) }} />
            STILL RUNNING
          </div>
        </BrowserWindow>
      </div>

      {/* Network switch */}
      <div style={{ position: "absolute", left: 140, top: 712, display: "flex", alignItems: "center", gap: 40, opacity: pop(frame, beat(2)) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <WifiIcon size={40} color={off ? C.bad : C.ink2} off={off} />
          <span style={{ fontFamily: fonts.mono, fontSize: 22, color: C.ink2 }}>Internet</span>
          <div style={{ width: 78, height: 40, borderRadius: 20, background: off ? C.surface2 : C.accent, border: `1px solid ${C.lineStrong}`, position: "relative" }}>
            <div style={{ position: "absolute", top: 4, left: 4 + 38 * (1 - knob), width: 30, height: 30, borderRadius: 15, background: off ? C.muted : C.accentInk }} />
          </div>
          <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 22, color: off ? C.bad : C.accent }}>{off ? "OFF" : "ON"}</span>
        </div>
        <div style={{ fontFamily: fonts.mono, fontSize: 22, color: C.ink2, opacity: progress(frame, offAt + 10, 12) }}>
          outbound requests: <span style={{ color: C.good, fontWeight: 600 }}>0</span>
        </div>
      </div>
      <Sfx name="lock" at={offAt} />

      <div style={{ position: "absolute", left: 140, top: 790, display: "flex", gap: 12 }}>
        {["Go + SQLite + Next.js", "One SQLite file", "No cloud accounts", "No external APIs"].map((t, i) => {
          const s = pop(frame, offAt + 16 + i * 5);
          return (
            <span key={t} style={{ padding: "8px 16px", borderRadius: 999, border: `1px solid ${C.lineStrong}`, fontFamily: fonts.mono, fontSize: 17, color: C.ink2, opacity: s }}>
              {t}
            </span>
          );
        })}
      </div>
    </SceneShell>
  );
};
