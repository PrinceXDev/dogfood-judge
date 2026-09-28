import { LogoMark } from "@/components/logo";

// Shown while a server-rendered page streams in. Pure CSS: a small judging
// graph lights up node by node under the mark.
export default function Loading() {
  const nodes = [
    [8, 26],
    [30, 10],
    [30, 42],
    [56, 18],
    [56, 34],
    [78, 26],
  ];
  const edges = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 4],
    [1, 4],
    [3, 5],
    [4, 5],
  ];
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-5"
    >
      <LogoMark size={30} />
      <svg width="86" height="52" viewBox="0 0 86 52" aria-hidden="true">
        {edges.map(([a, b], i) => (
          <line
            key={`${a}-${b}`}
            x1={nodes[a][0]}
            y1={nodes[a][1]}
            x2={nodes[b][0]}
            y2={nodes[b][1]}
            stroke="var(--accent)"
            strokeWidth="1"
            className="animate-[fade_900ms_ease-in-out_infinite_alternate]"
            style={{ animationDelay: `${i * 110}ms`, opacity: 0.2 }}
          />
        ))}
        {nodes.map(([x, y], i) => (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r="2.6"
            fill="var(--accent)"
            className="animate-[fade_900ms_ease-in-out_infinite_alternate]"
            style={{ animationDelay: `${i * 130}ms` }}
          />
        ))}
      </svg>
      <p className="font-mono text-xs tracking-wide text-muted">
        Reconstructing judging graph…
      </p>
    </div>
  );
}
