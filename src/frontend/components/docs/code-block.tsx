import { CopyButton } from "@/components/docs/copy-button";

// A shell snippet with a title bar. Lines starting with "#" are comments and
// render muted, which is all the highlighting curl examples need.

export function CodeBlock({
  title,
  code,
  lang = "shell",
}: {
  title: string;
  code: string;
  lang?: string;
}) {
  return (
    <figure className="my-4 overflow-hidden rounded-lg border border-line bg-sunken">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 py-1.5 pr-2 pl-3.5">
        <span className="flex items-center gap-2 font-mono text-[11px] text-muted">
          <span className="text-accent">{lang}</span>
          <span aria-hidden="true">·</span>
          {title}
        </span>
        <CopyButton text={code} />
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-xs leading-relaxed text-ink">
        <code>
          {code.split("\n").map((line, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: lines of a static snippet
              key={i}
              className={`block ${line.startsWith("#") ? "text-muted" : ""}`}
            >
              {line || " "}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
