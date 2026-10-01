import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from "remotion";
import { Captions } from "./components/Captions";
import { ChapterLabel } from "./components/ChapterLabel";
import { PresenterBadge } from "./components/PresenterBadge";
import { AUDIO } from "./lib/audio";
import { SceneProvider } from "./lib/scene";
import { type SceneId, TIMELINE, TOTAL_FRAMES } from "./lib/timeline";
import { DefensibleScene } from "./scenes/DefensibleScene";
import { EngineeringScene } from "./scenes/EngineeringScene";
import { FinalScene } from "./scenes/FinalScene";
import { InfluentialReviewScene } from "./scenes/InfluentialReviewScene";
import { IntroScene } from "./scenes/IntroScene";
import { JudgeIsolationScene } from "./scenes/JudgeIsolationScene";
import { NormalizationScene } from "./scenes/NormalizationScene";
import { OfflineScene } from "./scenes/OfflineScene";
import { PairwiseScene } from "./scenes/PairwiseScene";
import { PlatformScene } from "./scenes/PlatformScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { TieBreakerScene } from "./scenes/TieBreakerScene";
import { VerificationScene } from "./scenes/VerificationScene";

export const SCENES: Record<SceneId, React.FC> = {
  intro: IntroScene,
  problem: ProblemScene,
  platform: PlatformScene,
  isolation: JudgeIsolationScene,
  normalization: NormalizationScene,
  defensible: DefensibleScene,
  influential: InfluentialReviewScene,
  tiebreak: TieBreakerScene,
  pairwise: PairwiseScene,
  verify: VerificationScene,
  engineering: EngineeringScene,
  offline: OfflineScene,
  final: FinalScene,
};

export type VideoProps = { captions: boolean; presenter: boolean };

const BEATS = TIMELINE.flatMap((s) => s.beats);

// Music sits under the voice: it fades in and out at the ends and dips while
// the narrator is talking.
const musicVolume = (f: number) => {
  const talking = BEATS.some((b) => f >= b.abs - 6 && f <= b.abs + b.dur + 6);
  const ends = interpolate(f, [0, 45, TOTAL_FRAMES - 120, TOTAL_FRAMES], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return AUDIO.musicVolume * ends * (talking ? AUDIO.musicDuck : 1);
};

export const Video: React.FC<VideoProps> = ({ captions, presenter }) => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    {TIMELINE.map((s) => {
      const Scene = SCENES[s.id];
      return (
        <Sequence key={s.id} from={s.from} durationInFrames={s.duration} name={`${s.index} ${s.title}`}>
          <SceneProvider value={s}>
            <Scene />
          </SceneProvider>
        </Sequence>
      );
    })}

    {AUDIO.voice
      ? BEATS.map((b) => (
          <Sequence key={b.audio} from={b.abs} durationInFrames={b.dur + 6} layout="none" name={`voice ${b.audio}`}>
            <Audio src={staticFile(b.audio)} trimBefore={b.audioOffset} volume={AUDIO.voiceVolume} />
          </Sequence>
        ))
      : null}
    {AUDIO.music ? <Audio src={staticFile("music/bed.wav")} loop volume={musicVolume} /> : null}

    <ChapterLabel />
    {captions ? <Captions /> : null}
    {presenter ? <PresenterBadge /> : null}
  </AbsoluteFill>
);
