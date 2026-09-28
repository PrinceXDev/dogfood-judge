"use client";

import { useEffect, useState } from "react";

// Server renders the absolute UTC time; after hydration it becomes a live
// countdown (HH:MM:SS, or "2d 04h"). Rendering the relative value on the
// server would mismatch the client clock.

function fmt(ms: number) {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(sec)}`;
}

export function Countdown({
  at,
  className = "",
}: {
  at: string;
  className?: string;
}) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const target = new Date(at).getTime();
    const tick = () => setLeft(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [at]);
  return (
    <time
      dateTime={at}
      className={`font-mono tabular ${className}`}
      title={`${at.replace("T", " ").slice(0, 16)} UTC`}
    >
      {left === null ? `${at.replace("T", " ").slice(0, 16)} UTC` : fmt(left)}
    </time>
  );
}
