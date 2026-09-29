import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { FieldError } from "@/components/validation";
import type { ApiError } from "@/lib/api";

// Presentational building blocks. Server components; no state. Everything
// here reads the design tokens in globals.css, so both themes come for free.

export type Tone = "neutral" | "good" | "warn" | "bad" | "accent" | "info";

const toneText: Record<Tone, string> = {
  neutral: "text-ink-2",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  accent: "text-accent",
  info: "text-info",
};
const toneBg: Record<Tone, string> = {
  neutral: "bg-muted",
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  accent: "bg-accent",
  info: "bg-info",
};

/** Mono, uppercase kicker above headings: "▍ JUDGING HEALTH". */
export function Eyebrow({
  children,
  tone = "accent",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <p
      className={`flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted ${className}`}
    >
      <span className={`h-3 w-[3px] rounded-full ${toneBg[tone]}`} />
      {children}
    </p>
  );
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-3xl animate-rise">
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <h1 className="text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          {title}
        </h1>
        {sub && (
          <div className="mt-3 text-pretty text-[15px] leading-relaxed text-ink-2">
            {sub}
          </div>
        )}
        {children}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/** Kept for simple pages: a PageHeader without the extras. */
export function PageTitle({
  children,
  sub,
  eyebrow,
}: {
  children: ReactNode;
  sub?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return <PageHeader title={children} sub={sub} eyebrow={eyebrow} />;
}

export function Section({
  title,
  eyebrow,
  id,
  children,
  aside,
  desc,
  className = "",
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  id?: string;
  children: ReactNode;
  aside?: ReactNode;
  desc?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mt-14 scroll-mt-24 first:mt-0 ${className}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
          <h2 className="text-xl font-semibold tracking-[-0.025em]">{title}</h2>
          {desc && (
            <div className="mt-1.5 text-sm leading-relaxed text-ink-2">
              {desc}
            </div>
          )}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
  glow = false,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  as?: "div" | "article" | "section" | "aside";
}) {
  return (
    <As
      className={`rounded-lg border border-line bg-surface p-5 shadow-[var(--shadow)] ${glow ? "glow-edge" : ""} ${className}`}
    >
      {children}
    </As>
  );
}

/** A card with a titled header strip, for dense tool panels. */
export function Panel({
  title,
  icon,
  aside,
  children,
  className = "",
  bodyClass = "p-4",
  id,
}: {
  title: ReactNode;
  icon?: IconName;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-24 overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow)] ${className}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-[13px] font-medium text-ink">
          {icon && <Icon name={icon} size={14} className="text-muted" />}
          {title}
        </h3>
        {aside && (
          <div className="flex items-center gap-2 text-xs text-muted">
            {aside}
          </div>
        )}
      </header>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Tag({
  children,
  tone = "neutral",
  dot = false,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  const border: Record<Tone, string> = {
    neutral: "border-line-strong bg-surface-2",
    good: "border-good/30 bg-good/10",
    warn: "border-warn/30 bg-warn/10",
    bad: "border-bad/30 bg-bad/10",
    accent: "border-accent/30 bg-accent/10",
    info: "border-info/30 bg-info/10",
  };
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11.5px] font-medium ${border[tone]} ${toneText[tone]} ${className}`}
    >
      {dot && <span className={`size-1.5 rounded-full ${toneBg[tone]}`} />}
      {children}
    </span>
  );
}

export function StatusDot({
  tone = "good",
  pulse = false,
  label,
}: {
  tone?: Tone;
  pulse?: boolean;
  label?: string;
}) {
  return (
    <span
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      className={`inline-block size-2 shrink-0 rounded-full ${toneBg[tone]} ${pulse ? "animate-pulse-dot" : ""}`}
    />
  );
}

export function Metric({
  label,
  value,
  sub,
  tone,
  icon,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: IconName;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface px-4 py-3.5 ${className}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div
        className={`mt-1.5 font-mono text-2xl font-medium tracking-tight tabular ${tone ? toneText[tone] : "text-ink"}`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Back-compat alias for Metric with the label under the value. */
export function Stat({
  value,
  label,
  tone,
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: Tone;
}) {
  return <Metric value={value} label={label} tone={tone} />;
}

export function Stats({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {children}
    </div>
  );
}

const calloutIcon: Record<Tone, IconName> = {
  neutral: "info",
  info: "info",
  accent: "sparkles",
  good: "shieldCheck",
  warn: "alert",
  bad: "alert",
};

export function Callout({
  tone = "neutral",
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const box: Record<Tone, string> = {
    neutral: "border-line bg-surface-2",
    info: "border-info/25 bg-info/[0.06]",
    accent: "border-accent/25 bg-accent/[0.06]",
    good: "border-good/25 bg-good/[0.06]",
    warn: "border-warn/25 bg-warn/[0.06]",
    bad: "border-bad/30 bg-bad/[0.07]",
  };
  return (
    <div
      className={`my-4 flex gap-3 rounded-lg border px-4 py-3 text-sm ${box[tone]}`}
    >
      <Icon
        name={calloutIcon[tone]}
        size={16}
        className={`mt-0.5 shrink-0 ${toneText[tone]}`}
      />
      <div className="min-w-0 flex-1 leading-relaxed text-ink-2">
        {title && <p className="mb-0.5 font-medium text-ink">{title}</p>}
        {children}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/** A thin horizontal meter, 0–100. */
export function Bar({
  value,
  tone = "accent",
  className = "",
  label,
}: {
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a themed meter; native <meter> styling differs per browser
    <div
      role="meter"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-1.5 min-w-16 overflow-hidden rounded-full bg-line ${className}`}
    >
      <div
        className={`h-full rounded-full ${toneBg[tone]} transition-[width] duration-700 ease-out`}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

/** Segmented progress, like ████████░░, for phase windows. */
export function Segments({
  value,
  count = 12,
  tone = "accent",
  label,
}: {
  value: number;
  count?: number;
  tone?: Tone;
  label?: string;
}) {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * count);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a themed meter; native <meter> styling differs per browser
    <div
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="flex gap-[3px]"
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative segments
          key={i}
          className={`h-2 flex-1 rounded-[2px] ${i < filled ? toneBg[tone] : "bg-line"}`}
          style={
            i < filled
              ? { opacity: 0.55 + (0.45 * (i + 1)) / filled }
              : undefined
          }
        />
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-mono text-[10.5px] font-medium text-ink-2 shadow-[0_1px_0_var(--line-strong)]">
      {children}
    </kbd>
  );
}

