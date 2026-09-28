// Displays derived from a record's real Ed25519 signature. Nothing here is
// decorative noise: every cell and character comes from the signature bytes,
// so two different records never look alike.

export function signatureBytes(b64: string): number[] {
  try {
    return Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return [];
  }
}

const hex = (bytes: number[]) =>
  bytes
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

/** A short, human-quotable ID: the first four signature bytes, DJ-XXXX-XXXX. */
export function recordId(signature: string): string {
  const h = hex(signatureBytes(signature).slice(0, 4));
  return h.length === 8 ? `DJ-${h.slice(0, 4)}-${h.slice(4)}` : "DJ-····-····";
}

/** The first 16 signature bytes as grouped hex, like an SSH fingerprint. */
export function fingerprint(signature: string, bytes = 16): string {
  const h = hex(signatureBytes(signature).slice(0, bytes));
  return h.match(/.{1,4}/g)?.join(" ") ?? "";
}

/** The 64 signature bytes as an 8×8 dot matrix sized by value. A glyph, not a code. */
export function SignatureGlyph({
  signature,
  size = 72,
  className = "",
}: {
  signature: string;
  size?: number;
  className?: string;
}) {
  const bytes = signatureBytes(signature).slice(0, 64);
  if (bytes.length === 0) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      role="img"
      aria-label="Visual fingerprint of the signature"
      className={`shrink-0 [print-color-adjust:exact] ${className}`}
    >
      {bytes.map((b, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions in the grid
          key={i}
          cx={(i % 8) + 0.5}
          cy={Math.floor(i / 8) + 0.5}
          r={0.14 + (b / 255) * 0.32}
          fill="currentColor"
          opacity={0.35 + (b / 255) * 0.65}
        />
      ))}
    </svg>
  );
}
