import { useCurrentFrame } from "remotion";
import { ArrowRight } from "../components/Icons";
import { JudgeCard } from "../components/JudgeCard";
import { SceneShell } from "../components/SceneShell";
import { SectionTitle } from "../components/SectionTitle";
import { Sfx } from "../components/Sfx";
import { easeInOut, lerp, pop, progress, rise, windowed } from "../lib/anim";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

const JUDGES = [
  { name: "Judge A", tag: "generous", scores: [9, 9, 10, 9], tone: C.good },
  { name: "Judge B", tag: "harsh", scores: [5, 6, 5, 6], tone: C.bad },
  { name: "Judge C", tag: "flat", scores: [7, 7, 7, 7], tone: C.ink2 },
];

const Step: React.FC<{ label: string; at: number; strike: number }> = ({ label, at, strike }) => {
  const frame = useCurrentFrame();
  const s = pop(frame, at);
  return (
    <div
      style={{
        position: "relative",
        padding: "22px 34px",
        borderRadius: 14,
        background: C.surface,
        border: `1px solid ${C.lineStrong}`,
        fontFamily: fonts.sans,
        fontWeight: 600,
        fontSize: 40,
        color: C.ink,
        opacity: s,
        transform: `scale(${0.9 + 0.1 * s})`,
      }}
    >
      {label}
      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: "50%",
          height: 4,
          background: C.bad,
          transform: `scaleX(${strike})`,
          transformOrigin: "left",
          borderRadius: 2,
        }}
      />
    </div>
  );
};

/** Two equally good projects; the one that drew Judge B loses on luck. */
const LuckDemo: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const bars = [
    { label: "Project X", judge: "reviewed by Judge A", raw: 9.25, color: C.good },
    { label: "Project Y", judge: "reviewed by Judge B", raw: 5.5, color: C.bad },
  ];
  const p = progress(frame, at + 8, 30);
  const truth = progress(frame, at + 50, 20);
  const H = 360;
  return (
    <div style={{ display: "flex", gap: 120, alignItems: "flex-end", position: "relative", height: H + 90 }}>
      {bars.map((b) => (
        <div key={b.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: 220 }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 30, color: b.color }}>{(b.raw * p).toFixed(2)}</div>
          <div style={{ width: 150, height: (b.raw / 10) * H * p, borderRadius: 12, background: `${b.color}cc` }} />
          <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 30, color: C.ink }}>{b.label}</div>
          <div style={{ fontFamily: fonts.mono, fontSize: 17, color: C.muted }}>{b.judge}</div>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: -30,
          right: -30,
          bottom: 90 + 0.74 * H,
          borderTop: `2.5px dashed ${C.accent}`,
          opacity: truth,
        }}
      >
        <span
          style={{
            position: "absolute",
            right: -10,
            top: -40,
            transform: "translateX(100%)",
            fontFamily: fonts.mono,
            fontSize: 20,
            color: C.accent,
            whiteSpace: "nowrap",
          }}
        >
          same true quality
        </span>
      </div>
    </div>
  );
};

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat, beatEnd, duration } = useScene();
  // Beats: 0 Judge A · 1 Judge B · 2 Judge C · 3 average/sort/declare · 4 scale · 5 what-ifs · 6 built to answer
  const cardsUp = progress(frame, beat(3) - 6, 22, easeInOut);
  const cardsOut = progress(frame, beat(4) - 8, 14);
  const pipelineVis = windowed(frame, beat(3), beat(5) - 4, 12);
  const strike = progress(frame, beat(4) + 4, 14);

  const questions = [
    { text: "What if one review changed the winner?", at: beat(5) },
    { text: "What if removing one judge flips it?", at: Math.round((beat(5) + beatEnd(5)) / 2) },
  ];

  return (
    <SceneShell>
      <SectionTitle
        eyebrow="The problem"
        title="Every judge uses the scale differently."
        at={beat(0) - 12}
        size={58}
        style={{ position: "absolute", left: 140, top: 120, opacity: 1 - cardsOut }}
      />

      {/* Judges and their score distributions */}
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 340,
          display: "flex",
          gap: 40,
          opacity: 1 - cardsOut,
          transform: `translateY(${-cardsUp * 120}px) scale(${1 - cardsUp * 0.22})`,
          transformOrigin: "top left",
        }}
      >
        {JUDGES.map((j, i) => (
          <JudgeCard key={j.name} {...j} at={beat(i) - 6} width={500} />
        ))}
      </div>

      {/* The naive pipeline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 560,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 30,
          opacity: pipelineVis * (1 - progress(frame, beat(4) + 30, 14)),
        }}
      >
        <Step label="Average the scores" at={beat(3) + 4} strike={strike} />
        <ArrowRight size={44} color={C.muted} />
        <Step label="Sort" at={beat(3) + 26} strike={strike} />
        <ArrowRight size={44} color={C.muted} />
        <Step label="Declare a winner" at={beat(3) + 46} strike={strike} />
      </div>
      <Sfx name="pop" at={beat(3) + 4} />
      <Sfx name="pop" at={beat(3) + 26} />
      <Sfx name="pop" at={beat(3) + 46} />

      {/* The luck demonstration */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 200,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 36,
          opacity: windowed(frame, beat(4) + 30, beat(5), 12),
        }}
      >
        <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 58, color: C.ink }}>
          Draw the harsh judge, and you lose on <span style={{ color: C.warn }}>luck</span>.
        </div>
        <LuckDemo at={beat(4) + 30} />
      </div>

      {/* What-ifs */}
      <div
        style={{
          position: "absolute",
          left: 160,
          top: 260,
          display: "flex",
          flexDirection: "column",
          gap: 34,
          opacity: 1 - progress(frame, beat(6) - 10, 12),
        }}
      >
        {questions.map((q) => (
          <div key={q.text} style={{ ...rise(frame, q.at, 30), fontFamily: fonts.sans, fontWeight: 600, fontSize: 72, letterSpacing: "-0.035em", color: C.ink }}>
            <span style={{ color: C.warn }}>?</span> {q.text}
          </div>
        ))}
      </div>

      {/* Transition line */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 400,
          textAlign: "center",
          opacity: lerp(frame, [beat(6), beat(6) + 14, duration - 10, duration], [0, 1, 1, 0]),
        }}
      >
        <div style={{ ...rise(frame, beat(6), 20), fontFamily: fonts.serif, fontStyle: "italic", fontSize: 92, color: C.ink }}>
          Dogfood Judge was built to <span style={{ color: C.accent }}>answer</span> them.
        </div>
      </div>
      <Sfx name="whoosh" at={beat(6) - 6} />
    </SceneShell>
  );
};
