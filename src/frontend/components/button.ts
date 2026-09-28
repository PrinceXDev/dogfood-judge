// Button styles as a plain function, usable from server and client components.

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "accent";

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: "sm" | "md" | "lg" = "md",
) {
  const base =
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-50";
  const sizes = {
    sm: "h-7 px-2.5 text-[13px]",
    md: "h-9 px-3.5 text-sm",
    lg: "h-11 px-5 text-[15px]",
  };
  const variants = {
    primary:
      "bg-ink text-bg hover:bg-ink/90 shadow-[0_1px_0_rgb(255_255_255/0.15)_inset]",
    accent:
      "bg-accent text-accent-ink hover:shadow-[0_0_0_4px_var(--accent-soft),0_0_24px_-4px_var(--glow)]",
    secondary:
      "border border-line-strong bg-surface-2 text-ink hover:border-muted/60 hover:bg-surface-hover",
    ghost: "text-ink-2 hover:bg-surface-hover hover:text-ink",
    danger:
      "border border-bad/40 bg-bad/10 text-bad hover:border-bad/70 hover:bg-bad/15",
  };
  return `${base} ${sizes[size]} ${variants[variant]}`;
}
