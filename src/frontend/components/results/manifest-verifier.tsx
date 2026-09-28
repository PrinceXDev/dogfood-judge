"use client";

import { useState } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import type { SignedRecord } from "@/lib/types";

// Verifies the published results manifest's Ed25519 signature in the browser
// (WebCrypto), against the portal's public key. This is the same check the
// CLI's first step performs; re-deriving the input digest and re-running the
// engine stay with `dogfood verify-results`, which the page says.

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok" }
  | { kind: "bad"; why: string };

export function ManifestVerifier({
  manifest,
  publicKey,
}: {
  manifest: SignedRecord;
  publicKey: string;
}) {
  const [st, setSt] = useState<State>({ kind: "idle" });
  const [tamper, setTamper] = useState(false);

  const verify = async (alter: boolean) => {
    setSt({ kind: "busy" });
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        b64(publicKey),
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      const body = b64(manifest.payload);
      if (alter) body[body.length - 3] ^= 1; // flip one bit near the end
      const ok = await crypto.subtle.verify(
        "Ed25519",
        key,
        b64(manifest.signature),
        body,
      );
      await new Promise((r) => setTimeout(r, 450));
      setSt(
        ok
          ? { kind: "ok" }
          : {
              kind: "bad",
              why: "The signature does not match these bytes: the manifest was altered or signed by another key.",
            },
      );
    } catch {
      setSt({
        kind: "bad",
        why: "This browser can't verify Ed25519 signatures (WebCrypto support is recent). Use the CLI command below instead.",
      });
    }
  };

  return (
    <div
      className={`rounded-lg border p-5 transition-colors duration-300 ${st.kind === "ok" ? "border-accent/40 bg-accent/[0.05]" : st.kind === "bad" ? "border-bad/40 bg-bad/[0.06]" : "border-line bg-surface"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div aria-live="polite">
          <p
            className={`flex items-center gap-2 text-lg font-semibold ${st.kind === "ok" ? "text-accent" : st.kind === "bad" ? "text-bad" : "text-ink"}`}
          >
            <Icon
              name={st.kind === "bad" ? "alert" : "shieldCheck"}
              size={20}
            />
            {st.kind === "ok"
              ? "Proof accepted."
              : st.kind === "bad"
                ? "Integrity check failed."
                : st.kind === "busy"
                  ? "Checking signature…"
                  : "Check the signature yourself"}
          </p>
          <p className="mt-1 max-w-xl text-sm text-ink-2">
            {st.kind === "ok"
              ? "Your browser verified the manifest's Ed25519 signature against this portal's public key."
              : st.kind === "bad"
                ? st.why
                : "Runs in your browser with WebCrypto. Nothing is sent anywhere."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={tamper}
              onChange={(e) => setTamper(e.target.checked)}
              className="accent-[var(--bad)]"
            />
            Flip one bit first
          </label>
          <button
            type="button"
            onClick={() => verify(tamper)}
            disabled={st.kind === "busy"}
            className={buttonClass("accent")}
          >
            <Icon name="key" size={14} /> Verify signature
          </button>
        </div>
      </div>
    </div>
  );
}
