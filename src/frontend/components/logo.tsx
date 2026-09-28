import { useId } from "react";

// The mark: a dog tag with a bite taken out of its corner (dogfood: you eat
// what you ship) carrying a check drawn as a three-node path (judge → review
// → result). Colours come from --logo-body / --logo-ink so one component works
// in the nav, on certificates, in light and dark. Hovering a `.group` parent
// takes a bigger bite.

// Three overlapping circles at the top-right corner form the scalloped bite.
const BITE = [
  { cx: 25.6, cy: 3.1, r: 3.3 },
  { cx: 29.2, cy: 6.4, r: 3.3 },
  { cx: 29.9, cy: 11.3, r: 3.1 },
];

export function LogoMark({
  size = 28,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
    >
      <defs>
        <mask id={`bite-${id}`}>
          <rect width="32" height="32" fill="#fff" />
          {BITE.map((c, i) => (
            <circle
              key={c.cy}
              {...c}
              fill="#000"
              style={{ transitionDelay: `${i * 70}ms` }}
              className="origin-center transition-transform duration-300 ease-out [transform-box:fill-box] group-hover:scale-[1.28]"
            />
          ))}
          {/* the tag's chain hole */}
          <circle cx="11" cy="7.4" r="1.7" fill="#000" />
        </mask>
      </defs>
      <rect
        x="4"
        y="2"
        width="24"
        height="28"
        rx="7.5"
        fill="var(--logo-body, var(--accent))"
        mask={`url(#bite-${id})`}
      />
      <g
        fill="none"
        stroke="var(--logo-ink, var(--bg))"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 18.6 L14.3 22.6 L22 13.6" />
      </g>
      <g fill="var(--logo-ink, var(--bg))">
        <circle cx="10" cy="18.6" r="1.9" />
        <circle cx="14.3" cy="22.6" r="1.9" />
        <circle cx="22" cy="13.6" r="1.9" />
      </g>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-ink">
        dogfood
      </span>
      <span className="rounded-[4px] border border-line-strong px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-2">
        judge
      </span>
    </span>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="group inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <Wordmark />
    </span>
  );
}
