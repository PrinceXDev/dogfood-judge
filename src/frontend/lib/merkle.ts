// Browser-side review inclusion proofs, byte-for-byte compatible with
// src/core/merkle.go (RFC 6962 tree). Everything runs on Web Crypto in the
// viewer's browser, so checking a judge record against a published bundle
// trusts neither the portal nor this page's server.

export type BundleReview = {
  judge: string;
  project: string;
  values: Record<string, number>;
};

const enc = new TextEncoder();

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const buf = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

export const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(h: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(h)) throw new Error("not hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

// Go's encoding/json: map keys sorted, and <, >, &, U+2028, U+2029 escaped.
function goString(s: string): string {
  return JSON.stringify(s).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function goValues(values: Record<string, number>): string {
  const keys = Object.keys(values).sort();
  return `{${keys.map((k) => `${goString(k)}:${values[k]}`).join(",")}}`;
}

/** Leaf hash of one bundle review: H(0x00 ‖ judge 0x1f project 0x1f values). */
export async function reviewLeaf(r: BundleReview): Promise<string> {
  const data = enc.encode(
    `${r.judge}\x1f${r.project}\x1f${goValues(r.values)}`,
  );
  return toHex(await sha256(new Uint8Array([0]), data));
}

const node = (l: Uint8Array, r: Uint8Array) =>
  sha256(new Uint8Array([1]), l, r);

/** Largest power of two strictly below n (n >= 2). */
function split(n: number): number {
  let k = 1;
  while (k << 1 < n) k <<= 1;
  return k;
}

export async function merkleRoot(leaves: Uint8Array[]): Promise<Uint8Array> {
  if (leaves.length === 0) return sha256();
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return node(
    await merkleRoot(leaves.slice(0, k)),
    await merkleRoot(leaves.slice(k)),
  );
}

/** Audit path for leaf i, from the leaf up to the root. */
export async function inclusionProof(
  leaves: Uint8Array[],
  i: number,
): Promise<string[]> {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  if (i < k)
    return [
      ...(await inclusionProof(leaves.slice(0, k), i)),
      toHex(await merkleRoot(leaves.slice(k))),
    ];
  return [
    ...(await inclusionProof(leaves.slice(k), i - k)),
    toHex(await merkleRoot(leaves.slice(0, k))),
  ];
}

/** RFC 9162 §2.1.3.2: does the path take leaf i of n to the root? */
export async function verifyInclusion(
  leaf: string,
  i: number,
  n: number,
  path: string[],
  root: string,
): Promise<boolean> {
  if (i < 0 || i >= n) return false;
  let r = fromHex(leaf);
  let fn = i;
  let sn = n - 1;
  for (const p of path) {
    if (sn === 0) return false;
    const sib = fromHex(p);
    if (fn & 1 || fn === sn) {
      r = await node(sib, r);
      while (!(fn & 1) && fn !== 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      r = await node(r, sib);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && toHex(r) === root;
}

export type LeafCheck = {
  leaf: string;
  index: number;
  project?: string;
  path?: string[];
  ok: boolean;
  problem?: string;
};

export type ReviewAudit = {
  /** Root recomputed from the bundle's reviews. */
  root: string;
  /** The recomputed root equals the manifest's review_root. */
  rootMatches: boolean;
  count: number;
  checks: LeafCheck[];
};

/** Recompute the tree from the bundle and prove each of the judge's leaves. */
export async function auditReviews(
  reviews: BundleReview[],
  manifestRoot: string,
  mine: string[],
  pseudonym?: string,
): Promise<ReviewAudit> {
  const hex = await Promise.all(reviews.map(reviewLeaf));
  const leaves = hex.map(fromHex);
  const root = toHex(await merkleRoot(leaves));
  const index = new Map(hex.map((h, i) => [h, i]));
  const checks: LeafCheck[] = [];
  for (const leaf of mine) {
    const i = index.get(leaf);
    if (i === undefined) {
      checks.push({
        leaf,
        index: -1,
        ok: false,
        problem:
          "No review in the bundle has this hash: it was changed or left out.",
      });
      continue;
    }
    const r = reviews[i];
    const path = await inclusionProof(leaves, i);
    const ok = await verifyInclusion(
      leaf,
      i,
      leaves.length,
      path,
      manifestRoot,
    );
    checks.push({
      leaf,
      index: i,
      project: r.project,
      path,
      ok: ok && (!pseudonym || r.judge === pseudonym),
      problem: !ok
        ? "The path does not lead to the signed root."
        : pseudonym && r.judge !== pseudonym
          ? "This review is filed under another judge's pseudonym."
          : undefined,
    });
  }
  return {
    root,
    rootMatches: root === manifestRoot,
    count: reviews.length,
    checks,
  };
}

/** Ed25519 check of a signed manifest, where the browser supports it. */
export async function verifyManifestSignature(
  payloadB64: string,
  signatureB64: string,
  publicKeyB64: string,
): Promise<boolean | "unsupported"> {
  const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      b64(publicKeyB64),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      b64(signatureB64),
      b64(payloadB64),
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotSupportedError")
      return "unsupported";
    return false;
  }
}
