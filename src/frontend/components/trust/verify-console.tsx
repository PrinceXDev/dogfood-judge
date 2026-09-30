"use client";

import { type ReactNode, useActionState, useState } from "react";
import { type Proof, verifyProof } from "@/app/verify/actions";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { ReviewProof } from "@/components/trust/review-proof";
import {
  fingerprint,
  recordId,
  SignatureGlyph,
} from "@/components/trust/signature";
import { Skeleton, Tag } from "@/components/ui";
import { useValidation } from "@/components/validation";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${dateFmt.format(d)} UTC`;
};

// Caught before the round trip: the server would reject it anyway, but it
// can say what is wrong while the user is still looking at the text.
function jsonProblem(text: string): string {
  if (!text.trim()) return "";
  try {
    const v = JSON.parse(text);
    const rec = v && typeof v === "object" && "record" in v ? v.record : v;
    if (
      !rec ||
      typeof rec.payload !== "string" ||
      typeof rec.signature !== "string"
    )
      return "This JSON has no payload and signature: paste the record itself, not the page.";
    return "";
  } catch {
    return "This isn't valid JSON. Paste the whole record, including the { and }.";
  }
}

export function VerifyConsole({ keyId }: { keyId: string }) {
  const [state, action, pending] = useActionState(verifyProof, null);
  const [text, setText] = useState(state?.input ?? "");
  const { formProps, summary } = useValidation();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        action={action}
        {...formProps}
        className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow)] transition-[border-color,box-shadow] duration-150 has-[textarea:focus]:border-accent has-[textarea:focus]:ring-[3px] has-[textarea:focus]:ring-accent/15"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
          <label
            htmlFor="record"
            className="flex items-center gap-2 text-[13px] font-medium"
          >
            <Icon name="file" size={14} className="text-muted" />
            Record JSON
          </label>
          <span className="font-mono text-[11px] text-muted tabular">
            {text.length > 0 ? `${text.length} chars` : "empty"}
          </span>
        </header>
        <textarea
          id="record"
          name="record"
          required
          data-label="Record JSON"
          data-error-missing="Paste a signed record, or the whole downloaded file, first."
          rows={11}
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.setCustomValidity(jsonProblem(e.target.value));
          }}
          placeholder={
            '{\n  "payload": "eyJ0eXBlIjoiZG9nZm9vZC5wYXJ0aWNpcGF0aW9uL3YxIi…",\n  "signature": "…",\n  "key_id": "…"\n}'
          }
          className="min-h-56 flex-1 resize-y bg-sunken px-4 py-3 font-mono text-xs leading-relaxed text-ink outline-none placeholder:text-muted/60 focus-visible:outline-none"
        />
        {summary && (
          <div className="border-t border-line px-4 pt-3">{summary}</div>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-xs text-muted">
            Bare record or the full download both work.
          </p>
          <div className="flex gap-2">
            {text && (
              <button
                type="button"
                onClick={() => setText("")}
                className={buttonClass("ghost", "sm")}
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className={buttonClass("accent", "sm")}
            >
              {pending ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
              ) : (
                <Icon name="shieldCheck" size={14} />
              )}
              Verify signature
            </button>
          </div>
        </footer>
      </form>

      <output
        aria-live="polite"
        className="block min-h-72 overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow)]"
      >
        {pending ? (
          <Checking keyId={keyId} />
        ) : state === null ? (
          <Idle keyId={keyId} />
        ) : state.valid ? (
          <Valid proof={state} />
        ) : (
          <Invalid proof={state} />
        )}
      </output>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-2 font-mono text-[11px] text-muted">
        {n}
      </span>
      <div className="min-w-0 pt-0.5 text-sm text-ink-2">{children}</div>
    </li>
  );
}

function Idle({ keyId }: { keyId: string }) {
  return (
    <div className="relative h-full p-5">
      <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          Awaiting record
        </p>
        <p className="mt-2 text-lg font-medium tracking-[-0.02em]">
          What happens when you verify
        </p>
        <ol className="mt-5 grid gap-4">
          <Step n={1}>
            Decode <code className="font-mono text-xs text-ink">payload</code>{" "}
            from base64 into the exact bytes that were signed.
          </Step>
          <Step n={2}>
            Check the Ed25519{" "}
            <code className="font-mono text-xs text-ink">signature</code> over
            those bytes against key{" "}
            <code className="font-mono text-xs text-accent">{keyId}</code>.
          </Step>
          <Step n={3}>
            Only if every byte matches, read the payload and show who it names
            and what they did.
          </Step>
        </ol>
      </div>
    </div>
  );
}

function Checking({ keyId }: { keyId: string }) {
  return (
    <div className="grid gap-4 p-5">
      <p className="flex items-center gap-2 font-mono text-xs text-muted">
        <span className="size-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
        Checking signature against {keyId}…
      </p>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

type ValidProof = Extract<NonNullable<Proof>, { valid: true }>;
type InvalidProof = Extract<NonNullable<Proof>, { valid: false }>;

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 border-t border-line px-5 py-2.5 text-sm first:border-t-0">
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function Valid({ proof }: { proof: ValidProof }) {
  const p = proof.payload;
  const judge = p.role === "judge";
  return (
    <div className="animate-rise">
      <div className="relative overflow-hidden border-b border-good/25 bg-good/[0.06] px-5 py-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-good to-transparent" />
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full border border-good/40 bg-good/10 text-good shadow-[0_0_32px_-6px_var(--glow)]">
            <Icon name="shieldCheck" size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xl font-semibold tracking-[-0.02em]">
                Proof accepted.
              </p>
              <Tag tone="good" dot>
                Valid signature
              </Tag>
            </div>
            <p className="mt-1 text-sm text-ink-2">
              Signed by this portal's key. Every byte is exactly as issued.
            </p>
          </div>
        </div>
      </div>
      <dl>
        <Row k="Record type">
          <span className="font-mono text-xs">{p.type}</span>
        </Row>
        <Row k="Role">
          <Tag tone={judge ? "info" : "accent"}>
            {judge ? "Judge" : "Participant"}
          </Tag>
        </Row>
        <Row k="Recipient">
          <span className="font-medium">{p.name}</span>
        </Row>
        <Row k="Event">
          {p.event_name}{" "}
          <span className="font-mono text-xs text-muted">{p.event_id}</span>
        </Row>
        {judge ? (
          <>
            <Row k="Reviews">
              <span className="font-mono tabular">
                {p.reviews_completed ?? 0}
              </span>
            </Row>
            <Row k="Comparisons">
              <span className="font-mono tabular">{p.comparisons ?? 0}</span>
            </Row>
          </>
        ) : (
          <>
            <Row k="Project">{p.project_title}</Row>
            <Row k="Team">{p.team}</Row>
          </>
        )}
        <Row k="Issued at">
          <span className="font-mono text-xs">{fmt(p.issued_at)}</span>
        </Row>
        <Row k="Key ID">
          <span className="font-mono text-xs">{p.key_id}</span>
        </Row>
      </dl>
      {judge && !!p.review_leaves?.length && (
        <ReviewProof
          eventId={p.event_id}
          leaves={p.review_leaves}
          pseudonym={p.pseudonym}
        />
      )}
      <div className="flex items-center gap-4 border-t border-line bg-surface-2/60 px-5 py-4">
        <SignatureGlyph
          signature={proof.signature}
          size={56}
          className="text-good"
        />
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            record ID{" "}
            <span className="text-ink">{recordId(proof.signature)}</span>
          </p>
          <p className="mt-1 break-all font-mono text-xs text-ink-2">
            {fingerprint(proof.signature)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Invalid({ proof }: { proof: InvalidProof }) {
  return (
    <div className="animate-rise">
      <div className="relative overflow-hidden border-b border-bad/30 bg-bad/[0.07] px-5 py-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-bad to-transparent" />
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full border border-bad/40 bg-bad/10 text-bad">
            <Icon name="x" size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xl font-semibold tracking-[-0.02em]">
                Integrity check failed.
              </p>
              <Tag tone="bad" dot>
                Not valid
              </Tag>
            </div>
            <p className="mt-1 text-sm font-medium text-ink">{proof.title}</p>
          </div>
        </div>
      </div>
      <div className="grid gap-4 p-5 text-sm">
        <p className="leading-relaxed text-ink-2">{proof.explain}</p>
        {proof.keyMismatch && (
          <p className="rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-ink-2">
            The record names key{" "}
            <code className="font-mono text-xs text-ink">
              {proof.keyMismatch.record}
            </code>
            ; this portal signs with{" "}
            <code className="font-mono text-xs text-ink">
              {proof.keyMismatch.portal}
            </code>
            . It was probably issued by another Dogfood instance: verify it
            there, or offline with that portal's public key.
          </p>
        )}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Verifier said
          </p>
          <p className="mt-1.5 rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs text-ink-2">
            {proof.reason}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            What to do
          </p>
          <ul className="mt-2 grid gap-1.5 text-ink-2">
            <li className="flex gap-2">
              <Icon
                name="chevronRight"
                size={14}
                className="mt-0.5 shrink-0 text-muted"
              />
              Copy the record again from its certificate page with Copy record,
              and paste it without editing.
            </li>
            <li className="flex gap-2">
              <Icon
                name="chevronRight"
                size={14}
                className="mt-0.5 shrink-0 text-muted"
              />
              If it still fails, don't trust the claim it makes. Ask the holder
              for the original file.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
