import { useCurrentFrame } from "remotion";
import { FlowArrow } from "../components/FlowArrow";
import { type BoardOrder, Leaderboard } from "../components/Leaderboard";
import { MetricBadge } from "../components/MetricBadge";
import { ProbabilityBar } from "../components/ProbabilityBar";
import { RankInterval } from "../components/RankInterval";
import { SceneShell } from "../components/SceneShell";
import { SectionTitle } from "../components/SectionTitle";
import { Sfx } from "../components/Sfx";
import { lerp, pop, progress, rise, windowed } from "../lib/anim";
import { FIXTURE } from "../lib/data";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

// An illustrative event where leniency is real: raw means favour projects that
// drew generous judges; the normalized ranking undoes that.
const ROWS = [
  { id: "a", title: "Paper Comet", judge: "Judge A", raw: 8.9, adj: 6.4 },
  { id: "b", title: "Amber Index", judge: "Judge A", raw: 8.6, adj: 6.9 },
  { id: "c", title: "Cold Atlas", judge: "Judge C", raw: 7.4, adj: 7.6 },
  { id: "d", title: "Fern Socket", judge: "Judge B", raw: 6.3, adj: 8.1 },
  { id: "e", title: "Moss Vector", judge: "Judge C", raw: 7.0, adj: 7.1 },
  { id: "f", title: "Slate Pulse", judge: "Judge B", raw: 5.8, adj: 7.3 },
];
const RAW = [...ROWS].sort((x, y) => y.raw - x.raw).map((r) => r.id);
const ADJ = [...ROWS].sort((x, y) => y.adj - x.adj).map((r) => r.id);

const JUDGE_TONE: Record<string, string> = { "Judge A": C.good, "Judge B": C.bad, "Judge C": C.ink2 };

