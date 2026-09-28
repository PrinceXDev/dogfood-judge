import type { ReactNode } from "react";

// A generative "cover" for a project, derived only from its id so the same
// project always draws the same picture on the server, in every theme, with
// no stored image. Colours come from theme tokens, never hex.

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Avalanche finish so ids differing by one character look unrelated.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = [
  ["var(--accent)", "var(--accent-2)"],
  ["var(--accent-2)", "var(--info)"],
  ["var(--accent)", "var(--good)"],
  ["var(--info)", "var(--accent)"],
  ["var(--good)", "var(--accent-2)"],
  ["var(--accent-2)", "var(--accent)"],
] as const;

const MOTIFS = ["signal", "orbit", "lattice", "contour", "blocks"] as const;
export type Motif = (typeof MOTIFS)[number];

export function identityOf(id: string) {
  const h = hash(id);
  const [a, b] = PALETTE[h % PALETTE.length];
  return { motif: MOTIFS[(h >>> 8) % MOTIFS.length], a, b, seed: h };
}

const W = 320;
const H = 160;

function Signal({ r, a, b }: { r: () => number; a: string; b: string }) {
  const n = 28 + Math.floor(r() * 12);
  const gap = W / n;
  const phase = r() * Math.PI * 2;
  const freq = 1 + r() * 2.5;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const env =
          0.35 + 0.65 * Math.abs(Math.sin(phase + (i / n) * Math.PI * freq));
        const h = 10 + env * (H * 0.62) * (0.55 + r() * 0.45);
        const lit = r() > 0.72;
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: deterministic geometry
            key={i}
            x={i * gap + gap * 0.3}
            y={H / 2 - h / 2}
            width={Math.max(1.5, gap * 0.4)}
            height={h}
            rx={1}
            fill={lit ? a : b}
            opacity={lit ? 0.95 : 0.28 + env * 0.3}
          />
        );
      })}
      <line
        x1="0"
        y1={H / 2}
        x2={W}
        y2={H / 2}
        stroke={a}
        strokeOpacity="0.25"
      />
    </g>
  );
}

function Orbit({ r, a, b }: { r: () => number; a: string; b: string }) {
  const cx = W * (0.25 + r() * 0.5);
  const cy = H * (0.3 + r() * 0.4);
  const rings = 6 + Math.floor(r() * 4);
  return (
    <g fill="none">
      {Array.from({ length: rings }, (_, i) => {
        const rad = 14 + i * (12 + r() * 6);
        const start = r() * Math.PI * 2;
        const sweep = 0.6 + r() * 2.2;
        const x1 = cx + rad * Math.cos(start);
        const y1 = cy + rad * Math.sin(start);
        const x2 = cx + rad * Math.cos(start + sweep);
        const y2 = cy + rad * Math.sin(start + sweep);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: deterministic geometry
          <g key={i}>
            <circle cx={cx} cy={cy} r={rad} stroke={b} strokeOpacity={0.16} />
            <path
              d={`M${x1} ${y1}A${rad} ${rad} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}`}
              stroke={i % 3 === 0 ? a : b}
              strokeOpacity={i % 3 === 0 ? 0.9 : 0.5}
              strokeWidth={i % 3 === 0 ? 2 : 1.25}
              strokeLinecap="round"
            />
            {i % 2 === 0 && <circle cx={x2} cy={y2} r={2.2} fill={a} />}
          </g>
        );
      })}
    </g>
  );
}

function Lattice({ r, a, b }: { r: () => number; a: string; b: string }) {
  const cols = 16;
  const rows = 8;
  const gx = W / cols;
  const gy = H / rows;
  const lit: [number, number][] = [];
  const dots: ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const on = r() > 0.84;
      const px = x * gx + gx / 2;
      const py = y * gy + gy / 2;
      if (on) lit.push([px, py]);
      dots.push(
        <circle
          key={`${x}-${y}`}
          cx={px}
          cy={py}
          r={on ? 2.6 : 1.1}
          fill={on ? a : b}
          opacity={on ? 1 : 0.3}
        />,
      );
    }
  }
  const path = lit.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
  return (
    <g>
      {path && (
        <path
          d={path}
          fill="none"
          stroke={a}
          strokeOpacity="0.45"
          strokeWidth="1.25"
        />
      )}
      {dots}
    </g>
  );
}

