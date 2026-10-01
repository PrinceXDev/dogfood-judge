import { Easing, interpolate, spring } from "remotion";
import { FPS } from "./timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const ease = Easing.bezier(0.22, 1, 0.36, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 → 1 over `dur` frames starting at `start`, eased. */
export const progress = (frame: number, start: number, dur = 20, easing = ease) =>
  interpolate(frame, [start, start + dur], [0, 1], { ...clamp, easing });

/** Linear map with clamping. */
export const lerp = (frame: number, input: number[], output: number[]) =>
  interpolate(frame, input, output, clamp);

/** Spring from 0 to 1 that starts at `start`. */
export const pop = (frame: number, start: number, damping = 16, mass = 0.6) =>
  spring({ frame: frame - start, fps: FPS, config: { damping, mass, stiffness: 140 } });

/** Visible window: fades in at `start`, out at `end`. */
export const windowed = (frame: number, start: number, end: number, fade = 10) =>
  Math.min(progress(frame, start, fade), 1 - progress(frame, end - fade, fade, easeInOut));

/** Common entrance: opacity + upward slide + slight blur. */
export const rise = (frame: number, start: number, distance = 24, dur = 22) => {
  const p = progress(frame, start, dur);
  return {
    opacity: p,
    transform: `translateY(${(1 - p) * distance}px)`,
    filter: `blur(${(1 - p) * 6}px)`,
  };
};

/** Deterministic pseudo-random in [0, 1) for a seed (no Math.random in renders). */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export const sec = (s: number) => Math.round(s * FPS);
