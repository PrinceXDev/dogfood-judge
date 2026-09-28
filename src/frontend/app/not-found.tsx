import Link from "next/link";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { LogoMark } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="relative mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 py-20 text-center">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(closest-side,black,transparent)]" />
      <div className="relative mb-8">
        <LogoMark size={56} />
        <span className="absolute -right-10 -top-3 rotate-6 rounded border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
          404
        </span>
      </div>
      <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em]">
        The pack couldn't find this.
      </h1>
      <p className="mt-4 text-ink-2">
        That page, event or project doesn't exist, or it isn't visible to your
        account. Drafts and unpublished results stay private.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Link href="/events" className={buttonClass("accent")}>
          Browse events <Icon name="arrowRight" size={14} />
        </Link>
        <Link href="/projects" className={buttonClass("secondary")}>
          Search projects
        </Link>
      </div>
    </div>
  );
}
