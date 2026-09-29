import { type ButtonVariant, buttonClass } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { hostOf, linkState } from "@/lib/links";
import type { Project } from "@/lib/types";

// Repository and demo links, the same everywhere a project is shown. A link
// to a reserved placeholder host (the fixtures use example.org) is shown as
// what it is, sample data, instead of a button that opens a stranger's page.

type Kind = "repo" | "demo";

const META: Record<Kind, { label: string; icon: IconName }> = {
  repo: { label: "Repository", icon: "github" },
  demo: { label: "Live demo", icon: "eye" },
};

export function ProjectLink({
  href,
  kind,
  variant = "secondary",
  size = "sm",
}: {
  href: string;
  kind: Kind;
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  const { label, icon } = META[kind];
  const state = linkState(href);
  if (state !== "ok") {
    return (
      <span
        aria-disabled="true"
        title={
          state === "placeholder"
            ? `${hostOf(href)} is a reserved example address: this ${kind === "repo" ? "repository" : "demo"} link is sample data and leads nowhere.`
            : "This link isn't a valid web address."
        }
        className={`${buttonClass("ghost", size)} border border-dashed border-line-strong text-muted hover:bg-transparent hover:text-muted`}
      >
        <Icon name={icon} size={13} />
        {label}
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
          {state === "placeholder" ? "sample" : "invalid"}
        </span>
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={buttonClass(variant, size)}
    >
      <Icon name={icon} size={13} />
      {label}
      <Icon name="arrowUpRight" size={12} className="opacity-60" />
      <span className="sr-only">(opens {hostOf(href)} in a new tab)</span>
    </a>
  );
}

/** Both links, or a quiet note when the project has neither. */
export function ProjectLinks({
  p,
  size = "sm",
  primary = false,
  empty = true,
}: {
  p: Pick<Project, "repo_url" | "demo_url">;
  size?: "sm" | "md";
  /** Stronger buttons, for the project's own page. */
  primary?: boolean;
  empty?: boolean;
}) {
  if (!p.repo_url && !p.demo_url) {
    return empty ? (
      <p className="text-sm text-muted">No repository or demo linked.</p>
    ) : null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {p.repo_url && (
        <ProjectLink
          href={p.repo_url}
          kind="repo"
          size={size}
          variant={primary ? "primary" : "secondary"}
        />
      )}
      {p.demo_url && (
        <ProjectLink
          href={p.demo_url}
          kind="demo"
          size={size}
          variant={primary ? "accent" : "secondary"}
        />
      )}
    </div>
  );
}
