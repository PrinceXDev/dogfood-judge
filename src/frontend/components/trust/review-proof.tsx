"use client";

import { useState } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { Tag } from "@/components/ui";
import {
  auditReviews,
  type BundleReview,
  type ReviewAudit,
  verifyManifestSignature,
} from "@/lib/merkle";
import type { Manifest, SigningKey } from "@/lib/types";

// A judge proves each of their reviews is in the published results,
// unchanged, without the CLI. The bundle and key are fetched as public files;
// every hash and the signature check run here in the browser, so the portal
// only supplies data it has already signed and can't vouch for itself.

type State =
  | { at: "idle" }
  | { at: "busy" }
  | { at: "error"; message: string }
  | {
      at: "done";
      audit: ReviewAudit;
      manifest: Manifest;
      signature: boolean | "unsupported";
    };

export function ReviewProof({
  eventId,
  leaves,
  pseudonym,
}: {
  eventId: string;
  leaves: string[];
  pseudonym?: string;
}) {
  const [s, setS] = useState<State>({ at: "idle" });

  async function run() {
    setS({ at: "busy" });
    try {
      const [bRes, kRes] = await Promise.all([
        fetch(`/api/v1/events/${encodeURIComponent(eventId)}/results/bundle`),
        fetch("/.well-known/dogfood-signing-key"),
      ]);
      if (bRes.status === 401 || bRes.status === 403 || bRes.status === 404)
        return setS({
          at: "error",
          message:
            "The results for this event aren't published yet, so there is no bundle to check against.",
        });
      if (!bRes.ok || !kRes.ok)
        throw new Error(`the portal answered ${bRes.status}`);
      const bundle = (await bRes.json()) as {
        manifest: { payload: string; signature: string };
        inputs: { reviews: BundleReview[] | null };
      };
      const key = (await kRes.json()) as SigningKey;
      const manifest = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(bundle.manifest.payload), (c) =>
            c.charCodeAt(0),
          ),
        ),
      ) as Manifest;
      if (!manifest.review_root)
        return setS({
          at: "error",
          message:
            "This bundle was signed before per-review proofs existed (manifest v1). Its rankings still verify with `dogfood verify-results`.",
        });
      const [signature, audit] = await Promise.all([
        verifyManifestSignature(
          bundle.manifest.payload,
          bundle.manifest.signature,
          key.public_key,
        ),
        auditReviews(
          bundle.inputs.reviews ?? [],
          manifest.review_root,
          leaves,
          pseudonym,
        ),
      ]);
      setS({ at: "done", audit, manifest, signature });
    } catch (e) {
      setS({
        at: "error",
        message: `Couldn't check the bundle: ${e instanceof Error ? e.message : String(e)}.`,
      });
    }
  }

  const done = s.at === "done" ? s : null;
  const proven = done ? done.audit.checks.filter((c) => c.ok).length : 0;
  const allGood =
    !!done?.audit.rootMatches &&
    proven === leaves.length &&
    done.signature !== false;

  return (
    <section className="border-t border-line px-5 py-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            Prove your {leaves.length} review{leaves.length === 1 ? "" : "s"}{" "}
            are in the published results
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Downloads the public bundle and recomputes its Merkle tree in this
            browser.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={s.at === "busy"}
          className={buttonClass("secondary", "sm")}
        >
          <Icon name="shieldCheck" size={13} />
          {s.at === "busy"
            ? "Checking…"
            : done
              ? "Check again"
              : "Check inclusion"}
        </button>
      </div>

      {s.at === "error" && (
        <p className="mt-3 text-sm text-warn">{s.message}</p>
      )}

      {done && (
        <div className="mt-4 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={allGood ? "good" : "bad"} dot>
              {allGood
                ? "All reviews included, unchanged"
                : "Inclusion check failed"}
            </Tag>
            <Tag tone={done.audit.rootMatches ? "good" : "bad"}>
              root {done.audit.rootMatches ? "matches" : "differs from"}{" "}
              manifest
            </Tag>
            <Tag
              tone={
                done.signature === true
                  ? "good"
                  : done.signature === false
                    ? "bad"
                    : "neutral"
              }
            >
              {done.signature === true
                ? "manifest signature valid"
                : done.signature === false
                  ? "manifest signature invalid"
                  : "signature: browser lacks Ed25519, use the CLI"}
            </Tag>
          </div>
          <p className="break-all font-mono text-[11px] text-muted">
            review_root {done.manifest.review_root} · {done.audit.count} reviews
            in the bundle
          </p>
          <ul className="grid gap-1.5">
            {done.audit.checks.map((c) => (
              <li
                key={c.leaf}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs"
              >
                <span className={c.ok ? "text-good" : "text-bad"}>
                  <Icon name={c.ok ? "check" : "x"} size={13} />
                </span>
                <span className="font-mono text-ink">
                  {c.project ?? "unknown project"}
                </span>
                <span className="font-mono text-muted" title={c.leaf}>
                  leaf {c.leaf.slice(0, 12)}…
                </span>
                {c.ok ? (
                  <span className="text-muted">
                    #{c.index + 1}, {c.path?.length ?? 0}-step path to the root
                  </span>
                ) : (
                  <span className="text-bad">{c.problem}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            This proves your scores are in the published inputs exactly as you
            submitted them. It doesn't prove anything about how others scored.
          </p>
        </div>
      )}
    </section>
  );
}
