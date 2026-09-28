"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitReview } from "@/app/actions";
import { Outcome, Submit } from "@/components/forms";
import { inputCls, Kbd } from "@/components/ui";
import type { Criterion } from "@/lib/types";

const range = (c: Criterion) =>
  Array.from(
    { length: c.scale_max - c.scale_min + 1 },
    (_, i) => c.scale_min + i,
  );

/** Same formula as the backend: Σ(weight × score) / Σ weight. */
function weighted(
  criteria: Criterion[],
  pick: (c: Criterion) => number | undefined,
) {
  let num = 0;
  let den = 0;
  for (const c of criteria) {
    const v = pick(c);
    if (v === undefined) continue;
    num += c.weight * v;
    den += c.weight;
  }
  return den > 0 ? num / den : null;
}

// A digit is used literally when it is on the scale (so 3 means 3 on a 1–5
// scale, and 0 works on a 0–10 scale); otherwise it is an ordinal position.
function digitToValue(c: Criterion, d: number): number | undefined {
  if (d >= c.scale_min && d <= c.scale_max) return d;
  const v = d === 0 ? c.scale_min + 9 : c.scale_min + d - 1;
  return v <= c.scale_max ? v : undefined;
}

export function RubricForm({
  event,
  project,
  next,
  criteria,
  initial,
  comment,
  updating,
}: {
  event: string;
  project: string;
  next: string;
  criteria: Criterion[];
  initial: Record<string, number>;
  comment: string;
  updating: boolean;
}) {
  const [state, action] = useActionState(submitReview, null);
  const [scores, setScores] = useState<Record<string, number>>(initial);
  const [active, setActive] = useState(() => {
    const i = criteria.findIndex((c) => initial[c.key] === undefined);
    return i < 0 ? 0 : i;
  });
  const form = useRef<HTMLFormElement>(null);
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setMod("⌘");
  }, []);
  const live = useRef({ scores, active });
  live.current = { scores, active };

  const focusCriterion = (i: number) => {
    const c = criteria[i];
    if (!c || !form.current) return;
    setActive(i);
    const group = form.current.querySelectorAll<HTMLInputElement>(
      `input[name="c_${c.key}"]`,
    );
    const target = [...group].find((r) => r.checked) ?? group[0];
    target?.focus({ preventScroll: true });
    target
      ?.closest("fieldset")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const f = form.current;
      if (!f) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        f.requestSubmit();
        return;
      }
      const t = e.target as HTMLElement;
      const typing =
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable ||
        (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "radio");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const { scores: s, active: at } = live.current;
      // Arrows only move between criteria inside the rubric; elsewhere they scroll.
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && f.contains(t)) {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        focusCriterion(Math.max(0, Math.min(criteria.length - 1, at + d)));
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        const c = criteria[at];
        if (!c) return;
        const v = digitToValue(c, Number(e.key));
        if (v === undefined) return;
        e.preventDefault();
        const merged = { ...s, [c.key]: v };
        setScores(merged);
        // Move on to the next unscored criterion, wrapping round once.
        const order = [...criteria.keys()].map(
          (k) => (at + 1 + k) % criteria.length,
        );
        const nextOpen = order.find(
          (k) => merged[criteria[k].key] === undefined,
        );
        if (nextOpen !== undefined) focusCriterion(nextOpen);
        else if (at < criteria.length - 1) focusCriterion(at + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scored = criteria.filter((c) => scores[c.key] !== undefined).length;
  const complete = scored === criteria.length;
  const preview = weighted(criteria, (c) => scores[c.key]);
  const lo = weighted(criteria, (c) => c.scale_min) ?? 0;
  const hi = weighted(criteria, (c) => c.scale_max) ?? 1;
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);

  return (
    <form ref={form} action={action} className="flex flex-col">
      <input type="hidden" name="event" value={event} />
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="next" value={next} />

      <ol className="grid gap-2 p-3">
        {criteria.map((c, i) => {
          const on = i === active;
          const v = scores[c.key];
          return (
            <li key={c.id}>
              <fieldset
                onFocus={() => setActive(i)}
                className={`rounded-md border px-3.5 py-3 transition-[border-color,background-color] duration-150 ${on ? "border-accent/50 bg-accent/[0.04]" : "border-line bg-surface-2/40"}`}
              >
                <legend className="sr-only">
                  {c.name}, weight {c.weight}, scale {c.scale_min} to{" "}
                  {c.scale_max}
                </legend>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex items-baseline gap-2 text-sm font-medium text-ink">
                    <span
                      aria-hidden="true"
                      className={`font-mono text-[11px] tabular ${on ? "text-accent" : "text-muted"}`}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {c.name}
                  </p>
                  <p
                    className="shrink-0 font-mono text-[11px] text-muted tabular"
                    title={`Weight ${c.weight} of ${totalWeight}`}
                  >
                    ×{c.weight}
                    {totalWeight > 0 && (
                      <span className="ml-1.5 text-muted/70">
                        {Math.round((100 * c.weight) / totalWeight)}%
                      </span>
                    )}
                  </p>
                </div>
                {c.description && (
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {c.description}
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {range(c).map((n) => (
                    <label key={n} className="cursor-pointer">
                      <input
                        type="radio"
                        name={`c_${c.key}`}
                        value={n}
                        required
                        checked={v === n}
                        onChange={() =>
                          setScores((s) => ({ ...s, [c.key]: n }))
                        }
                        className="peer sr-only"
                      />
                      <span className="flex size-9 items-center justify-center rounded-md border border-line-strong bg-surface font-mono text-sm font-medium text-ink-2 transition-[background-color,border-color,color,transform] duration-150 hover:border-muted/60 hover:text-ink peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-bg active:scale-95">
                        {n}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div className="px-3 pb-3">
        <label className="grid gap-1.5 text-[13px] font-medium text-ink">
          <span>
            Comment for the organizers
            <span className="ml-2 text-xs font-normal text-muted">
              Optional. Never shown to other judges.
            </span>
          </span>
          <textarea
            name="comment"
            rows={3}
            maxLength={5000}
            defaultValue={comment}
            className={inputCls}
          />
        </label>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-line bg-surface/95 px-3 py-3 backdrop-blur">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
              Weighted score
            </p>
            <p
              className="mt-0.5 font-mono text-2xl font-medium tracking-tight tabular"
              aria-live="polite"
            >
              {preview === null ? (
                <span className="text-muted/60">-.--</span>
              ) : (
                <span className={complete ? "text-ink" : "text-ink-2"}>
                  {preview.toFixed(2)}
                </span>
              )}
              <span className="ml-1.5 text-xs text-muted">
                / {hi.toFixed(hi % 1 ? 2 : 0)}
              </span>
            </p>
          </div>
          <p className="pb-1 text-right font-mono text-[11px] text-muted tabular">
            {scored}/{criteria.length} scored
            {!complete && preview !== null && (
              <span className="block text-muted/80">partial preview</span>
            )}
          </p>
        </div>
        <div
          aria-hidden="true"
          className="mb-3 h-1 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
            style={{
              width: `${preview === null || hi === lo ? 0 : Math.max(2, (100 * (preview - lo)) / (hi - lo))}%`,
            }}
          />
        </div>
        <Submit variant="accent" className="w-full">
          {updating ? "Update review" : "Save review"}
          {next ? " & next" : ""}
          <span className="ml-1 hidden items-center gap-0.5 opacity-70 sm:inline-flex">
            <span className="rounded border border-current/30 px-1 font-mono text-[10px]">
              {mod}
            </span>
            <span className="rounded border border-current/30 px-1 font-mono text-[10px]">
              ↵
            </span>
          </span>
        </Submit>
        <p className="mt-2.5 hidden flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted lg:flex">
          <Kbd>1</Kbd>–<Kbd>9</Kbd> score
          <span className="text-line-strong">·</span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> criterion
          <span className="text-line-strong">·</span>
          <Kbd>Tab</Kbd> next field
        </p>
        <Outcome state={state} />
      </div>
    </form>
  );
}
