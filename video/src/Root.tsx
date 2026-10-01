import { Composition, Folder, Sequence } from "remotion";
import { FPS, HEIGHT, TIMELINE, TOTAL_FRAMES, WIDTH } from "./lib/timeline";
import { Video, type VideoProps } from "./Video";

const defaults: VideoProps = { captions: true, presenter: true };

/** One scene of the full video, with its voice and overlays, for fast iteration. */
const SceneOnly: React.FC<VideoProps & { from: number }> = ({ from, ...props }) => (
  <Sequence from={-from}>
    <Video {...props} />
  </Sequence>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="DogfoodJudge"
      component={Video}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaults}
    />
    <Folder name="Scenes">
      {TIMELINE.map((s) => (
        <Composition
          key={s.id}
          id={`${String(s.index).padStart(2, "0")}-${s.id}`}
          component={SceneOnly}
          durationInFrames={s.duration}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          defaultProps={{ ...defaults, from: s.from }}
        />
      ))}
    </Folder>
  </>
);
