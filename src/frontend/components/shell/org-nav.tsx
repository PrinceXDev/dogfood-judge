"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";

// The organizer command center's navigation. Every entry is a real page or
// a section anchor on one; nothing links to a view that doesn't exist.

type Entry = { label: string; path: string; icon: IconName };

const GROUPS: [string, Entry[]][] = [
  [
    "Operate",
    [
      { label: "Overview", path: "", icon: "activity" },
      { label: "Judges & assignments", path: "#judges", icon: "users" },
      { label: "Results", path: "/results", icon: "trophy" },
      {
        label: "Defensibility",
        path: "/results#defensibility",
        icon: "shieldCheck",
      },
      { label: "Audit trail", path: "/audit", icon: "commit" },
    ],
  ],
  [
    "Manage",
    [
      { label: "Moderation", path: "/moderation", icon: "flag" },
      { label: "Voting", path: "/moderation#votes", icon: "vote" },
      { label: "Settings", path: "/settings", icon: "settings" },
      { label: "Rubric", path: "/settings#rubric", icon: "layers" },
      { label: "Webhooks", path: "/settings#webhooks", icon: "terminal" },
      { label: "Exports", path: "#exports", icon: "download" },
    ],
  ],
];

export function OrgNav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/organize/${slug}`;
  const active = (e: Entry) => !e.path.includes("#") && path === base + e.path;
  const primary = GROUPS.flatMap(([, es]) => es).filter(
    (e) => !e.path.includes("#"),
  );
  return (
    <>
      <nav
        aria-label="Organizer"
        className="sticky top-20 hidden w-52 shrink-0 self-start lg:block"
      >
        {GROUPS.map(([group, entries]) => (
          <div key={group} className="mb-6">
            <p className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              {group}
            </p>
            <ul className="grid gap-px">
              {entries.map((e) => {
                const on = active(e);
                return (
                  <li key={e.label}>
                    <Link
                      href={base + e.path}
                      aria-current={on ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${on ? "bg-surface-hover text-ink" : "text-ink-2 hover:bg-surface-hover/60 hover:text-ink"}`}
                    >
                      <Icon
                        name={e.icon}
                        size={14}
                        className={on ? "text-accent" : "text-muted"}
                      />
                      {e.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <nav
        aria-label="Organizer"
        className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 lg:hidden"
      >
        {primary.map((e) => {
          const on = active(e);
          return (
            <Link
              key={e.label}
              href={base + e.path}
              aria-current={on ? "page" : undefined}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${on ? "border-accent text-ink" : "border-transparent text-muted"}`}
            >
              <Icon name={e.icon} size={13} />
              {e.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
