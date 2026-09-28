"use client";

import { useEffect, useState } from "react";

// Live time-left readout. The server renders the absolute UTC time next to
// it, so this only adds the relative figure after hydration.

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Countdown({
  to,
  doneLabel = "Closed",
}: {
  to: string;
  doneLabel?: string;
}) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    return (
      <span
        className="font-mono text-2xl tabular text-muted"
        aria-hidden="true"
      >
        --:--:--
      </span>
    );
  }
  const left = target - now;
  if (left <= 0) {
    return <span className="font-mono text-2xl text-muted">{doneLabel}</span>;
  }
  const { d, h, m, s } = parts(left);
  const urgent = left < 3600_000;
  return (
    <span
      className={`font-mono text-2xl font-medium tracking-tight tabular ${urgent ? "text-warn" : "text-ink"}`}
    >
      {/* Screen readers get a calm, minute-level summary instead of ticking seconds. */}
      <span aria-hidden="true">
        {d > 0 && (
          <>
            {d}
            <span className="text-muted">d </span>
          </>
        )}
        {pad(h)}
        <span className="text-muted">:</span>
        {pad(m)}
        <span className="text-muted">:</span>
        {pad(s)}
      </span>
      <span className="sr-only">
        {d > 0 ? `${d} days, ` : ""}
        {h} hours and {m} minutes left
      </span>
    </span>
  );
}
