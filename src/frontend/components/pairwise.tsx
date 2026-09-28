"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { compare } from "@/app/actions";
import { Outcome } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Kbd, Tag } from "@/components/ui";
import type { Project } from "@/lib/types";

type Pick = "a" | "b" | "tie" | null;

function Side({
  label,
  p,
  value,
  picked,
  pending,
}: {
  label: "A" | "B";
  p: Project;
  value: "a" | "b";
  picked: Pick;
  pending: boolean;
}) {
  const chosen = pending && picked === value;
  const faded = pending && picked !== null && picked !== value;
  return (
    <article
      className={`glow-edge group relative flex min-w-0 flex-col rounded-xl border bg-surface p-5 shadow-[var(--shadow)] transition-[opacity,transform,border-color] duration-300 ease-out sm:p-6 ${chosen ? "border-accent" : "border-line"} ${faded ? "translate-y-1 scale-[0.98] opacity-30" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`grid size-8 place-items-center rounded-md border font-mono text-sm font-semibold ${chosen ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface-2 text-ink-2"}`}
        >
          {label}
        </span>
        {p.track_name && <Tag>{p.track_name}</Tag>}
      </div>
      <h2 className="mt-4 text-balance text-2xl font-semibold tracking-[-0.03em]">
        {p.title}
      </h2>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <Icon name="users" size={13} />
        {p.team_name}
      </p>
      {p.summary && (
        <p className="mt-4 text-pretty leading-relaxed text-ink-2">
          {p.summary}
        </p>
      )}
      {p.description && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">
            Read the full description
          </summary>
          <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2/60 p-3 leading-relaxed text-ink-2">
            {p.description}
          </p>
        </details>
      )}
      <div className="flex-1" />
      {(p.repo_url || p.demo_url) && (
        <p className="mt-4 flex flex-wrap gap-4 text-sm">
          {p.repo_url && (
            <a
              href={p.repo_url}
              target="_blank"
              rel="noopener nofollow"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Repository <Icon name="arrowUpRight" size={12} />
            </a>
          )}
          {p.demo_url && (
            <a
              href={p.demo_url}
              target="_blank"
              rel="noopener nofollow"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Demo <Icon name="arrowUpRight" size={12} />
            </a>
          )}
        </p>
      )}
      <button
        type="submit"
        name="outcome"
        value={value}
        disabled={pending}
        className={`mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border text-[15px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 active:translate-y-px disabled:pointer-events-none ${chosen ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface-2 text-ink hover:border-accent/60 hover:bg-accent/[0.08]"}`}
      >
        {label} is better
        <Kbd>{label}</Kbd>
      </button>
    </article>
  );
}

export function PairwiseForm({
  event,
  a,
  b,
}: {
  event: string;
  a: Project;
  b: Project;
}) {
  const [state, action, pending] = useActionState(compare, null);
  const [picked, setPicked] = useState<Pick>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        pending
      )
        return;
      const v = { a: "a", b: "b", t: "tie" }[e.key.toLowerCase()];
      if (v)
        form.current
          ?.querySelector<HTMLButtonElement>(`button[value="${v}"]`)
          ?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  return (
    <form
      ref={form}
      action={action}
      aria-busy={pending}
      onSubmit={(e) => {
        const s = (e.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;
        setPicked((s?.value as Pick) ?? null);
      }}
      className="grid gap-4"
    >
      <input type="hidden" name="event" value={event} />
      <input type="hidden" name="a" value={a.id} />
      <input type="hidden" name="b" value={b.id} />
      <div className="grid animate-rise items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-5">
        <Side label="A" p={a} value="a" picked={picked} pending={pending} />
        <div className="flex items-center justify-center gap-4 md:flex-col">
          <span className="hidden h-16 w-px bg-gradient-to-b from-transparent to-line-strong md:block" />
          <span className="grid size-12 place-items-center rounded-full border border-line-strong bg-surface font-serif text-xl italic text-ink-2 shadow-[0_0_30px_-10px_var(--glow)]">
            vs
          </span>
          <button
            type="submit"
            name="outcome"
            value="tie"
            disabled={pending}
            className={`inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-sm font-medium transition-[background-color,border-color,color] duration-150 active:translate-y-px disabled:pointer-events-none ${pending && picked === "tie" ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface-2 text-ink-2 hover:border-muted/60 hover:text-ink"}`}
          >
            Tie <Kbd>T</Kbd>
          </button>
          <span className="hidden h-16 w-px bg-gradient-to-t from-transparent to-line-strong md:block" />
        </div>
        <Side label="B" p={b} value="b" picked={picked} pending={pending} />
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? "Recording your choice." : ""}
      </p>
      {state?.error && <Outcome state={state} />}
    </form>
  );
}
