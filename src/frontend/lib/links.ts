// External project links. Two things make a link not worth opening:
//  - a scheme other than http(s): the API refuses these on submit, but
//    imported data is checked here too, so a javascript: URL never renders;
//  - a reserved placeholder host (RFC 2606 / RFC 6761): example.com, .org and
//    .net and their subdomains, and the .example, .test, .invalid and
//    .localhost top-level names. The DOGFOOD fixtures link every project to
//    example.org, which is a documentation page, not a repository.
// Keep this file free of runtime imports: `node --test` runs it directly.

export type LinkState = "ok" | "placeholder" | "invalid";

const RESERVED =
  /(^|\.)example\.(com|net|org)$|\.(example|test|invalid|localhost)$/;

export function linkState(raw: string | null | undefined): LinkState {
  if (!raw) return "invalid";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "invalid";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return "invalid";
  return RESERVED.test(host) ? "placeholder" : "ok";
}

/** The host to show next to a link, without the scheme. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}
