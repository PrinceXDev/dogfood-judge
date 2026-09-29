"use client";

import {
  createContext,
  type FormEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/icons";

// Form validation with our own messages instead of the browser's bubbles.
// The rules stay in the markup (required, type, minLength, pattern, min/max),
// so the server-rendered form still carries them; this layer only replaces
// how failures are reported: next to the field, in words that say what to
// fix, announced to screen readers, and re-checked as the user types.

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Errors = Record<string, string>;

const isControl = (el: Element): el is Control =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement;

/** The field's human name: its <Field> label, aria-label, or name. */
function labelOf(el: Control): string {
  const explicit = el.dataset.label || el.getAttribute("aria-label");
  if (explicit) return explicit;
  const own = el.labels?.[0]?.querySelector("[data-label]")?.textContent;
  if (own) return own.trim();
  const text = el.labels?.[0]?.textContent?.trim();
  if (text) return text;
  return el.name.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** A message that says what to do, from the control's constraint state. */
export function messageFor(el: Control): string | null {
  const v = el.validity;
  if (v.valid) return null;
  const label = labelOf(el);
  const custom = el.dataset.error;
  if (v.valueMissing) {
    if (el.dataset.errorMissing) return el.dataset.errorMissing;
    if (el instanceof HTMLSelectElement) return `Choose ${lower(label)}.`;
    if (el.type === "checkbox") return `Tick “${label}” to continue.`;
    if (el.type === "radio") return `Pick one option for ${lower(label)}.`;
    return `${label} is required.`;
  }
  if (v.typeMismatch) {
    if (el.type === "email")
      return "Enter an email address like name@example.org.";
    if (el.type === "url") return "Enter a full link, starting with https://.";
  }
  if (v.patternMismatch)
    return custom ?? el.title ?? `${label} isn't in the expected format.`;
  if (v.tooShort && "minLength" in el)
    return `${label} needs at least ${el.minLength} characters (${el.value.length} so far).`;
  if (v.tooLong && "maxLength" in el)
    return `${label} can be at most ${el.maxLength} characters (${el.value.length} now).`;
  if (v.badInput) return `${label} must be a number.`;
  if (v.rangeUnderflow && el instanceof HTMLInputElement)
    return `${label} must be ${el.type.startsWith("date") ? "on or after" : "at least"} ${el.min}.`;
  if (v.rangeOverflow && el instanceof HTMLInputElement)
    return `${label} must be ${el.type.startsWith("date") ? "on or before" : "at most"} ${el.max}.`;
  if (v.stepMismatch) return `${label} must be a whole number.`;
  return custom ?? el.validationMessage ?? `Check ${lower(label)}.`;
}

const lower = (s: string) =>
  /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;

function controlsOf(form: HTMLFormElement): Control[] {
  return [...form.elements].filter(
    (el): el is Control => isControl(el) && !!el.name && el.willValidate,
  );
}

type Ctx = {
  errors: Errors;
  claim: (name: string) => () => void;
};
const ErrorsContext = createContext<Ctx | null>(null);

/** Wrap a validated form's fields so their <FieldError> slots can report. */
export const ValidationScope = ErrorsContext.Provider;

// Marks every control of a group invalid or valid, so styling
// (aria-[invalid=true]:…) and assistive technology agree with the messages.
function mark(form: HTMLFormElement | null, name: string, invalid: boolean) {
  if (!form) return;
  for (const el of controlsOf(form)) {
    if (el.name !== name) continue;
    if (invalid) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  }
}

/**
 * Wires a form for custom validation. Spread `formProps` on the <form>, wrap
 * its fields in <ValidationScope value={scope}>, and render `summary` inside it
 * for fields with no <FieldError> slot of their own.
 */
export function useValidation(
  onValid?: (e: FormEvent<HTMLFormElement>) => void,
) {
  const [errors, setErrors] = useState<Errors>({});
  const tried = useRef(false);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());

  const claim = useCallback((name: string) => {
    setClaimed((s) => new Set(s).add(name));
    return () =>
      setClaimed((s) => {
        const n = new Set(s);
        n.delete(name);
        return n;
      });
  }, []);

  const recheck = (el: Control) => {
    const form = el.form;
    // Radios share one name: the group is valid when any member is.
    const members =
      el.type === "radio" && form
        ? controlsOf(form).filter((c) => c.name === el.name)
        : [el];
    const msg = members.map(messageFor).find(Boolean) ?? null;
    mark(form, el.name, !!msg);
    setErrors((prev) => {
      if ((prev[el.name] ?? null) === msg) return prev;
      const next = { ...prev };
      if (msg) next[el.name] = msg;
      else delete next[el.name];
      return next;
    });
  };

  const formProps = {
    noValidate: true,
    onSubmit: (e: FormEvent<HTMLFormElement>) => {
      tried.current = true;
      const found: Errors = {};
      let first: Control | null = null;
      for (const el of controlsOf(e.currentTarget))
        el.removeAttribute("aria-invalid");
      for (const el of controlsOf(e.currentTarget)) {
        const msg = messageFor(el);
        if (msg) el.setAttribute("aria-invalid", "true");
        if (msg && !found[el.name]) {
          found[el.name] = msg;
          first ??= el;
        }
      }
      setErrors(found);
      if (first) {
        e.preventDefault();
        first.focus();
        return;
      }
      onValid?.(e);
    },
    onInput: (e: FormEvent<HTMLFormElement>) => {
      if (tried.current && isControl(e.target as Element))
        recheck(e.target as Control);
    },
    onBlur: (e: FormEvent<HTMLFormElement>) => {
      const el = e.target as Element;
      // Only re-check fields the user has touched after a failed submit, or
      // that already show an error, so a first pass through the form is quiet.
      if (isControl(el) && (tried.current || errors[el.name])) recheck(el);
    },
  };

  const orphans = Object.entries(errors).filter(([n]) => !claimed.has(n));
  const summary = orphans.length ? (
    <div
      role="alert"
      className="flex animate-rise items-start gap-2 rounded-md border border-bad/30 bg-bad/[0.07] px-3 py-2 text-sm text-ink"
    >
      <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-bad" />
      <ul className="grid gap-0.5">
        {orphans.map(([n, m]) => (
          <li key={n}>{m}</li>
        ))}
      </ul>
    </div>
  ) : null;

  const scope = useMemo(() => ({ errors, claim }), [errors, claim]);
  return { formProps, summary, errors, scope };
}

/**
 * The error slot of one field. Placed inside a <label> (as <Field> does), it
 * finds the control it labels, reports that control's error, and links the
 * two for assistive technology. Outside a validated form it renders nothing.
 */
export function FieldError() {
  const ctx = useContext(ErrorsContext);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const host = ref.current?.closest("label");
    const el = host?.querySelector("input, textarea, select");
    if (el && isControl(el) && el.name) setName(el.name);
  }, []);

  useEffect(() => {
    if (!ctx || !name) return;
    return ctx.claim(name);
  }, [ctx?.claim, name, ctx]);

  const msg = name ? ctx?.errors[name] : undefined;

  useEffect(() => {
    const host = ref.current?.closest("label");
    const el = host?.querySelector("input, textarea, select");
    if (!el) return;
    // Add or remove only our id: the field may describe itself too (a hint).
    const ids = (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((x) => x && x !== id);
    if (msg) ids.push(id);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  }, [msg, id]);

  return (
    <span ref={ref} id={id} aria-live="polite" className="contents">
      {msg && (
        <span className="flex animate-rise items-center gap-1.5 text-xs font-normal text-bad">
          <Icon name="alert" size={12} className="shrink-0" />
          {msg}
        </span>
      )}
    </span>
  );
}
