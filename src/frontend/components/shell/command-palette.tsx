"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { logout } from "@/app/actions";
import { Icon, type IconName } from "@/components/icons";
import { Kbd } from "@/components/ui";
import {
  currentTheme,
  reducedMotion,
  setReducedMotion,
  setTheme,
} from "@/lib/prefs";
import type { NavData } from "./nav-data";

// Global keyboard layer: ⌘K/Ctrl+K palette, "g x" chords, J/K through any
// list marked [data-nav-item], "?" for the shortcut sheet. Every command maps
// to a real route or preference; nothing here is decorative.

type Command = {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  hint?: string;
  keywords?: string;
  href?: string;
  run?: () => void;
};

const Ctx = createContext<{ open: () => void; help: () => void }>({
  open: () => {},
  help: () => {},
});
export const usePalette = () => useContext(Ctx);

export const CHORDS: [string, string, string][] = [
  ["d", "Dashboard", "/dashboard"],
  ["e", "Events", "/events"],
  ["p", "Projects", "/projects"],
  ["j", "Judging", "/judge"],
  ["r", "Results", "/results"],
  ["c", "Certificates", "/certificates"],
  ["h", "Home", "/"],
];

function score(q: string, label: string, extra: string): number {
  if (!q) return 1;
  const l = label.toLowerCase();
  const i = l.indexOf(q);
  if (i >= 0) return 100 - i;
  if (extra.toLowerCase().includes(q)) return 40;
  // Scattered letters ("gres" → "Go to results") only count against the label.
  if (q.length < 3) return 0;
  let at = 0;
  for (const ch of q) {
    at = l.indexOf(ch, at);
    if (at < 0) return 0;
    at++;
  }
  return 10;
}

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  );
}

