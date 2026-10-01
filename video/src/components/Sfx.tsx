import { Audio, Sequence, staticFile } from "remotion";
import { AUDIO, SFX_GAIN, type SfxName } from "../lib/audio";

/** A one-shot sound effect at frame `at` of the enclosing sequence. */
export const Sfx: React.FC<{ name: SfxName; at: number; volume?: number }> = ({
  name,
  at,
  volume = 1,
}) => {
  if (!AUDIO.sfx) return null;
  return (
    <Sequence from={Math.max(0, Math.round(at))} durationInFrames={90} layout="none" name={`sfx:${name}`}>
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={AUDIO.sfxVolume * SFX_GAIN[name] * volume} />
    </Sequence>
  );
};
