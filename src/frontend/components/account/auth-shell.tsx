import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { Eyebrow } from "@/components/ui";

// Split layout for the sign-in, sign-up and activation screens: the form on
// the left, a quiet brand panel on the right. One column below lg.

const FACTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "lock",
    title: "Judges only see their own scores",
    body: "The API refuses anyone else's reviews unless you organize that event.",
  },
  {
    icon: "shieldCheck",
    title: "Results are signed",
    body: "Published rankings ship as an Ed25519-signed bundle anyone can re-run and verify.",
  },
  {
    icon: "wifiOff",
    title: "Runs offline",
    body: "Self-hosted, with fonts and assets served locally. Nothing leaves the portal unless its operator turns on a sign-in provider.",
  },
];

export function AuthShell({
  eyebrow,
  title,
  sub,
  children,
  footer,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:min-h-[calc(100dvh-8rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
      <div className="mx-auto w-full max-w-sm animate-rise">
        <Eyebrow className="mb-4">{eyebrow}</Eyebrow>
        <h1 className="text-balance text-3xl font-semibold tracking-[-0.035em]">
          {title}
        </h1>
        {sub && (
          <div className="mt-2.5 text-pretty text-[15px] leading-relaxed text-ink-2">
            {sub}
          </div>
        )}
        <div className="mt-8">{children}</div>
        {footer && (
          <div className="mt-8 border-t border-line pt-5 text-sm leading-relaxed text-muted">
            {footer}
          </div>
        )}
      </div>
      <BrandPanel />
    </div>
  );
}

function BrandPanel() {
  return (
    <aside
      aria-label="About Dogfood Judge"
      className="relative isolate overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)] animate-fade"
    >
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(120%_90%_at_100%_0%,black,transparent_75%)]" />
      <div className="pointer-events-none absolute -right-24 -top-24 -z-10 size-72 rounded-full bg-accent/10 blur-3xl" />
      <div className="flex h-full flex-col p-6 sm:p-10">
        <div className="group flex items-center gap-3">
          <LogoMark size={36} />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            dogfood judge
          </span>
        </div>
        <p className="mt-8 text-balance text-3xl font-semibold leading-tight tracking-[-0.035em] sm:mt-12 sm:text-4xl">
          Judge the work.{" "}
          <span className="font-serif text-[1.1em] font-normal italic text-accent">
            Prove
          </span>{" "}
          the result.
        </p>
        <ul className="mt-8 grid gap-5 sm:mt-10">
          {FACTS.map((f) => (
            <li key={f.title} className="flex gap-3.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line-strong bg-surface-2 text-accent">
                <Icon name={f.icon} size={15} />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{f.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
                  {f.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-10 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-4 font-mono text-[11px] text-muted sm:mt-12">
          <span>ed25519</span>
          <span aria-hidden="true">·</span>
          <span>sha-256 audit chain</span>
          <span aria-hidden="true">·</span>
          <span>open source</span>
        </p>
      </div>
    </aside>
  );
}
