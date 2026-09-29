"use client";

import { type ReactNode, useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { State } from "@/app/actions";
import { type ButtonVariant, buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { useValidation, ValidationScope } from "@/components/validation";

type Action = (state: State, fd: FormData) => Promise<State>;

/**
 * A form bound to a server action. Validates with our own messages before
 * sending (see validation.tsx), then shows the action's error or result
 * (including one-time links and secrets) beneath the fields. Works without
 * JavaScript too: the browser's own checks apply and the page re-renders.
 */
export function ActionForm({
  action,
  children,
  className = "grid gap-4",
  confirm,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const { formProps, summary, scope } = useValidation((e) => {
    if (confirm && !window.confirm(confirm)) e.preventDefault();
  });
  return (
    <form action={formAction} className={className} {...formProps}>
      <ValidationScope value={scope}>{children}</ValidationScope>
      {summary}
      <Outcome state={state} />
    </form>
  );
}

export function Outcome({ state }: { state: State }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p
        role="alert"
        className="flex animate-rise items-start gap-2 rounded-md border border-bad/30 bg-bad/[0.07] px-3 py-2 text-sm text-ink"
      >
        <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-bad" />
        {state.error}
      </p>
    );
  }
  return (
    <div
      role="status"
      className="grid animate-rise gap-2 rounded-md border border-accent/25 bg-accent/[0.06] px-3 py-2.5 text-sm"
    >
      {state.ok && (
        <p className="flex items-center gap-2 font-medium text-ink">
          <Icon name="check" size={15} className="text-accent" />
          {state.ok}
        </p>
      )}
      {state.lines?.map((l) => (
        <p key={l} className="font-mono text-xs text-ink-2">
          {l}
        </p>
      ))}
      {state.link && <CopyField value={state.link} />}
      {state.secret && <CopyField value={state.secret} />}
    </div>
  );
}

export function Submit({
  children,
  variant = "primary",
  name,
  value,
  disabled,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  name?: string;
  value?: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { pending, data } = useFormStatus();
  // With several submit buttons in one form, only the pressed one shows progress.
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={mine}
      className={`${buttonClass(variant, size)} ${className}`}
    >
      {mine && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
      )}
      {children}
    </button>
  );
}

export function CopyField({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-stretch overflow-hidden rounded-md border border-line-strong bg-sunken transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/15">
      <input
        readOnly
        value={value}
        aria-label="Value to copy"
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-xs text-ink-2 outline-none"
      />
      <button
        type="button"
        aria-live="polite"
        className={`flex shrink-0 items-center gap-1.5 border-l border-line-strong px-3 text-xs font-medium transition-colors ${copied ? "text-accent" : "text-ink-2 hover:bg-surface-hover hover:text-ink"}`}
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={13} />
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      className={buttonClass("secondary")}
      onClick={() => window.print()}
    >
      <Icon name="download" size={14} />
      {label}
    </button>
  );
}