/** Raw score = quality + generosity: a stacked bar that splits apart. */
const Decompose: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const split = progress(frame, at + 24, 22);
  const grow = progress(frame, at, 22);
  const parts = [
    { label: "how good the project is", w: 520, color: C.accent },
    { label: "how generous its judges were", w: 240, color: C.warn },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 22, color: C.ink2, letterSpacing: "0.1em" }}>RAW SCORE</div>
      <div style={{ display: "flex", gap: 24 * split }}>
        {parts.map((p, i) => (
          <div key={p.label} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                width: p.w * grow,
                height: 64,
                background: split > 0 ? p.color : C.ink2,
                opacity: split > 0 ? 0.85 : 0.6,
                borderRadius: i === 0 ? "12px 0 0 12px" : "0 12px 12px 0",
                ...(split > 0 ? { borderRadius: 12 } : {}),
              }}
            />
            <div style={{ fontFamily: fonts.sans, fontSize: 26, color: p.color, opacity: split }}>{p.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Leniency estimates pulled toward zero; judges with few reviews move most. */
const Shrinkage: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at + 16, 36);
  const judges = [
    { raw: 1.6, n: 3 },
    { raw: 1.1, n: 11 },
    { raw: 0.6, n: 6 },
    { raw: -0.4, n: 9 },
    { raw: -1.3, n: 4 },
    { raw: -1.8, n: 2 },
  ];
  const W = 700;
  const x = (v: number) => W / 2 + (v / 2.2) * (W / 2);
  return (
    <div style={{ position: "relative", width: W, height: 330 }}>
      <div style={{ position: "absolute", left: x(0), top: 0, bottom: 40, width: 2, background: C.lineStrong }} />
      <div style={{ position: "absolute", left: x(0) - 60, bottom: 0, width: 120, textAlign: "center", fontFamily: fonts.mono, fontSize: 16, color: C.muted }}>
        no leniency
      </div>
      {judges.map((j, i) => {
        const shrink = j.n / (j.n + 4); // more reviews → keep more of the raw estimate
        const v = j.raw * (1 - p * (1 - shrink));
        const y = 18 + i * 46;
        return (
          <div key={i}>
            <div style={{ position: "absolute", left: Math.min(x(j.raw), x(v)), top: y + 13, width: Math.abs(x(j.raw) - x(v)), height: 2, background: `${C.accent}55` }} />
            <div style={{ position: "absolute", left: x(j.raw) - 6, top: y + 8, width: 12, height: 12, borderRadius: 6, border: `1.5px solid ${C.muted}`, opacity: p }} />
            <div
              style={{
                position: "absolute",
                left: x(v) - 4 - j.n,
                top: y + 10 - j.n,
                width: 8 + j.n * 2,
                height: 8 + j.n * 2,
                borderRadius: "50%",
                background: v > 0 ? C.good : C.bad,
                opacity: 0.9,
              }}
            />
            <div style={{ position: "absolute", left: W + 20, top: y + 2, fontFamily: fonts.mono, fontSize: 15, color: C.muted, whiteSpace: "nowrap" }}>
              {j.n} reviews
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const NormalizationScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat } = useScene();
  // Beats: 0 engine · 1 raw = quality + generosity · 2 model leniency/scale · 3 shrinkage · 4 error bars
  const titleOut = progress(frame, beat(1) - 6, 12);
  const decompVis = windowed(frame, beat(1), beat(2) + 4, 12);
  const engineVis = windowed(frame, beat(2), beat(3) + 4, 12);
  const shrinkVis = windowed(frame, beat(3), beat(4) + 4, 12);
  const uncVis = progress(frame, beat(4), 14);

  const reorderAt = beat(2) + 44;
  const orders: BoardOrder[] = [
    { at: 0, order: RAW },
    { at: reorderAt, order: ADJ },
  ];

  return (
    <SceneShell glow="rgba(56,214,245,0.07)">
      <div style={{ position: "absolute", left: 0, right: 0, top: 360, opacity: 1 - titleOut }}>
        <SectionTitle eyebrow="The judging engine" title="Most platforms stop at the average." align="center" at={beat(0) - 8} size={84} />
        <div style={{ ...rise(frame, beat(0) + 16, 16), textAlign: "center", marginTop: 26, fontFamily: fonts.serif, fontStyle: "italic", fontSize: 52, color: C.accent }}>
          This is where Dogfood starts.
        </div>
      </div>

      {/* raw = quality + generosity */}
      <div style={{ position: "absolute", left: 260, top: 400, opacity: decompVis }}>
        <Decompose at={beat(1)} />
      </div>

      {/* raw rank → engine → normalized rank */}
      <div style={{ opacity: engineVis }}>
        <div style={{ position: "absolute", left: 150, top: 150, fontFamily: fonts.mono, fontSize: 20, letterSpacing: "0.18em", color: C.muted }}>RAW RANK</div>
        <div style={{ position: "absolute", left: 1170, top: 150, fontFamily: fonts.mono, fontSize: 20, letterSpacing: "0.18em", color: C.accent }}>
          NORMALIZED RANK
        </div>
        <Leaderboard
          style={{ position: "absolute", left: 150, top: 200 }}
          rows={ROWS.map((r) => ({ id: r.id, title: r.title, sub: r.judge, value: r.raw.toFixed(1) }))}
          orders={[{ at: 0, order: RAW }]}
          width={560}
          rowHeight={84}
          right={(row) => <span style={{ width: 10, height: 10, borderRadius: 5, background: JUDGE_TONE[row.sub ?? ""] }} />}
        />
        <div
          style={{
            position: "absolute",
            left: 770,
            top: 330,
            width: 340,
            height: 250,
            borderRadius: 20,
            border: `1.5px solid ${C.accent}66`,
            background: C.surface,
            boxShadow: `0 0 80px -30px ${C.glow}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            opacity: pop(frame, beat(2) + 10),
          }}
        >
          <div style={{ fontFamily: fonts.mono, fontSize: 16, letterSpacing: "0.18em", color: C.accent }}>MODEL</div>
          <div style={{ fontFamily: fonts.mono, fontSize: 26, color: C.ink }}>
            x = μ + b<sub>j</sub> + s<sub>j</sub>·q<sub>p</sub>
          </div>
          <div style={{ fontFamily: fonts.sans, fontSize: 18, color: C.ink2, textAlign: "center", lineHeight: 1.4 }}>
            leniency b, scale s per judge,
            <br />
            quality q per project
          </div>
        </div>
        <FlowArrow x1={720} y1={455} x2={765} y2={455} at={beat(2) + 14} color={C.accent} />
        <FlowArrow x1={1115} y1={455} x2={1160} y2={455} at={beat(2) + 30} color={C.accent} />
        <Leaderboard
          style={{ position: "absolute", left: 1170, top: 200, opacity: progress(frame, beat(2) + 30, 12) }}
          rows={ROWS.map((r) => ({
            id: r.id,
            title: r.title,
            sub: r.judge,
            value: (frame >= reorderAt ? lerp(frame, [reorderAt, reorderAt + 16], [r.raw, r.adj]) : r.raw).toFixed(1),
          }))}
          orders={orders}
          width={560}
          rowHeight={84}
          moveFrames={22}
          highlight={frame >= reorderAt + 10 ? "d" : null}
          right={(row) => <span style={{ width: 10, height: 10, borderRadius: 5, background: JUDGE_TONE[row.sub ?? ""] }} />}
        />
      </div>
      <div style={{ position: "absolute", left: 150, top: 720, fontFamily: fonts.mono, fontSize: 16, color: C.muted, opacity: engineVis }}>
        example event with real leniency · on the DOGFOOD fixture the correction is small, and the report says so
      </div>
      <Sfx name="whoosh" at={reorderAt - 4} />
      <Sfx name="impact" at={reorderAt} volume={0.35} />

      {/* empirical-Bayes shrinkage */}
      <div style={{ opacity: shrinkVis }}>
        <SectionTitle eyebrow="Empirical-Bayes shrinkage" title="Correct only what the data supports." at={beat(3)} size={56} style={{ position: "absolute", left: 160, top: 150 }} />
        <div style={{ position: "absolute", left: 260, top: 340 }}>
          <Shrinkage at={beat(3)} />
        </div>
        <div style={{ position: "absolute", left: 1220, top: 380, width: 520, fontFamily: fonts.sans, fontSize: 28, lineHeight: 1.45, color: C.ink2, ...rise(frame, beat(3) + 30, 20) }}>
          A judge with <span style={{ color: C.ink }}>3 reviews</span> is pulled toward zero. A judge with <span style={{ color: C.ink }}>11</span> keeps
          their estimate. No real leniency → almost no correction.
        </div>
      </div>

      {/* never rank without error bars */}
      <div style={{ opacity: uncVis }}>
        <div style={{ position: "absolute", left: 160, top: 150, display: "flex", alignItems: "center", gap: 40 }}>
          <div style={{ position: "relative", fontFamily: fonts.sans, fontWeight: 600, fontSize: 64, color: C.muted, letterSpacing: "-0.03em" }}>
            {FIXTURE.winner} = #1
            <div
              style={{
                position: "absolute",
                left: -6,
                right: -6,
                top: "52%",
                height: 5,
                background: C.bad,
                transform: `scaleX(${progress(frame, beat(4) + 14, 12)})`,
                transformOrigin: "left",
              }}
            />
          </div>
        </div>
        <div style={{ position: "absolute", left: 160, top: 290, ...rise(frame, beat(4) + 20, 24) }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.16em", color: C.muted, marginBottom: 18 }}>90% RANK INTERVAL · {FIXTURE.winner.toUpperCase()}</div>
          <RankInterval lo={FIXTURE.leaderInterval[0]} hi={FIXTURE.leaderInterval[1]} rank={1} maxRank={10} at={beat(4) + 26} width={760} />
        </div>
        <div style={{ position: "absolute", left: 160, top: 470, display: "flex", gap: 26 }}>
          <MetricBadge label="Rank interval" value="1 – 6" at={beat(4) + 34} tone="accent" width={300} />
          <MetricBadge
            label="P(Top 3)"
            value={`${Math.round(FIXTURE.pTop3Leader * 100)}%`}
            at={beat(4) + 44}
            tone="warn"
            width={300}
            sub={<ProbabilityBar value={FIXTURE.pTop3Leader} at={beat(4) + 44} width={200} height={8} showValue={false} midline color={C.warn} />}
          />
          <MetricBadge label="Ahead of next" value={`${FIXTURE.leadSE} SE`} at={beat(4) + 54} tone="bad" width={300} sub="a statistical tie" />
        </div>
        <div style={{ position: "absolute", left: 1170, top: 300, width: 560, ...rise(frame, beat(4) + 60, 20) }}>
          <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 50, lineHeight: 1.15, color: C.ink }}>
            The data doesn't crown a clear winner — and the page <span style={{ color: C.accent }}>says so</span>.
          </div>
          <div style={{ marginTop: 18, fontFamily: fonts.mono, fontSize: 16, color: C.muted }}>bootstrap · 300 replicates · fixed seed</div>
        </div>
      </div>
      <Sfx name="pop" at={beat(4) + 34} />
      <Sfx name="pop" at={beat(4) + 44} />
      <Sfx name="pop" at={beat(4) + 54} />
    </SceneShell>
  );
};
