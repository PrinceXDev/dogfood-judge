// Render review stills for a scene without re-bundling per frame.
// Usage: node scripts/stills.mjs <compositionId> <frame> [frame...]
//        node scripts/stills.mjs 05-defensible 0.2 0.5 0.9   (fractions of the scene)
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";

const [id = "DogfoodJudge", ...frames] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const ids = id.split(",");
for (const cid of ids) {
  const composition = await selectComposition({ serveUrl, id: cid });
  for (const raw of frames.length ? frames : ["0.5"]) {
    const v = Number(raw);
    const frame = v < 1 && raw.includes(".") ? Math.floor(v * (composition.durationInFrames - 1)) : v;
    const output = `out/stills/${cid}-${frame}.png`;
    await renderStill({ composition, serveUrl, output, frame, scale: 0.5, imageFormat: "png" });
    console.log(output);
  }
}
