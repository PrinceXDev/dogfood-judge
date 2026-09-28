"use client";

import Link from "next/link";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="relative mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 py-20 text-center">
      <span className="mb-6 grid size-12 place-items-center rounded-xl border border-bad/30 bg-bad/10 text-bad">
        <Icon name="activity" size={20} />
      </span>
      <p className="font-mono text-xs tracking-[0.2em] text-muted">ERROR 500</p>
      <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em]">
        The judging engine hit an unexpected state.
      </h1>
      <p className="mt-3 text-ink-2">
        Nothing was lost: every write is a transaction and lands in the audit
        log, or doesn't happen at all. Try again, or check that the API is
        running.
      </p>
      {error.digest && (
        <p className="mt-4 font-mono text-xs text-muted">ref {error.digest}</p>
      )}
      <div className="mt-8 flex gap-2">
        <button type="button" onClick={reset} className={buttonClass("accent")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary")}>
          Home
        </Link>
      </div>
    </div>
  );
}
