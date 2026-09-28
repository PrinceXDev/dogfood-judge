"use client";

import { useEffect } from "react";

/** "/" focuses the gallery search, like most developer tools. */
export function SearchHotkey({ target }: { target: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)
        return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      const el = document.getElementById(target) as HTMLInputElement | null;
      if (!el) return;
      e.preventDefault();
      el.focus();
      el.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);
  return null;
}
