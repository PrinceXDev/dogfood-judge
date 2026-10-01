import narration from "../narration.json";
import manifest from "../voice-manifest.json";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Pause after a line when narration.json does not set one. Keep in sync with
// DEFAULT_PAUSE in scripts/generate_voice.py (which writes captions.srt).
const DEFAULT_PAUSE = 0.32;
// Speaking rate used to estimate a line's length before the voice exists.
const FALLBACK_WORDS_PER_SECOND = 2.6;

export type SceneId =
  | "intro"
  | "problem"
  | "platform"
  | "isolation"
  | "normalization"
  | "defensible"
  | "influential"
  | "tiebreak"
  | "pairwise"
  | "verify"
  | "engineering"
  | "offline"
  | "final";

/** One narration line. `from` is relative to the scene start. */
export type Beat = {
  from: number;
  dur: number;
  /** Absolute frame in the whole video. */
  abs: number;
  say: string;
  text: string;
  audio: string;
  /** Frames of leading TTS silence to skip in the audio file. */
  audioOffset: number;
};

export type SceneTiming = {
  id: SceneId;
  title: string;
  index: number;
  from: number;
  duration: number;
  beats: Beat[];
};

type Line = { say: string; text?: string; pause?: number };
type SceneDef = {
  id: string;
  title: string;
  lead: number;
  tail: number;
  lines: Line[];
};

type ManifestLine = { seconds: number; offset?: number };

const lineAudio = (name: string, say: string): ManifestLine => {
  const known = (manifest.lines as Record<string, ManifestLine>)[name];
  if (known) return known;
  return { seconds: say.split(/\s+/).length / FALLBACK_WORDS_PER_SECOND + 0.3 };
};

const f = (seconds: number) => Math.round(seconds * FPS);

// Everything is computed in whole frames so that the captions file written
// by the Python script lands on exactly the same frames.
const build = (): SceneTiming[] => {
  let cursor = 0;
  return (narration.scenes as SceneDef[]).map((scene, index) => {
    let c = f(scene.lead);
    const beats: Beat[] = scene.lines.map((line, n) => {
      const name = `${scene.id}-${n}`;
      const audio = lineAudio(name, line.say);
      const dur = Math.ceil(audio.seconds * FPS);
      const beat: Beat = {
        from: c,
        dur,
        abs: cursor + c,
        say: line.say,
        text: line.text ?? line.say,
        audio: `voice/${name}.mp3`,
        audioOffset: Math.round((audio.offset ?? 0) * FPS),
      };
      c += dur + f(line.pause ?? DEFAULT_PAUSE);
      return beat;
    });
    const duration = c + f(scene.tail);
    const timing: SceneTiming = {
      id: scene.id as SceneId,
      title: scene.title,
      index,
      from: cursor,
      duration,
      beats,
    };
    cursor += duration;
    return timing;
  });
};

export const TIMELINE = build();
export const TOTAL_FRAMES = TIMELINE.reduce((sum, s) => sum + s.duration, 0);
export const HAS_VOICE = Object.keys(manifest.lines).length > 0;

export const sceneById = (id: SceneId): SceneTiming => {
  const s = TIMELINE.find((t) => t.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return s;
};
