import { Img, staticFile, useCurrentFrame } from "remotion";
import { progress } from "../lib/anim";
import { SCREENSHOTS, type ScreenKey } from "../lib/assets";
import { C, fonts } from "../lib/theme";
import { CheckIcon } from "./Icons";
import { LogoMark } from "./Logo";

// Lightweight recreations of the product's pages, in its own design tokens.
// Each is a stand-in for a real screenshot (see lib/assets.ts).

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: fonts.mono, fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", color: C.muted }}>
    {children}
  </div>
);

const Box: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, ...style }}>{children}</div>
);

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <Label>{label}</Label>
    <div style={{ padding: "12px 14px", borderRadius: 10, background: C.bg, border: `1px solid ${C.lineStrong}`, fontFamily: fonts.sans, fontSize: 19, color: C.ink }}>
      {value}
    </div>
  </div>
);

const Chip: React.FC<{ children: React.ReactNode; tone?: string }> = ({ children, tone = C.ink2 }) => (
  <span style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${tone}55`, color: tone, fontFamily: fonts.mono, fontSize: 14 }}>
    {children}
  </span>
);

const Create = () => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
    <Field label="Event name" value="Sample Hack 2026" />
    <Field label="Judging closes" value="2026-03-02 18:00 UTC" />
    <div style={{ gridColumn: "1 / 3", display: "flex", flexDirection: "column", gap: 10 }}>
      <Label>Tracks</Label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {["Developer tools", "Fintech", "Climate", "Health", "Education", "Civic"].map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
      </div>
    </div>
    {[
      ["Functionality", 0.4],
      ["Quality", 0.35],
      ["Innovation", 0.25],
    ].map(([k, w]) => (
      <Box key={k as string} style={{ display: "flex", alignItems: "center", gap: 14, gridColumn: "1 / 3" }}>
        <span style={{ width: 170, fontFamily: fonts.sans, fontSize: 18, color: C.ink }}>{k}</span>
        <div style={{ flex: 1, height: 8, background: C.line, borderRadius: 4 }}>
          <div style={{ width: `${(w as number) * 200}%`, maxWidth: "100%", height: 8, background: C.accent, borderRadius: 4 }} />
        </div>
        <span style={{ fontFamily: fonts.mono, fontSize: 16, color: C.ink2 }}>{Math.round((w as number) * 100)}%</span>
      </Box>
    ))}
  </div>
);

const Teams = () => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
    {["NorthKiln", "Brass Owl", "Tidewater", "Fable Labs", "Quiet Ops", "Lumen"].map((t, i) => (
      <Box key={t}>
        <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 20, color: C.ink }}>{t}</div>
        <div style={{ display: "flex", marginTop: 14 }}>
          {[0, 1, 2].slice(0, 2 + (i % 2)).map((m) => (
            <span key={m} style={{ width: 34, height: 34, borderRadius: 17, marginLeft: m ? -10 : 0, background: [C.accent, C.accent2, C.warn][m], border: `2px solid ${C.surface2}`, opacity: 0.85 }} />
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <Chip tone={i < 4 ? C.good : C.warn}>{i < 4 ? "submitted" : "draft"}</Chip>
        </div>
      </Box>
    ))}
  </div>
);

const Submissions = () => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
    {["Glass Signal", "Salt Ledger", "Iron Switch", "Salt Loom", "Dry Relay", "North Drift", "Small Relay", "Quiet Forge"].map((t, i) => (
      <Box key={t} style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ height: 70, background: `linear-gradient(135deg, ${[C.accent, C.accent2, C.info, C.warn][i % 4]}22, transparent)` }} />
        <div style={{ padding: 14 }}>
          <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 18, color: C.ink }}>{t}</div>
          <div style={{ fontFamily: fonts.mono, fontSize: 13, color: C.muted, marginTop: 4 }}>prj_{String(i * 5 + 1).padStart(2, "0")}</div>
        </div>
      </Box>
    ))}
  </div>
);

export const AssignmentRows = [
  ["Salt Ledger", "track match · bridges two judge groups"],
  ["Dry Relay", "track match · least co-review overlap"],
  ["Glass Signal", "track match · lowest load"],
  ["Quiet Forge", "off-track fallback · no conflict-free match"],
];

const Assignment = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {AssignmentRows.map(([p, why], i) => (
      <Box key={p} style={{ display: "flex", alignItems: "center", gap: 18, padding: "14px 18px" }}>
        <span style={{ fontFamily: fonts.mono, fontSize: 15, color: C.muted, width: 70 }}>jdg_{[26, 24, 9, 13][i]}</span>
        <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 19, color: C.ink, width: 180 }}>{p}</span>
        <span style={{ fontFamily: fonts.mono, fontSize: 15, color: i === 3 ? C.warn : C.accent }}>{why}</span>
      </Box>
    ))}
    <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
      <Chip tone={C.good}>load 2–11</Chip>
      <Chip tone={C.good}>1 connected component</Chip>
      <Chip>8 new assignments</Chip>
    </div>
  </div>
);

export const Rubric: React.FC<{ at?: number }> = ({ at = 0 }) => {
  const frame = useCurrentFrame();
  const crit = [
    ["Functionality", 4],
    ["Quality", 3],
    ["Innovation", 5],
  ] as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {crit.map(([k, v], i) => {
        const p = progress(frame, at + i * 10, 18);
        return (
          <Box key={k} style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span style={{ width: 160, fontFamily: fonts.sans, fontSize: 19, color: C.ink }}>{k}</span>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  style={{
                    width: 44,
                    height: 40,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: fonts.mono,
                    fontSize: 17,
                    border: `1px solid ${n === v && p > 0.5 ? C.accent : C.lineStrong}`,
                    background: n === v && p > 0.5 ? C.accent : "transparent",
                    color: n === v && p > 0.5 ? C.accentInk : C.ink2,
                  }}
                >
                  {n}
                </span>
              ))}
            </div>
          </Box>
        );
      })}
    </div>
  );
};

const Analysis = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <Box style={{ borderColor: `${C.warn}66`, background: `${C.warn}0d` }}>
      <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 24, color: C.ink }}>Is the winner defensible?</div>
      <div style={{ fontFamily: fonts.sans, fontSize: 17, color: C.ink2, marginTop: 6 }}>
        First place holds in 24 of 30 refits · lead 0.05 SE · statistical tie
      </div>
    </Box>
    {["Salt Ledger", "Iron Switch", "Salt Loom", "Dry Relay"].map((t, i) => (
      <div key={t} style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontFamily: fonts.mono, fontSize: 15, color: C.muted, width: 24 }}>{i + 1}</span>
        <span style={{ fontFamily: fonts.sans, fontSize: 18, color: C.ink, width: 150 }}>{t}</span>
        <div style={{ flex: 1, height: 14, position: "relative" }}>
          <div style={{ position: "absolute", left: `${i * 6}%`, width: `${36 + i * 8}%`, height: 14, borderRadius: 7, background: `${C.accent}30`, border: `1px solid ${C.accent}` }} />
        </div>
        <span style={{ fontFamily: fonts.mono, fontSize: 15, color: C.ink2, width: 60 }}>{[51, 62, 49, 24][i]}%</span>
      </div>
    ))}
  </div>
);

const Publish = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
    {["Judging closed", "Voting closed", "Duplicates excluded (prj_41)", "Audit chain intact"].map((t) => (
      <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: fonts.sans, fontSize: 20, color: C.ink }}>
        <CheckIcon size={22} color={C.good} /> {t}
      </div>
    ))}
    <div style={{ marginTop: 14, padding: "16px 30px", borderRadius: 12, background: C.accent, color: C.accentInk, fontFamily: fonts.sans, fontWeight: 600, fontSize: 22 }}>
      Publish results
    </div>
  </div>
);

const Verify = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <Box style={{ fontFamily: fonts.mono, fontSize: 14, color: C.muted, height: 90 }}>
      {'{ "type": "dogfood.record/v2", "pseudonym": "J-3f9c…", "leaves": [ … ] }'}
    </Box>
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: fonts.sans, fontWeight: 600, fontSize: 24, color: C.good }}>
      <CheckIcon size={30} color={C.good} /> All 4 of your reviews are in the published results, unchanged.
    </div>
  </div>
);

const SCREENS: Record<ScreenKey, { title: string; Body: React.FC }> = {
  create: { title: "New event", Body: Create },
  teams: { title: "Teams", Body: Teams },
  submissions: { title: "Submissions", Body: Submissions },
  assignment: { title: "Assignments", Body: Assignment },
  scoring: { title: "Score · Salt Ledger", Body: Rubric },
  analysis: { title: "Results · Sample Hack 2026", Body: Analysis },
  publish: { title: "Publish", Body: Publish },
  verify: { title: "Verify a judge record", Body: Verify },
};

/** An app page: real screenshot if provided, otherwise the mock. */
export const MockScreen: React.FC<{ screen: ScreenKey }> = ({ screen }) => {
  const shot = SCREENSHOTS[screen];
  if (shot) {
    return <Img src={staticFile(shot)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />;
  }
  const s = SCREENS[screen];
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: C.bg }}>
      <div style={{ width: 220, borderRight: `1px solid ${C.line}`, padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LogoMark size={26} id={`mock-${screen}`} />
          <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 17, color: C.ink }}>dogfood</span>
        </div>
        {["Dashboard", "Judging", "Results", "Audit", "Settings"].map((n, i) => (
          <div key={n} style={{ fontFamily: fonts.sans, fontSize: 16, color: i === 0 ? C.ink : C.muted }}>
            {n}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "26px 34px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 28, color: C.ink, letterSpacing: "-0.02em" }}>{s.title}</div>
        <s.Body />
      </div>
    </div>
  );
};
