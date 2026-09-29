"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusDot } from "@/components/ui";

/**
 * Keeps the organizer's results current. Polls /progress every five seconds
 * (cheap: counts only) and re-renders the page only when a review or
 * comparison has landed. The server memoises the analysis by its inputs, so
 * a refresh without new data costs no refit.
 */
export function LiveRefresh({
  eventId,
  done,
  comparisons,
}: {
  eventId: string;
  done: number;
  comparisons: number;
}) {
  const router = useRouter();
  const seen = useRef(`${done}/${comparisons}`);
  const [at, setAt] = useState("");

  useEffect(() => {
    seen.current = `${done}/${comparisons}`;
  }, [done, comparisons]);

  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/v1/events/${eventId}/progress`, {
          credentials: "same-origin",
        });
        if (!r.ok) return;
        const p: { done: number; comparisons: number } = await r.json();
        const key = `${p.done}/${p.comparisons}`;
        if (key !== seen.current) {
          seen.current = key;
          setAt(new Date().toLocaleTimeString());
          router.refresh();
        }
      } catch {
        // offline for a moment; the next tick retries
      }
    }, 5000);
    return () => clearInterval(id);
  }, [eventId, router]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <StatusDot tone="accent" pulse />
      {at
        ? `Updated with new reviews at ${at}`
        : "Live: refreshes on new reviews"}
    </span>
  );
}
