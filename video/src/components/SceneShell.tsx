import { AbsoluteFill, useCurrentFrame } from "remotion";
import { lerp } from "../lib/anim";
import { useScene } from "../lib/scene";
import { C } from "../lib/theme";

/** The product's faint engineering grid, masked so it fades at the edges. */
export const Backdrop: React.FC<{ glow?: string; gridOpacity?: number }> = ({
  glow = "rgba(60, 242, 192, 0.07)",
  gridOpacity = 1,
}) => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <AbsoluteFill
      style={{
        opacity: gridOpacity,
        backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
        backgroundSize: "80px 80px",
        backgroundPosition: "-1px -1px",
        maskImage: "radial-gradient(ellipse 70% 65% at 50% 45%, black 30%, transparent 100%)",
      }}
    />
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 50% 40% at 50% 0%, ${glow}, transparent 70%)` }} />
  </AbsoluteFill>
);

/**
 * Wraps every scene: backdrop, a short fade through the background at both
 * ends, and a slow push-in so even static layouts keep moving.
 */
export const SceneShell: React.FC<{
  children: React.ReactNode;
  grid?: boolean;
  glow?: string;
  push?: number;
}> = ({ children, grid = true, glow, push = 0.025 }) => {
  const frame = useCurrentFrame();
  const { duration } = useScene();
  const opacity = Math.min(lerp(frame, [0, 10], [0, 1]), lerp(frame, [duration - 9, duration], [1, 0]));
  const scale = 1 + push * (frame / Math.max(1, duration));
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {grid ? <Backdrop glow={glow} /> : null}
      <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
