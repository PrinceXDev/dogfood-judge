"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Hash } from "@/components/ui";

// "Results you can reproduce." The fingerprint here is a real SHA-256 of the
// simulation's reviews, computed in the browser; flipping one score changes
// it and the check fails, which is exactly what `dogfood verify-results`
// does with a published bundle (plus an Ed25519 signature over the manifest).

async function sha256(v: unknown): Promise<string> {
  const b = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(v)),
  );
  return [...new Uint8Array(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

const STEPS: [IconName, string, string][] = [
  ["database", "Input", "every criterion score"],
  ["activity", "Engine", "deterministic fit"],
  ["trophy", "Result", "ranking + intervals"],
  ["key", "Signed bundle", "Ed25519 manifest"],
  ["shieldCheck", "Verify", "offline, by anyone"],
];

export function ProofChain({
  reviews,
  keyId,
}: {
  reviews: { judge: string; project: string; score: number }[];
  keyId: string;
}) {
  const [signed, setSigned] = useState("");
  const [now, setNow] = useState("");
  const [tamper, setTamper] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    if (!globalThis.crypto?.subtle) {
      setUnsupported(true);
      return;
    }
    sha256(reviews).then(setSigned);
  }, [reviews]);

  useEffect(() => {
    if (!globalThis.crypto?.subtle) return;
    const input = tamper
      ? reviews.map((r, i) =>
          i === 0 ? { ...r, score: Math.min(5, r.score + 1 / 3) } : r,
        )
      : reviews;
    sha256(input).then(setNow);
  }, [tamper, reviews]);

  const ok = signed !== "" && signed === now;
  const first = reviews[0];

  return (
    <div className="grid gap-6">
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STEPS.map(([icon, t, s], i) => (
          <li
            key={t}
            className="relative rounded-lg border border-line bg-surface p-4"
          >
            <span
              className={`grid size-8 place-items-center rounded-md border ${i === 4 ? (ok ? "border-accent/40 bg-accent/10 text-accent" : tamper ? "border-bad/40 bg-bad/10 text-bad" : "border-line-strong text-muted") : "border-line-strong bg-surface-2 text-ink-2"}`}
            >
              <Icon
                name={i === 4 && tamper && !ok ? "alert" : icon}
                size={15}
              />
            </span>
            <p className="mt-3 text-sm font-medium">{t}</p>
            <p className="text-xs text-muted">{s}</p>
            {i < 4 && (
              <span className="absolute -right-2.5 top-1/2 z-10 hidden h-px w-4 overflow-hidden bg-line-strong sm:block">
                <span className="block h-full w-1/2 animate-scan bg-accent" />
              </span>
            )}
          </li>
        ))}
      </ol>

      <div className="grid gap-4 rounded-lg border border-line bg-surface p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid gap-3 font-mono text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted">
              fingerprint in the signed manifest
            </span>
            <Hash value={signed} head={24} className="text-ink-2" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted">
              fingerprint of the inputs you hold
            </span>
            <Hash
              value={now}
              head={24}
              className={ok ? "text-accent" : "text-bad"}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted">signing key</span>
            <span className="text-ink-2">Ed25519 · {keyId}</span>
          </div>
          {unsupported && (
            <p className="text-warn">
              Your browser only computes SHA-256 on https or localhost; open the
              portal there to run this check.
            </p>
          )}
        </div>
        <div
          className={`flex flex-col justify-between gap-3 rounded-md border p-4 transition-colors duration-300 ${ok ? "border-accent/40 bg-accent/[0.06]" : "border-bad/40 bg-bad/[0.07]"}`}
        >
          <p
            aria-live="polite"
            className={`flex items-center gap-2 text-lg font-semibold ${ok ? "text-accent" : "text-bad"}`}
          >
            <Icon name={ok ? "shieldCheck" : "alert"} size={20} />
            {ok
              ? "Proof accepted."
              : signed
                ? "Integrity check failed."
                : "Computing…"}
          </p>
          <p className="text-xs text-ink-2">
            {ok
              ? "The inputs match the fingerprint the portal signed."
              : `One score changed (${first?.judge} → ${first?.project}), so the fingerprint no longer matches.`}
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={tamper}
              onChange={(e) => setTamper(e.target.checked)}
              className="accent-[var(--bad)]"
            />
            Tamper with one score
          </label>
        </div>
      </div>
    </div>
  );
}
