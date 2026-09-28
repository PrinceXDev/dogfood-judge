"use client";

import { useEffect, useRef } from "react";
import { prefersReduced } from "@/components/motion";

// The living judging network behind the hero. Nodes are projects, judges,
// reviews and results; near ones connect. The cursor wakes nodes up, a click
// sends a ripple through the graph, and every few seconds one chain lights up
// judge → review → project → rank. Performance rules: one canvas, a spatial
// grid for neighbour search, DPR capped at 2, nothing drawn while off-screen
// or in a hidden tab, and a single static frame under reduced motion.

type Kind = 0 | 1 | 2 | 3; // judge, review, project, result
type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: Kind;
  a: number;
};

const LINK = 118;

function colors() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    kinds: [v("--accent-2"), v("--muted"), v("--accent"), v("--ink")],
    line: v("--line-strong"),
    accent: v("--accent"),
  };
}

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function NetworkBackground({ className = "" }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduced = prefersReduced();
    let c = colors();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    const mouse = { x: -9999, y: -9999, active: false };
    const ripples: { x: number; y: number; t: number }[] = [];
    let path: { ids: number[]; t: number } | null = null;
    let nextPath = performance.now() + 1800;
    let scrollY = 0;
    let visible = true;
    let raf = 0;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = r.width;
      h = r.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.min(w < 700 ? 55 : 170, Math.round((w * h) / 8500));
      const kinds: Kind[] = [0, 1, 1, 1, 2, 2, 3];
      nodes = Array.from({ length: target }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        k: kinds[i % kinds.length],
        a: 0,
      }));
      if (reduced) draw(performance.now());
    };

    // Buckets of LINK px so each node only checks its 9 neighbouring cells.
    const grid = () => {
      const cols = Math.ceil(w / LINK) + 1;
      const cells = new Map<number, number[]>();
      nodes.forEach((n, i) => {
        const key = Math.floor(n.x / LINK) + Math.floor(n.y / LINK) * cols;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      });
      return { cells, cols };
    };

    const pickPath = () => {
      // a judge, then the nearest review, project and result, each a hop away
      const start = nodes.findIndex(
        (n, i) => n.k === 0 && i % 7 === Math.floor(Math.random() * 7),
      );
      if (start < 0) return;
      const ids = [start];
      for (const want of [1, 2, 3] as Kind[]) {
        const from = nodes[ids[ids.length - 1]];
        let best = -1;
        let bd = LINK * 2.2;
        nodes.forEach((n, i) => {
          if (n.k !== want || ids.includes(i)) return;
          const d = Math.hypot(n.x - from.x, n.y - from.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best < 0) return;
        ids.push(best);
      }
      path = { ids, t: performance.now() };
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const off = scrollY * 0.12; // slow parallax against the page
      const { cells, cols } = grid();
      const pathSet = new Set(path?.ids ?? []);

      for (const n of nodes) {
        const y = n.y - off;
        let boost = 0;
        if (mouse.active) {
          const d = Math.hypot(n.x - mouse.x, y - mouse.y);
          if (d < 160) boost = 1 - d / 160;
        }
        for (const r of ripples) {
          const radius = (now - r.t) * 0.55;
          const d = Math.abs(Math.hypot(n.x - r.x, y - r.y) - radius);
          if (d < 40)
            boost = Math.max(boost, (1 - d / 40) * (1 - (now - r.t) / 1600));
        }
        n.a += (boost - n.a) * 0.12;
      }

      ctx.lineWidth = 1;
      nodes.forEach((n, i) => {
        const cx = Math.floor(n.x / LINK);
        const cy = Math.floor(n.y / LINK);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            const list = cells.get(cx + dx + (cy + dy) * cols);
            if (!list) continue;
            for (const j of list) {
              if (j <= i) continue;
              const m = nodes[j];
              const d = Math.hypot(n.x - m.x, n.y - m.y);
              if (d > LINK) continue;
              const act = Math.max(n.a, m.a);
              const alpha = (1 - d / LINK) * (0.12 + act * 0.55);
              ctx.strokeStyle =
                act > 0.05 ? rgba(c.accent, alpha) : rgba(c.line, alpha * 1.6);
              ctx.beginPath();
              ctx.moveTo(n.x, n.y - off);
              ctx.lineTo(m.x, m.y - off);
              ctx.stroke();
            }
          }
      });

      if (path) {
        const age = (now - path.t) / 2600;
        if (age > 1) path = null;
        else {
          const shown = Math.min(
            path.ids.length - 1,
            age * 4 * (path.ids.length - 1),
          );
          ctx.strokeStyle = rgba(
            c.accent,
            0.9 * (1 - Math.max(0, age - 0.7) / 0.3),
          );
          ctx.lineWidth = 1.6;
          ctx.shadowColor = c.accent;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          for (let s = 0; s <= Math.ceil(shown); s++) {
            const a = nodes[path.ids[s]];
            const t = Math.min(1, shown - s + 1);
            if (s === 0) ctx.moveTo(a.x, a.y - off);
            else {
              const p = nodes[path.ids[s - 1]];
              ctx.lineTo(p.x + (a.x - p.x) * t, p.y - off + (a.y - p.y) * t);
            }
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      for (const [i, n] of nodes.entries()) {
        const on = pathSet.has(i);
        const r =
          (n.k === 1 ? 1.1 : n.k === 3 ? 1.9 : 1.6) +
          n.a * 1.8 +
          (on ? 1.4 : 0);
        ctx.fillStyle = rgba(c.kinds[n.k], on ? 1 : 0.35 + n.a * 0.65);
        ctx.beginPath();
        ctx.arc(n.x, n.y - off, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -20) n.x = w + 20;
        if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        if (n.y > h + 20) n.y = -20;
      }
      while (ripples.length && now - ripples[0].t > 1600) ripples.shift();
      if (now > nextPath) {
        pickPath();
        nextPath = now + 3200 + Math.random() * 2200;
      }
      draw(now);
      raf = requestAnimationFrame(step);
    };
    const start = () => {
      if (!reduced && !raf) raf = requestAnimationFrame(step);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    });
    io.observe(cv);

    // The wrapper ignores pointer events, so listen on the section it sits in.
    const host = cv.parentElement?.parentElement ?? cv;
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    };
    const onLeave = () => {
      mouse.active = false;
    };
    const onClick = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      ripples.push({
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        t: performance.now(),
      });
    };
    const onScroll = () => {
      scrollY = window.scrollY;
    };
    const onVis = () => !document.hidden && start();
    const onPrefs = () => {
      c = colors();
      if (reduced) draw(performance.now());
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("click", onClick);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("dj-prefs", onPrefs);
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("dj-prefs", onPrefs);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className}`}
    >
      <canvas ref={canvas} className="h-full w-full" />
    </div>
  );
}
