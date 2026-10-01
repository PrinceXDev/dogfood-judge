import { useCurrentFrame } from "remotion";
import { BrowserWindow } from "../components/BrowserWindow";
import { CheckIcon, DbIcon, LockIcon, ServerIcon, ShieldIcon, UserIcon } from "../components/Icons";
import { AssignmentRows, Rubric } from "../components/MockScreens";
import { SceneShell } from "../components/SceneShell";
import { SectionTitle } from "../components/SectionTitle";
import { Sfx } from "../components/Sfx";
import { ease, lerp, pop, progress, rise, windowed } from "../lib/anim";
import { FIXTURE } from "../lib/data";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

const CONSTRAINTS = [
  ["Track match", "judges review their own tracks"],
  ["No conflicts of interest", "enforced by a database trigger"],
  ["Balanced load", "2–11 reviews per judge"],
  ["Connected review graph", "so judges can be compared"],
];

const ROLES = ["visitor", "participant", "judge", "organizer"];

const Node: React.FC<{ x: number; icon: React.ReactNode; title: string; sub: string; tone?: string; s: number }> = ({
  x,
  icon,
  title,
  sub,
  tone = C.ink2,
  s,
}) => (
  <div
    style={{
      position: "absolute",
      left: x - 130,
      top: 300,
      width: 260,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 14,
      opacity: s,
      transform: `translateY(${(1 - s) * 20}px)`,
    }}
  >
    <div
      style={{
        width: 120,
        height: 120,
        borderRadius: 28,
        background: C.surface,
        border: `1.5px solid ${tone}66`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {icon}
    </div>
    <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 26, color: C.ink }}>{title}</div>
    <div style={{ fontFamily: fonts.mono, fontSize: 16, color: C.muted }}>{sub}</div>
  </div>
);