export function CommandProvider({
  nav,
  children,
}: {
  nav: NavData;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const logoutForm = useRef<HTMLFormElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    const c: Command[] = [
      { id: "home", label: "Home", group: "Navigate", icon: "grid", href: "/" },
      {
        id: "events",
        label: "Events",
        group: "Navigate",
        icon: "layers",
        href: "/events",
        hint: "G E",
      },
      {
        id: "projects",
        label: "Projects gallery",
        group: "Navigate",
        icon: "box",
        href: "/projects",
        hint: "G P",
      },
      {
        id: "results",
        label: "Results",
        group: "Navigate",
        icon: "trophy",
        href: "/results",
        hint: "G R",
      },
      {
        id: "verify",
        label: "Verify a record",
        group: "Navigate",
        icon: "shieldCheck",
        href: "/verify",
        keywords: "certificate signature",
      },
      {
        id: "docs",
        label: "API documentation",
        group: "Navigate",
        icon: "terminal",
        href: "/docs/api",
        keywords: "openapi rest",
      },
      {
        id: "how",
        label: "How the judging engine works",
        group: "Navigate",
        icon: "activity",
        href: "/#how",
        keywords: "normalization bayes",
      },
    ];
    if (nav.user) {
      c.push(
        {
          id: "dash",
          label: "Dashboard",
          group: "Navigate",
          icon: "grid",
          href: "/dashboard",
          hint: "G D",
        },
        {
          id: "certs",
          label: "Certificates and records",
          group: "Navigate",
          icon: "file",
          href: "/certificates",
          hint: "G C",
        },
        {
          id: "settings",
          label: "Settings and API tokens",
          group: "Navigate",
          icon: "settings",
          href: "/account",
        },
      );
      if (nav.judge)
        c.push({
          id: "judge",
          label: "Judging workspace",
          group: "Navigate",
          icon: "gavel",
          href: "/judge",
          hint: "G J",
        });
      if (nav.canCreate)
        c.push({
          id: "new",
          label: "Create an event",
          group: "Organize",
          icon: "plus",
          href: "/organize/new",
        });
    } else {
      c.push(
        {
          id: "login",
          label: "Sign in",
          group: "Account",
          icon: "key",
          href: "/login",
        },
        {
          id: "signup",
          label: "Create an account",
          group: "Account",
          icon: "users",
          href: "/signup",
        },
      );
    }
    for (const e of nav.events) {
      c.push({
        id: `ev-${e.slug}`,
        label: e.name,
        group: "Events",
        icon: "layers",
        href: `/events/${e.slug}`,
        keywords: `event ${e.slug}`,
      });
      if (e.organizer) {
        c.push(
          {
            id: `org-${e.slug}`,
            label: `${e.name}: command center`,
            group: "Organize",
            icon: "activity",
            href: `/organize/${e.slug}`,
            keywords: "dashboard organizer",
          },
          {
            id: `res-${e.slug}`,
            label: `${e.name}: results and defensibility`,
            group: "Organize",
            icon: "trophy",
            href: `/organize/${e.slug}/results`,
          },
          {
            id: `aud-${e.slug}`,
            label: `${e.name}: audit trail`,
            group: "Organize",
            icon: "commit",
            href: `/organize/${e.slug}/audit`,
            keywords: "log hash chain",
          },
        );
      } else if (e.published) {
        c.push({
          id: `res-${e.slug}`,
          label: `${e.name}: results`,
          group: "Events",
          icon: "trophy",
          href: `/events/${e.slug}/results`,
        });
      }
    }
    c.push(
      {
        id: "theme",
        label: "Toggle light / dark theme",
        group: "Preferences",
        icon: "sun",
        run: () => setTheme(currentTheme() === "dark" ? "light" : "dark"),
      },
      {
        id: "motion",
        label: "Toggle reduced motion",
        group: "Preferences",
        icon: "eye",
        run: () => setReducedMotion(!reducedMotion()),
      },
      {
        id: "keys",
        label: "Keyboard shortcuts",
        group: "Preferences",
        icon: "command",
        hint: "?",
        run: () => setHelp(true),
      },
    );
    if (nav.user)
      c.push({
        id: "logout",
        label: "Sign out",
        group: "Account",
        icon: "logOut",
        run: () => logoutForm.current?.requestSubmit(),
      });
    return c;
  }, [nav]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = commands
      .map((c) => ({
        c,
        s: score(needle, c.label, `${c.keywords ?? ""} ${c.group}`),
      }))
      .filter((x) => x.s > 0);
    // Keep each group together, groups ordered by their best match, ties in
    // the order commands are defined.
    const best = new Map<string, number>();
    const order = new Map<string, number>();
    for (const x of hits) {
      best.set(x.c.group, Math.max(best.get(x.c.group) ?? 0, x.s));
      if (!order.has(x.c.group)) order.set(x.c.group, order.size);
    }
    const sorted = hits
      .sort(
        (a, b) =>
          (best.get(b.c.group) ?? 0) - (best.get(a.c.group) ?? 0) ||
          (order.get(a.c.group) ?? 0) - (order.get(b.c.group) ?? 0) ||
          b.s - a.s,
      )
      .map((x) => x.c);
    if (needle)
      sorted.push({
        id: "search",
        label: `Search projects for “${q.trim()}”`,
        group: "Search",
        icon: "search",
        href: `/projects?q=${encodeURIComponent(q.trim())}`,
      });
    return sorted;
  }, [q, commands]);

  const show = useCallback(() => {
    restore.current = document.activeElement as HTMLElement;
    setQ("");
    setSel(0);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setHelp(false);
    restore.current?.focus?.();
  }, []);

  const run = useCallback(
    (c: Command) => {
      setOpen(false);
      if (c.href) router.push(c.href);
      else c.run?.();
    },
    [router],
  );

  useEffect(() => {
    let chord = 0;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
        return;
      }
      if (e.key === "Escape" && (open || help)) {
        e.preventDefault();
        close();
        return;
      }
      if (open || help || mod || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "?" || (e.shiftKey && k === "/")) {
        e.preventDefault();
        setHelp(true);
        return;
      }
      if (chord && Date.now() - chord < 1200) {
        chord = 0;
        const hit = CHORDS.find(([c]) => c === k);
        if (hit) {
          e.preventDefault();
          router.push(hit[2]);
        }
        return;
      }
      if (k === "g") {
        chord = Date.now();
        return;
      }
      if (k === "j" || k === "k") {
        const items = [
          ...document.querySelectorAll<HTMLElement>("[data-nav-item]"),
        ];
        if (!items.length) return;
        e.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next =
          at < 0
            ? 0
            : Math.max(
                0,
                Math.min(items.length - 1, at + (k === "j" ? 1 : -1)),
              );
        items[next].focus();
        items[next].scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, help, show, close, router]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const ctx = useMemo(
    () => ({ open: show, help: () => setHelp(true) }),
    [show],
  );
  let lastGroup = "";

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {nav.user && (
        <form ref={logoutForm} action={logout} className="hidden">
          <button type="submit">Sign out</button>
        </form>
      )}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
          <button
            type="button"
            aria-label="Close command palette"
            className="absolute inset-0 animate-fade bg-bg/70 backdrop-blur-sm"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="relative w-full max-w-xl animate-rise overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_40px_80px_-20px_rgb(0_0_0/0.6),0_0_0_1px_var(--line)]"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Icon name="search" size={16} className="text-muted" />
              <input
                ref={input}
                // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSel((s) => Math.min(results.length - 1, s + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSel((s) => Math.max(0, s - 1));
                  } else if (e.key === "Enter" && results[sel]) {
                    e.preventDefault();
                    run(results[sel]);
                  }
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls="cmdk-list"
                aria-activedescendant={
                  results[sel] ? `cmdk-${results[sel].id}` : undefined
                }
                placeholder="Search commands, events, projects…"
                className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted focus-visible:outline-none"
              />
              <Kbd>esc</Kbd>
            </div>
            <div
              ref={list}
              id="cmdk-list"
              role="listbox"
              className="max-h-[min(60vh,420px)] overflow-y-auto p-2"
            >
              {results.map((c, i) => {
                const head = c.group !== lastGroup;
                lastGroup = c.group;
                return (
                  <div key={c.id}>
                    {head && (
                      <p className="px-2.5 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted first:pt-1">
                        {c.group}
                      </p>
                    )}
                    <div
                      id={`cmdk-${c.id}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === sel}
                      data-index={i}
                      onMouseMove={() => setSel(i)}
                      onClick={() => run(c)}
                      onKeyDown={() => {}}
                      className={`flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm ${i === sel ? "bg-surface-hover text-ink" : "text-ink-2"}`}
                    >
                      <Icon
                        name={c.icon}
                        size={15}
                        className={i === sel ? "text-accent" : "text-muted"}
                      />
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && (
                        <span className="font-mono text-[10.5px] text-muted">
                          {c.hint}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {!results.length && (
                <p className="px-3 py-8 text-center text-sm text-muted">
                  No command matches.
                </p>
              )}
            </div>
            <div className="flex items-center gap-4 border-t border-line bg-surface-2/60 px-4 py-2 text-[11px] text-muted">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Kbd>?</Kbd> shortcuts
              </span>
            </div>
          </div>
        </div>
      )}
      {help && <ShortcutSheet onClose={close} />}
    </Ctx.Provider>
  );
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const rows: [string[], string][] = [
    [["⌘", "K"], "Command palette (Ctrl K on Windows and Linux)"],
    ...CHORDS.map(
      ([k, label]) =>
        [["G", k.toUpperCase()], `Go to ${label.toLowerCase()}`] as [
          string[],
          string,
        ],
    ),
    [["J"], "Next item in a list"],
    [["K"], "Previous item in a list"],
    [["A", "B", "T"], "Pairwise: choose A, B, or a tie"],
    [["1–9"], "Review: score the focused criterion"],
    [["Esc"], "Close dialogs"],
  ];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close shortcuts"
        className="absolute inset-0 animate-fade bg-bg/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative w-full max-w-md animate-rise rounded-xl border border-line-strong bg-surface p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <ul className="grid gap-2.5 text-sm">
          {rows.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between gap-4">
              <span className="text-ink-2">{label}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
