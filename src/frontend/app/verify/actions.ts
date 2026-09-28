"use server";

import { ApiError, api, apiRoot } from "@/lib/api";
import type { RecordPayload, SigningKey } from "@/lib/types";

export type Proof =
  | null
  | {
      valid: true;
      payload: RecordPayload;
      signature: string;
      input: string;
    }
  | {
      valid: false;
      /** Short verdict in plain words. */
      title: string;
      /** What the failure means. */
      explain: string;
      /** The reason exactly as the API (or parser) gave it. */
      reason: string;
      /** Set when the record names a different signing key than this portal's. */
      keyMismatch?: { record: string; portal: string };
      input: string;
    };

type Verdict = { valid: boolean; reason?: string; payload?: RecordPayload };
type Plain = { title: string; explain: string };

// The Go verifier's messages (src/core/records.go), in plain words.
function plain(reason: string): Plain {
  if (reason.includes("does not match"))
    return {
      title: "The signature doesn't match the content.",
      explain:
        "At least one byte of the payload changed after it was signed, or a different Dogfood portal signed it. Either way, this portal did not issue it in this form.",
    };
  if (reason.includes("payload is not base64"))
    return {
      title: "The payload is damaged.",
      explain:
        "The payload must be the base64 text exactly as issued. Copying often cuts it short or adds line breaks and spaces.",
    };
  if (reason.includes("signature is malformed"))
    return {
      title: "The signature is damaged or missing.",
      explain:
        "An Ed25519 signature is 64 bytes, which is 88 characters of base64 ending in ==. This one isn't.",
    };
  if (reason.includes("payload is not JSON"))
    return {
      title: "Signed, but not a Dogfood record.",
      explain:
        "The signature checks out, yet the signed bytes are not a record document. Treat it as unverified.",
    };
  return {
    title: "The record could not be verified.",
    explain: "The verifier rejected it. The exact reason is below.",
  };
}

export async function verifyProof(_: Proof, fd: FormData): Promise<Proof> {
  const input = String(fd.get("record") ?? "");
  const fail = (p: Plain, reason: string, extra: Partial<Proof> = {}) =>
    ({ valid: false, ...p, reason, input, ...extra }) as Proof;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (e) {
    return fail(
      {
        title: "That isn't JSON.",
        explain:
          "Paste the record exactly as issued, from the first { to the last }. Use the Copy record button on the certificate page to get it intact.",
      },
      e instanceof Error ? e.message : "invalid JSON",
    );
  }
  // Accept a bare SignedRecord or the {record, payload} shape the API returns.
  const rec =
    parsed && typeof parsed === "object" && "record" in parsed
      ? (parsed as { record: unknown }).record
      : parsed;
  const r = rec as Partial<Record<"payload" | "signature" | "key_id", unknown>>;
  if (
    !r ||
    typeof r !== "object" ||
    typeof r.payload !== "string" ||
    typeof r.signature !== "string"
  ) {
    return fail(
      {
        title: "This JSON isn't a signed record.",
        explain:
          "A signed record has three fields: payload, signature and key_id. Make sure you copied the record, not only the readable details.",
      },
      "missing payload or signature",
    );
  }

  const [key, result] = await Promise.all([
    apiRoot<SigningKey>("/.well-known/dogfood-signing-key").catch(() => null),
    api<Verdict>("/records/verify", {
      method: "POST",
      token: null,
      body: rec,
    }).catch((e): Verdict => {
      if (e instanceof ApiError) return { valid: false, reason: e.message };
      throw e;
    }),
  ]);

  if (result.valid && result.payload) {
    return {
      valid: true,
      payload: result.payload,
      signature: r.signature,
      input,
    };
  }
  const reason = result.reason ?? "not valid";
  const keyMismatch =
    key && typeof r.key_id === "string" && r.key_id !== key.key_id
      ? { record: r.key_id, portal: key.key_id }
      : undefined;
  return fail(plain(reason), reason, { keyMismatch });
}