/** A long hash shown compactly, full value on hover and to screen readers. */
export function Hash({
  value,
  head = 10,
  className = "",
}: {
  value: string;
  head?: number;
  className?: string;
}) {
  if (!value) return <span className="text-muted">·</span>;
  const short =
    value.length > head + 6
      ? `${value.slice(0, head)}…${value.slice(-4)}`
      : value;
  return (
    <span title={value} className={`font-mono text-xs ${className}`}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
  icon = "sparkles",
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface/40 px-6 py-12 text-center">
      <span className="mb-4 grid size-10 place-items-center rounded-full border border-line-strong bg-surface-2 text-accent">
        <Icon name={icon} size={18} />
      </span>
      <p className="font-medium">{title}</p>
      {children && (
        <div className="mt-1.5 max-w-md text-sm text-ink-2">{children}</div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden rounded-md bg-surface-2 ${className}`}
    >
      <div className="absolute inset-0 animate-scan bg-gradient-to-r from-transparent via-line/70 to-transparent" />
    </div>
  );
}

const problems: Record<
  number,
  { title: string; body: string; icon: IconName }
> = {
  403: {
    title: "Private judging territory.",
    body: "The API refused this for your account. Judges only see their own scores, and organizer tools are limited to that event's organizers.",
    icon: "lock",
  },
  404: {
    title: "This project wandered off.",
    body: "The pack couldn't find it: it doesn't exist, or you don't have access to it.",
    icon: "search",
  },
  409: {
    title: "That conflicts with the current state.",
    body: "Something changed since this page loaded. Reload and try again.",
    icon: "split",
  },
};

export function Problem({
  error,
}: {
  error: ApiError | { status: number; message: string };
}) {
  const p = problems[error.status] ?? {
    title: "The judging engine hit an unexpected state.",
    body: "Nothing was lost: every write is transactional and audited. Try again in a moment.",
    icon: "activity" as IconName,
  };
  return (
    <div className="relative mx-auto max-w-xl py-20 text-center">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(closest-side,black,transparent)]" />
      <span className="mx-auto mb-6 grid size-12 place-items-center rounded-xl border border-line-strong bg-surface text-accent shadow-[0_0_40px_-10px_var(--glow)]">
        <Icon name={p.icon} size={20} />
      </span>
      <p className="font-mono text-xs tracking-[0.2em] text-muted">
        ERROR {error.status}
      </p>
      <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em]">
        {p.title}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-ink-2">{p.body}</p>
      {error.message && (
        <p className="mx-auto mt-4 max-w-md rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-muted">
          {error.message}
        </p>
      )}
      <div className="mt-8 flex justify-center gap-2">
        <Link href="/events" className={buttonClass("secondary")}>
          Browse events
        </Link>
        <Link href="/" className={buttonClass("ghost")}>
          Home
        </Link>
      </div>
    </div>
  );
}

export function Table({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-x-auto rounded-lg border border-line bg-surface ${className}`}
    >
      <table className="w-full text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-hover/60 [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-mono [&_th]:text-[10.5px] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-muted">
        {children}
      </table>
    </div>
  );
}

export const num = "text-right font-mono tabular whitespace-nowrap";

export const inputCls =
  "w-full rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-muted/80 hover:border-muted/50 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 aria-[invalid=true]:border-bad/70 aria-[invalid=true]:focus:ring-bad/15";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="grid gap-1.5 text-[13px] font-medium text-ink">
      <span>
        <span data-label>{label}</span>
        {hint && (
          <span className="ml-2 text-xs font-normal text-muted">{hint}</span>
        )}
      </span>
      {children}
      <FieldError />
    </label>
  );
}

/** Label/value rows, for metadata blocks. */
export function DataList({
  items,
  className = "",
}: {
  items: [ReactNode, ReactNode][];
  className?: string;
}) {
  return (
    <dl
      className={`grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2.5 text-sm ${className}`}
    >
      {items.map(([k, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static rows
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
    >
      <Icon
        name="arrowLeft"
        size={14}
        className="transition-transform group-hover:-translate-x-0.5"
      />
      {children}
    </Link>
  );
}

/** The standard page container. The landing page opts out for full bleed. */
export function Page({
  children,
  width = "wide",
  className = "",
}: {
  children: ReactNode;
  width?: "narrow" | "medium" | "wide";
  className?: string;
}) {
  const max = { narrow: "max-w-xl", medium: "max-w-4xl", wide: "max-w-7xl" }[
    width
  ];
  return (
    <div
      className={`mx-auto w-full ${max} px-4 py-10 sm:px-6 sm:py-12 ${className}`}
    >
      {children}
    </div>
  );
}
