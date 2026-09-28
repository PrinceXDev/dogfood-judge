"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import {
  currentTheme,
  reducedMotion,
  setReducedMotion,
  setTheme,
  type Theme,
} from "@/lib/prefs";

// Theme and motion controls. The command palette changes the same settings,
// so both listen for "dj-prefs" and re-read the document instead of keeping
// their own copy.

export function Preferences() {
  const [theme, setThemeState] = useState<Theme | null>(null);
  const [reduce, setReduce] = useState<boolean | null>(null);

  useEffect(() => {
    const sync = () => {
      setThemeState(currentTheme());
      setReduce(reducedMotion());
    };
    sync();
    window.addEventListener("dj-prefs", sync);
    return () => window.removeEventListener("dj-prefs", sync);
  }, []);

  return (
    <div className="divide-y divide-line">
      <Row
        title="Theme"
        desc="Dark is the primary theme; light is designed for daylight and print."
      >
        <fieldset className="flex rounded-md border border-line-strong bg-sunken p-0.5">
          <legend className="sr-only">Theme</legend>
          {(["dark", "light"] as const).map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13px] font-medium capitalize transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${theme === t ? "bg-surface-hover text-ink shadow-[0_1px_0_var(--line-strong)]" : "text-muted hover:text-ink"}`}
            >
              <input
                type="radio"
                name="theme"
                value={t}
                checked={theme === t}
                disabled={theme === null}
                onChange={() => setTheme(t)}
                className="sr-only"
              />
              <Icon name={t === "dark" ? "moon" : "sun"} size={14} />
              {t}
            </label>
          ))}
        </fieldset>
      </Row>
      <Row
        title="Reduce motion"
        desc="Turns off transitions, reveals and count-ups. Defaults to your system setting."
      >
        <button
          type="button"
          role="switch"
          aria-checked={reduce === true}
          aria-label="Reduce motion"
          disabled={reduce === null}
          onClick={() => setReducedMotion(!reduce)}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-50 ${reduce ? "border-accent bg-accent" : "border-line-strong bg-surface-2"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 size-[18px] rounded-full shadow transition-transform duration-200 ease-out ${reduce ? "translate-x-5 bg-accent-ink" : "bg-muted"}`}
          />
        </button>
      </Row>
      <noscript>
        <p className="py-3 text-xs text-muted">
          Preferences need JavaScript; they are stored in this browser only.
        </p>
      </noscript>
    </div>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 max-w-md">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] text-ink-2">{desc}</p>
      </div>
      {children}
    </div>
  );
}
