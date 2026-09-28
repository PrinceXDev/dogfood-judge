import Link from "next/link";
import { Icon } from "@/components/icons";
import { LogoMark, Wordmark } from "@/components/logo";

export const GITHUB_URL = "https://github.com/PrinceXDev/dogfood-judge";

const cols: [string, [string, string][]][] = [
  [
    "Product",
    [
      ["Events", "/events"],
      ["Projects", "/projects"],
      ["Results", "/results"],
      ["How it works", "/#how"],
    ],
  ],
  [
    "Integrity",
    [
      ["Verify a record", "/verify"],
      ["Signing key", "/.well-known/dogfood-signing-key"],
      ["Certificates", "/certificates"],
    ],
  ],
  [
    "Developers",
    [
      ["API reference", "/docs/api"],
      ["OpenAPI 3.1", "/api/v1/openapi.yaml"],
      ["Health", "/healthz"],
    ],
  ],
];

export function Footer() {
  return (
    <footer className="no-print relative mt-24 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <span className="group inline-flex items-center gap-2.5">
            <LogoMark size={24} />
            <Wordmark />
          </span>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            Open-source infrastructure for hackathons where results can be
            defended. Self-hosted, offline, one SQLite file.
          </p>
          <a
            href={GITHUB_URL}
            className="mt-5 inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink"
          >
            <Icon name="github" size={15} /> Source on GitHub
          </a>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
              {title}
            </p>
            <ul className="mt-4 grid gap-2.5 text-sm">
              {links.map(([label, href]) => (
                <li key={href}>
                  {href.startsWith("/api") ||
                  href.startsWith("/.well") ||
                  href === "/healthz" ? (
                    <a href={href} className="text-ink-2 hover:text-ink">
                      {label}
                    </a>
                  ) : (
                    <Link href={href} className="text-ink-2 hover:text-ink">
                      {label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 font-mono text-[11px] text-muted sm:px-6">
          <span>
            MIT licensed · no cloud dependency · works with the network off
          </span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-good" /> pack integrity:
            hash-chained audit log
          </span>
        </div>
      </div>
    </footer>
  );
}
