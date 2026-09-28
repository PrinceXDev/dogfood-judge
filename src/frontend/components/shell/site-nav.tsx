"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/actions";
import { buttonClass } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Kbd } from "@/components/ui";
import { currentTheme, setTheme, type Theme } from "@/lib/prefs";
import { usePalette } from "./command-palette";
import type { NavData } from "./nav-data";

type Item = { href: string; label: string; icon: IconName };

function items(nav: NavData): Item[] {
  const out: Item[] = [];
  if (nav.user)
    out.push({ href: "/dashboard", label: "Dashboard", icon: "grid" });
  out.push(
    { href: "/events", label: "Events", icon: "layers" },
    { href: "/projects", label: "Projects", icon: "box" },
  );
  if (nav.judge) out.push({ href: "/judge", label: "Judging", icon: "gavel" });
  out.push({ href: "/results", label: "Results", icon: "trophy" });
  if (!nav.user)
    out.push({ href: "/#how", label: "How it works", icon: "activity" });
  out.push({ href: "/docs/api", label: "Docs", icon: "terminal" });
  return out;
}

function isActive(path: string, href: string) {
  if (href.startsWith("/#")) return false;
  if (href === "/judge") return path.startsWith("/judge");
  if (href === "/events")
    return (
      path === "/events" ||
      (path.startsWith("/events/") && !path.endsWith("/results"))
    );
  if (href === "/results")
    return path === "/results" || /^\/events\/[^/]+\/results$/.test(path);
  if (href === "/dashboard")
    return path === "/dashboard" || path.startsWith("/organize");
  return path === href || path.startsWith(`${href}/`);
}

function ThemeToggle() {
  const [theme, set] = useState<Theme>("dark");
  useEffect(() => {
    set(currentTheme());
    const on = () => set(currentTheme());
    window.addEventListener("dj-prefs", on);
    return () => window.removeEventListener("dj-prefs", on);
  }, []);
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-ink"
    >
      <Icon name={theme === "dark" ? "moon" : "sun"} size={15} />
    </button>
  );
}

function UserMenu({ nav }: { nav: NavData }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!nav.user) return null;
  const initials = nav.user.name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-line-strong bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-[13px] text-ink-2 transition-colors hover:text-ink"
      >
        <span className="grid size-6 place-items-center rounded-full bg-accent/15 font-mono text-[10px] font-semibold text-accent">
          {initials}
        </span>
        <span className="max-w-28 truncate">{nav.user.name.split(" ")[0]}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-50 w-60 animate-rise overflow-hidden rounded-lg border border-line-strong bg-surface p-1 shadow-2xl"
        >
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-medium">{nav.user.name}</p>
            <p className="truncate text-xs text-muted">{nav.user.email}</p>
          </div>
          {(
            [
              ["/dashboard", "Dashboard", "grid"],
              ["/dashboard#submissions", "My submissions", "box"],
              ["/certificates", "Certificates", "file"],
              ["/account", "Settings and API tokens", "settings"],
            ] as [string, string, IconName][]
          ).map(([href, label, icon]) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
            >
              <Icon name={icon} size={14} className="text-muted" />
              {label}
            </Link>
          ))}
          <form action={logout} className="border-t border-line pt-1">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
            >
              <Icon name="logOut" size={14} className="text-muted" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function SiteNav({ nav }: { nav: NavData }) {
  const path = usePathname();
  const palette = usePalette();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const home = path === "/";
  const links = items(nav);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the sheet on navigation
  useEffect(() => setMenu(false), [path]);

  const solid = scrolled || !home || menu;
  return (
    <header
      className={`no-print sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${solid ? "border-b border-line bg-bg/75 backdrop-blur-xl" : "border-b border-transparent"}`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-1.5 focus:text-accent-ink"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Dogfood Judge home" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
          {links.map((l) => {
            const active = isActive(path, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-md px-3 py-1.5 text-[13.5px] transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {l.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-[11px] h-px bg-accent shadow-[0_0_8px_var(--glow)]" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={palette.open}
            className="hidden h-8 items-center gap-2 rounded-md border border-line-strong bg-surface-2/70 pl-2.5 pr-1.5 text-[13px] text-muted transition-colors hover:border-muted/50 hover:text-ink md:flex"
          >
            <Icon name="search" size={14} />
            <span className="w-28 text-left">Search…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <button
            type="button"
            onClick={palette.open}
            aria-label="Open command palette"
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-ink md:hidden"
          >
            <Icon name="search" size={15} />
          </button>
          <ThemeToggle />
          {nav.user ? (
            <div className="hidden lg:block">
              <UserMenu nav={nav} />
            </div>
          ) : (
            <div className="hidden items-center gap-1.5 lg:flex">
              <Link href="/login" className={buttonClass("ghost", "sm")}>
                Sign in
              </Link>
              <Link href="/dashboard" className={buttonClass("accent", "sm")}>
                Open dashboard
                <Icon name="arrowRight" size={13} />
              </Link>
            </div>
          )}
          <button
            type="button"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-surface-hover lg:hidden"
          >
            <Icon name={menu ? "x" : "menu"} size={17} />
          </button>
        </div>
      </div>
      {menu && (
        <nav
          aria-label="Mobile"
          className="max-h-[calc(100dvh-3.5rem)] animate-fade overflow-y-auto border-t border-line bg-bg px-4 pb-8 pt-3 lg:hidden"
        >
          <ul className="grid gap-0.5">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-3 text-[15px] ${isActive(path, l.href) ? "bg-surface-2 text-ink" : "text-ink-2"}`}
                >
                  <Icon name={l.icon} size={16} className="text-muted" />
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="hairline my-4" />
          {nav.user ? (
            <div className="grid gap-0.5">
              <p className="px-3 pb-2 text-xs text-muted">
                Signed in as {nav.user.email}
              </p>
              <Link
                href="/certificates"
                className="flex items-center gap-3 rounded-md px-3 py-3 text-ink-2"
              >
                <Icon name="file" size={16} className="text-muted" />{" "}
                Certificates
              </Link>
              <Link
                href="/account"
                className="flex items-center gap-3 rounded-md px-3 py-3 text-ink-2"
              >
                <Icon name="settings" size={16} className="text-muted" />{" "}
                Settings
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-ink-2"
                >
                  <Icon name="logOut" size={16} className="text-muted" /> Sign
                  out
                </button>
              </form>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link href="/login" className={buttonClass("secondary", "lg")}>
                Sign in
              </Link>
              <Link href="/signup" className={buttonClass("accent", "lg")}>
                Create account
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
