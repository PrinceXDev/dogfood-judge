"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import type { Criterion } from "@/lib/types";

// Weight inputs with each criterion's normalized share (weight / Σ weight),
// which is what it actually contributes to a weighted score. Shares follow
// edits live; the server renders the saved ones.

export function RubricWeights({ criteria }: { criteria: Criterion[] }) {
  const [w, setW] = useState<Record<string, string>>(() =>
    Object.fromEntries(criteria.map((c) => [c.id, String(c.weight)])),
  );
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("1");
  const val = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const extra = newName.trim() ? val(newWeight) : 0;
  const total = criteria.reduce((a, c) => a + val(w[c.id] ?? ""), 0) + extra;
  const share = (n: number) => (total > 0 ? (100 * n) / total : 0);

  return (
    <div className="grid gap-4">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-x-4 border-b border-line bg-surface-2 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_5.5rem]">
          <span>Criterion</span>
          <span className="hidden sm:block">Share of score</span>
          <span className="text-right">Weight</span>
        </div>
        <ul className="divide-y divide-line">
          {criteria.map((c) => {
            const s = share(val(w[c.id] ?? ""));
            return (
              <li
                key={c.id}
                className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_5.5rem]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="font-mono text-[11px] text-muted">
                    {c.key} · scale {c.scale_min}–{c.scale_max}
                  </p>
                </div>
                <ShareBar value={s} label={`${c.name} share`} />
                <input
                  type="number"
                  name={`w_${c.id}`}
                  aria-label={`${c.name} weight`}
                  value={w[c.id] ?? ""}
                  onChange={(e) =>
                    setW((m) => ({ ...m, [c.id]: e.target.value }))
                  }
                  step={0.1}
                  min={0.1}
                  max={100}
                  className={`${inputCls} text-right font-mono tabular`}
                />
              </li>
            );
          })}
          {extra > 0 && (
            <li className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-4 gap-y-2 bg-accent/[0.04] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_5.5rem]">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{newName}</p>
                <p className="font-mono text-[11px] text-accent">
                  new · unsaved
                </p>
              </div>
              <ShareBar value={share(extra)} label={`${newName} share`} />
              <span className="text-right font-mono text-sm text-muted tabular">
                {extra}
              </span>
            </li>
          )}
          {!criteria.length && !extra && (
            <li className="px-4 py-6 text-center text-sm text-muted">
              No criteria yet. Add the first one below.
            </li>
          )}
        </ul>
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label="Add criterion">
          <input
            name="new_name"
            placeholder="e.g. Accessibility"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Weight">
          <input
            type="number"
            name="new_weight"
            value={newWeight}
            onChange={(e) => setNewWeight(e.target.value)}
            step={0.1}
            min={0.1}
            className={`${inputCls} font-mono tabular`}
          />
        </Field>
      </div>
    </div>
  );
}

function ShareBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="order-last col-span-2 flex items-center gap-3 sm:order-none sm:col-span-1">
      {/* biome-ignore lint/a11y/useSemanticElements: <meter> can't be styled consistently across browsers */}
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 flex-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-12 text-right font-mono text-xs text-ink-2 tabular">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}