function Contour({ r, a, b }: { r: () => number; a: string; b: string }) {
  const lines = 9 + Math.floor(r() * 4);
  const f1 = 1 + r() * 2;
  const f2 = 2 + r() * 3;
  const p1 = r() * 6;
  const p2 = r() * 6;
  const hot = Math.floor(r() * lines);
  return (
    <g fill="none">
      {Array.from({ length: lines }, (_, i) => {
        const base = (H / (lines + 1)) * (i + 1);
        const amp = 6 + r() * 14;
        let d = "";
        for (let x = 0; x <= W; x += 8) {
          const t = x / W;
          const y =
            base +
            amp * Math.sin(p1 + t * Math.PI * f1 + i * 0.35) +
            amp * 0.4 * Math.sin(p2 + t * Math.PI * f2);
          d += `${x ? "L" : "M"}${x} ${y.toFixed(1)}`;
        }
        return (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: deterministic geometry
            key={i}
            d={d}
            stroke={i === hot ? a : b}
            strokeOpacity={i === hot ? 0.95 : 0.22 + (i / lines) * 0.2}
            strokeWidth={i === hot ? 2 : 1}
          />
        );
      })}
    </g>
  );
}

function Blocks({ r, a, b }: { r: () => number; a: string; b: string }) {
  const out: ReactNode[] = [];
  // Recursive split, like a treemap of an imaginary codebase.
  const split = (x: number, y: number, w: number, h: number, d: number) => {
    if (d > 4 || w * h < 900 || (d > 1 && r() < 0.18)) {
      const lit = r() > 0.8;
      out.push(
        <rect
          key={out.length}
          x={x + 2}
          y={y + 2}
          width={Math.max(0, w - 4)}
          height={Math.max(0, h - 4)}
          rx={3}
          fill={lit ? a : b}
          fillOpacity={lit ? 0.75 : 0.06 + r() * 0.14}
          stroke={lit ? a : b}
          strokeOpacity={lit ? 0.9 : 0.3}
        />,
      );
      return;
    }
    const k = 0.3 + r() * 0.4;
    if (w > h) {
      split(x, y, w * k, h, d + 1);
      split(x + w * k, y, w * (1 - k), h, d + 1);
    } else {
      split(x, y, w, h * k, d + 1);
      split(x, y + h * k, w, h * (1 - k), d + 1);
    }
  };
  split(0, 0, W, H, 0);
  return <g>{out}</g>;
}

const DRAW: Record<Motif, typeof Signal> = {
  signal: Signal,
  orbit: Orbit,
  lattice: Lattice,
  contour: Contour,
  blocks: Blocks,
};

export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "··";
  return (
    words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)
  ).toUpperCase();
}

/**
 * The project's cover art. Decorative: the title is always shown as text
 * next to it, so it is hidden from assistive tech.
 */
export function ProjectIdentity({
  id,
  title,
  className = "",
  monogram = true,
}: {
  id: string;
  title: string;
  className?: string;
  monogram?: boolean;
}) {
  const { motif, a, b, seed } = identityOf(id);
  const r = rng(seed);
  const gx = 20 + r() * 60;
  const gy = 10 + r() * 60;
  const gid = `pi-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const Draw = DRAW[motif];
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden bg-sunken ${className}`}
      data-motif={motif}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
        role="presentation"
      >
        <defs>
          <radialGradient id={`${gid}-g`} cx={`${gx}%`} cy={`${gy}%`} r="75%">
            <stop offset="0" stopColor={a} stopOpacity="0.28" />
            <stop offset="0.55" stopColor={b} stopOpacity="0.06" />
            <stop offset="1" stopColor={b} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${gid}-g)`} />
        <Draw r={r} a={a} b={b} />
      </svg>
      <div className="bg-grid absolute inset-0 opacity-60" />
      {monogram && (
        <span className="absolute bottom-2 left-2 rounded-[4px] border border-line bg-surface/85 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.14em] text-ink-2 backdrop-blur-sm">
          {initials(title)}
          <span className="text-muted"> · {motif}</span>
        </span>
      )}
    </div>
  );
}
