import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { Eyebrow } from "@/components/ui";

// The acceptance card shared by event invitations and team invite links.

export function InviteCard({
  eyebrow,
  icon,
  title,
  eventName,
  eventHref,
  children,
  details,
}: {
  eyebrow: string;
  icon: IconName;
  title: ReactNode;
  eventName: string;
  eventHref: string;
  children: ReactNode;
  details: ReactNode;
}) {
  return (
    <div className="relative isolate px-4 py-12 sm:py-20">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(50%_60%_at_50%_35%,black,transparent)]" />
      <article className="glow-edge mx-auto w-full max-w-lg animate-rise overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-5 py-3">
          <Eyebrow>{eyebrow}</Eyebrow>
          <span className="group">
            <LogoMark size={22} />
          </span>
        </header>
        <div className="p-6 sm:p-8">
          <span className="grid size-11 place-items-center rounded-lg border border-line-strong bg-surface-2 text-accent shadow-[0_0_32px_-10px_var(--glow)]">
            <Icon name={icon} size={19} />
          </span>
          <h1 className="mt-5 text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-ink-2">
            <Link href={eventHref} className="hover:text-ink hover:underline">
              {eventName}
            </Link>
          </p>
          <div className="mt-6">{details}</div>
          <div className="mt-7">{children}</div>
        </div>
      </article>
    </div>
  );
}

/** Sign-up / sign-in choice for anonymous visitors. */
export function AuthChoice({ next, verb }: { next: string; verb: string }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/signup?next=${next}`}
          className={`${buttonClass("accent")} flex-1`}
        >
          Create an account
        </Link>
        <Link
          href={`/login?next=${next}`}
          className={`${buttonClass("secondary")} flex-1`}
        >
          Sign in
        </Link>
      </div>
      <p className="text-center text-xs text-muted">
        You need an account to {verb}.
      </p>
    </div>
  );
}