export const JudgeIsolationScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat } = useScene();
  const p1 = windowed(frame, 0, beat(1) + 6, 12);
  const p2 = progress(frame, beat(1) - 4, 14);
  const hit = beat(2) + 4;
  const p3 = progress(frame, beat(3), 16);

  // The request packet: out to the API, then bounced back.
  const out = progress(frame, beat(1) + 20, hit - beat(1) - 20, ease);
  const back = progress(frame, hit + 10, 22, ease);
  const JX = 420;
  const AX = 960;
  const DX = 1500;
  const packetX = JX + 70 + (AX - 150 - JX - 70) * out - (AX - 150 - JX - 70) * back;
  const denied = frame >= hit;
  const shake = denied ? Math.sin((frame - hit) * 2.2) * 10 * Math.max(0, 1 - (frame - hit) / 14) : 0;

  return (
    <SceneShell>
      {/* Phase 1: the judge's view */}
      <div style={{ opacity: p1 }}>
        <SectionTitle eyebrow="Secure judging" title="Every assignment has a reason." at={0} size={56} style={{ position: "absolute", left: 140, top: 120 }} />
        <div style={{ position: "absolute", left: 140, top: 270, ...rise(frame, 6, 40) }}>
          <BrowserWindow url="localhost:8080/judging" width={900} height={540}>
            <div style={{ position: "absolute", inset: 0, background: C.bg, padding: 26, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 24, color: C.ink }}>Your queue · jonas.vogel</div>
              {AssignmentRows.slice(0, 2).map(([p, why], i) => (
                <div
                  key={p}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderRadius: 10,
                    border: `1px solid ${C.line}`,
                    background: C.surface2,
                    opacity: pop(frame, 16 + i * 6),
                  }}
                >
                  <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 18, color: C.ink }}>{p}</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: 14, color: C.accent }}>{why}</span>
                </div>
              ))}
              <Rubric at={30} />
            </div>
          </BrowserWindow>
        </div>
        <div style={{ position: "absolute", left: 1110, top: 290, display: "flex", flexDirection: "column", gap: 18 }}>
          {CONSTRAINTS.map(([t, d], i) => {
            const s = pop(frame, 14 + i * 9);
            return (
              <div
                key={t}
                style={{
                  width: 640,
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  padding: "18px 22px",
                  borderRadius: 14,
                  background: C.surface,
                  border: `1px solid ${C.line}`,
                  opacity: s,
                  transform: `translateX(${(1 - s) * 30}px)`,
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 20, background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CheckIcon size={22} color={C.accent} />
                </div>
                <div>
                  <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 24, color: C.ink }}>{t}</div>
                  <div style={{ fontFamily: fonts.mono, fontSize: 15, color: C.muted }}>{d}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {CONSTRAINTS.map((c, i) => (
        <Sfx key={c[0]} name="tick" at={14 + i * 9} volume={0.6} />
      ))}

      {/* Phase 2: one judge asks for another judge's scores */}
      <div style={{ opacity: p2, transform: `translateY(${-p3 * 90}px) scale(${1 - p3 * 0.12})`, transformOrigin: "50% 30%" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center", ...rise(frame, beat(1), 20) }}>
          <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 64, color: C.ink }}>
            Judge B asks for Judge A's scores…
          </span>
        </div>
        {/* wires */}
        <div style={{ position: "absolute", left: JX + 70, top: 360, width: AX - JX - 140, height: 2, background: C.lineStrong }} />
        <div style={{ position: "absolute", left: AX + 70, top: 360, width: DX - AX - 140, height: 2, background: C.lineStrong, opacity: 0.5 }} />
        <Node x={JX} s={pop(frame, beat(1))} icon={<UserIcon size={56} color={C.warn} />} title="Judge B" sub="jdg_24 · bearer token" tone={C.warn} />
        <div style={{ transform: `translateX(${shake}px)` }}>
          <Node
            x={AX}
            s={pop(frame, beat(1) + 6)}
            icon={denied ? <ShieldIcon size={60} color={C.bad} /> : <ServerIcon size={56} color={C.accent} />}
            title="Go API"
            sub="role check on every request"
            tone={denied ? C.bad : C.accent}
          />
        </div>
        <Node x={DX} s={pop(frame, beat(1) + 12)} icon={<DbIcon size={56} color={C.ink2} />} title="SQLite" sub="jdg_26's scores" />
        {/* request packet */}
        <div
          style={{
            position: "absolute",
            left: packetX,
            top: 300,
            transform: "translate(-50%, -100%)",
            opacity: out > 0 ? 1 - progress(frame, hit + 26, 10) : 0,
            padding: "10px 16px",
            borderRadius: 10,
            background: denied ? `${C.bad}1a` : C.surface2,
            border: `1px solid ${denied ? C.bad : C.lineStrong}`,
            fontFamily: fonts.mono,
            fontSize: 17,
            color: denied ? C.bad : C.ink,
            whiteSpace: "nowrap",
          }}
        >
          GET /api/v1/judge/scores?judge=jdg_26
        </div>
        {/* 403 stamp */}
        {denied ? (
          <div
            style={{
              position: "absolute",
              left: AX,
              top: 520,
              transform: `translateX(-50%) scale(${1.4 - 0.4 * pop(frame, hit, 10, 0.5)}) rotate(-4deg)`,
              opacity: Math.min(1, pop(frame, hit, 10, 0.5) * 1.4),
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "14px 28px",
              borderRadius: 12,
              border: `3px solid ${C.bad}`,
              background: `${C.bad}14`,
              boxShadow: `0 0 60px -10px ${C.bad}`,
            }}
          >
            <LockIcon size={40} color={C.bad} stroke={2.4} />
            <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 52, letterSpacing: "0.06em", color: C.bad }}>403 FORBIDDEN</span>
          </div>
        ) : null}
      </div>
      <Sfx name="whoosh" at={beat(1) + 20} volume={0.6} />
      <Sfx name="deny" at={hit} />
      <Sfx name="lock" at={hit + 2} />

      {/* Phase 3: enforced by the backend, proven by a 44-case matrix */}
      <div style={{ opacity: p3 }}>
        <div style={{ position: "absolute", left: 160, top: 640, width: 760 }}>
          <div style={{ ...rise(frame, beat(3), 20), fontFamily: fonts.sans, fontWeight: 600, fontSize: 46, lineHeight: 1.12, letterSpacing: "-0.03em", color: C.ink }}>
            Enforced by the backend.
            <br />
            <span style={{ color: C.muted }}>Not hidden by the UI.</span>
          </div>
        </div>
        <div style={{ position: "absolute", left: 980, top: 600 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
            <span style={{ fontFamily: fonts.mono, fontSize: 40, fontWeight: 600, color: C.accent }}>
              {Math.round(lerp(frame, [beat(3) + 6, beat(3) + 50], [0, FIXTURE.authCases]))}
            </span>
            <span style={{ fontFamily: fonts.mono, fontSize: 17, letterSpacing: "0.14em", color: C.ink2 }}>
              / {FIXTURE.authCases} AUTHORIZATION CASES · TestAuthorizationMatrix
            </span>
          </div>
          {ROLES.map((r, ri) => (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 120, fontFamily: fonts.mono, fontSize: 15, color: C.muted }}>{r}</span>
              {Array.from({ length: 11 }, (_, ci) => {
                const i = ri * 11 + ci;
                const on = frame >= beat(3) + 6 + i;
                const allowed = (ri === 3 && ci < 9) || (ri === 2 && ci < 4) || (ri === 1 && ci < 2) || ci === 0;
                return (
                  <span
                    key={ci}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: on ? (allowed ? `${C.good}22` : `${C.bad}1c`) : C.surface,
                      border: `1px solid ${on ? (allowed ? `${C.good}66` : `${C.bad}55`) : C.line}`,
                    }}
                  >
                    {on ? allowed ? <CheckIcon size={16} color={C.good} /> : <LockIcon size={14} color={C.bad} /> : null}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </SceneShell>
  );
};
