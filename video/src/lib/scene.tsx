import { createContext, useContext } from "react";
import type { SceneTiming } from "./timeline";

const SceneContext = createContext<SceneTiming | null>(null);

export const SceneProvider = SceneContext.Provider;

/**
 * The current scene's timing. `beat(i)` is the frame (relative to the scene)
 * where narration line i starts, so visuals land on the words that describe
 * them even after the script or voice changes.
 */
export const useScene = () => {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error("useScene must be used inside a scene");
  const beat = (i: number) => scene.beats[Math.min(i, scene.beats.length - 1)].from;
  const beatEnd = (i: number) => {
    const b = scene.beats[Math.min(i, scene.beats.length - 1)];
    return b.from + b.dur;
  };
  return { ...scene, beat, beatEnd };
};
