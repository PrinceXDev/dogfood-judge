import type { ReactNode } from "react";
import type { AuditLog } from "@/lib/types";

// The verdict of the server re-walking the whole chain (every event on the
// instance, not just this page), shown as a seal.

export function ChainStatus({
  verification: v,
  children,
}: {
  verification: AuditLog["verification"];
  children?: ReactNode;
}) {
  const ok = v.ok;
  return (
    <section
      aria-label="Hash chain verification"
      className={`relative overflow-hidden rounded-lg border bg-surface shadow-[var(--shadow)] ${ok ? "border-good/30" : "border-bad/40"}`}
    >
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(90deg,black,transparent_70%)]" />
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-5 p-5 sm:p-6">
        <Seal ok={ok} />
        <div className="min-w-0 flex-1 basis-72">
          <p
            className={`font-mono text-[11px] uppercase tracking-[0.16em] ${ok ? "text-good" : "text-bad"}`}
          >
            {ok ? "Proof accepted" : "Integrity check failed"}
          </p>
          {ok ? (
            <>
              <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.025em]">
                Hash chain intact:{" "}
                <span className="font-mono tabular">{v.entries}</span>{" "}
                {v.entries === 1 ? "entry verifies" : "entries verify"}
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">
                The server just recomputed every hash on this instance, in
                order. Each entry commits to the hash of the one before it, so
                editing or deleting any row would break every hash after it.
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.025em]">
                The chain breaks at entry{" "}
                <span className="font-mono tabular">#{v.broken_at}</span>
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">
                Entry #{v.broken_at}&apos;s stored hash no longer matches its
                own contents and the entry before it. That row, or the one just
                before it, was changed outside the application. Entries after it
                can&apos;t be trusted until you restore from a backup.{" "}
                <span className="font-mono tabular">{v.entries}</span> entries
                were checked.
              </p>
            </>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

function Seal({ ok }: { ok: boolean }) {
  const tone = ok ? "text-good" : "text-bad";
  return (
    <div
      className={`relative grid size-20 shrink-0 place-items-center ${tone}`}
      aria-hidden="true"
    >
      <span
        className={`absolute inset-0 rounded-full border border-dashed ${ok ? "border-good/40" : "border-bad/50"}`}
      />
      <span
        className={`absolute inset-2 rounded-full ${ok ? "bg-good/10 shadow-[0_0_40px_-8px_var(--good)]" : "bg-bad/10 shadow-[0_0_40px_-8px_var(--bad)]"}`}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="34"
        height="34"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="relative"
      >
        <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
        {ok ? (
          <path d="m8.5 12 2.4 2.4 4.6-4.8" />
        ) : (
          <>
            <path d="M12 8v4.5" />
            <path d="M12 15.8v.2" />
          </>
        )}
      </svg>
    </div>
  );
}
