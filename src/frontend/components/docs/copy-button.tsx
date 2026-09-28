"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-live="polite"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        })
      }
      className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${copied ? "text-accent" : "text-muted hover:bg-surface-hover hover:text-ink"}`}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
