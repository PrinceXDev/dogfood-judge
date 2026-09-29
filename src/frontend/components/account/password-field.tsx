"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { inputCls } from "@/components/ui";

// A password input with a show/hide toggle. For new passwords it also shows,
// as the user types, how far they are from the server's rule (10 to 200
// characters) and a rough strength read. The rule is the only thing enforced;
// the strength line is advice.

const MIN = 10;

function strength(pw: string): { label: string; tone: string; pct: number } {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) =>
    r.test(pw),
  ).length;
  const score = Math.min(4, Math.floor(pw.length / 6) + kinds - 1);
  if (pw.length < MIN)
    return {
      label: `${pw.length} of ${MIN} characters`,
      tone: "bg-bad",
      pct: (100 * pw.length) / MIN / 2,
    };
  if (score <= 2)
    return {
      label: "Long enough; a few more words would make it stronger",
      tone: "bg-warn",
      pct: 60,
    };
  if (score === 3) return { label: "Good", tone: "bg-accent-2", pct: 80 };
  return { label: "Strong", tone: "bg-good", pct: 100 };
}

export function PasswordField({
  name = "password",
  label = "Password",
  autoComplete,
  isNew = false,
}: {
  name?: string;
  label?: string;
  autoComplete: "current-password" | "new-password";
  isNew?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [value, setValue] = useState("");
  const hint = useId();
  const s = strength(value);
  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <input
          type={shown ? "text" : "password"}
          name={name}
          required
          minLength={isNew ? MIN : undefined}
          maxLength={200}
          autoComplete={autoComplete}
          data-label={label}
          data-error-missing={
            isNew
              ? "Choose a password of at least 10 characters."
              : "Enter your password."
          }
          aria-describedby={isNew ? hint : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`${inputCls} pr-11`}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted transition-colors hover:text-ink"
        >
          <Icon name={shown ? "eyeOff" : "eye"} size={15} />
        </button>
      </div>
      {isNew && (
        <div id={hint} className="grid gap-1" aria-live="polite">
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full transition-[width,background-color] duration-300 ${value ? s.tone : ""}`}
              style={{ width: `${value ? s.pct : 0}%` }}
            />
          </div>
          <p className="text-xs font-normal text-muted">
            {value
              ? s.label
              : `At least ${MIN} characters. A short sentence works well.`}
          </p>
        </div>
      )}
    </div>
  );
}
