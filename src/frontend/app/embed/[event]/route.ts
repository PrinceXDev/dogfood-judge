import { ApiError, api } from "@/lib/api";
import type { Event, GalleryPage } from "@/lib/types";

// The embeddable gallery widget: <iframe src="https://portal/embed/evt_01">.
// A route handler rather than a page so it ships none of the site chrome or
// JavaScript, just a small self-contained HTML document.

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

// Brand tokens mirror app/globals.css; the widget follows the host page's
// colour scheme rather than the portal's theme toggle.
const CSS = [
  ":root{--bg:transparent;--surface:#fff;--line:#e2e6e1;--line2:#cdd3cc;--ink:#0a100e;--ink2:#3b4643;--muted:#6a7470;--accent:#00987a;--soft:rgb(0 152 122/.08)}",
  "@media (prefers-color-scheme:dark){:root{--surface:#0b0e0e;--line:#1b2121;--line2:#2a3232;--ink:#e8efec;--ink2:#a9b4b0;--muted:#6c7774;--accent:#3cf2c0;--soft:rgb(60 242 192/.08)}}",
  "*{box-sizing:border-box}body{margin:0;padding:4px;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);background:var(--bg)}",
  ".mono,.k,.m,.f,.t{font-family:ui-monospace,'SF Mono',Consolas,monospace}",
  ".h{display:flex;align-items:center;gap:8px;padding:2px 2px 10px}.h svg{flex:none}.n{color:var(--ink);font-weight:600;letter-spacing:-.01em;text-decoration:none}.n:hover{color:var(--accent)}.k{margin-left:auto;font-size:11px;color:var(--muted)}",
  ".g{list-style:none;margin:0;padding:0;display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}",
  ".c{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--surface);transition:border-color .15s}.c:hover{border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}",
  ".c a{display:flex;justify-content:space-between;gap:8px;color:var(--ink);font-weight:600;letter-spacing:-.01em;text-decoration:none}.c a:hover{color:var(--accent)}.c a:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:3px}.ar{color:var(--muted);font-weight:400}",
  ".m{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;font-size:11px;color:var(--muted)}.t{border:1px solid var(--line2);border-radius:99px;padding:0 6px;color:var(--ink2)}",
  ".f{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;padding:10px 2px 2px;font-size:11px;color:var(--muted)}.f a{color:var(--accent);text-decoration:none}.f a:hover{text-decoration:underline}.b{letter-spacing:.08em;text-transform:uppercase}",
  "@media (prefers-reduced-motion:reduce){.c{transition:none}}",
].join("");

// A static copy of components/logo.tsx's mark (no hover bite: no JS here).
const MARK = `<svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true"><defs><mask id="b"><rect width="32" height="32" fill="#fff"/><circle cx="25.6" cy="3.1" r="3.3"/><circle cx="29.2" cy="6.4" r="3.3"/><circle cx="29.9" cy="11.3" r="3.1"/><circle cx="11" cy="7.4" r="1.7"/></mask></defs><rect x="4" y="2" width="24" height="28" rx="7.5" fill="var(--accent)" mask="url(#b)"/><path d="M10 18.6 L14.3 22.6 L22 13.6" fill="none" stroke="var(--surface)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><g fill="var(--surface)"><circle cx="10" cy="18.6" r="1.9"/><circle cx="14.3" cy="22.6" r="1.9"/><circle cx="22" cy="13.6" r="1.9"/></g></svg>`;

export async function GET(req: Request, ctx: RouteContext<"/embed/[event]">) {
  const { event } = await ctx.params;
  const url = new URL(req.url);
  const base = `${req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
  try {
    const e = await api<Event>(`/events/${encodeURIComponent(event)}`, {
      token: null,
    });
    const q = new URLSearchParams();
    for (const k of ["q", "track"]) {
      const v = url.searchParams.get(k);
      if (v) q.set(k, v);
    }
    const page = await api<GalleryPage>(`/events/${e.id}/projects?${q}`, {
      token: null,
    });
    const cards = (page.projects ?? [])
      .map(
        (p) =>
          `<li class="c"><a href="${base}/p/${esc(p.id)}" target="_blank" rel="noopener">${esc(p.title)}<span class="ar" aria-hidden="true">&#8599;</span></a><div class="m"><span>${esc(p.team_name)}</span>${p.track_name ? `<span class="t">${esc(p.track_name)}</span>` : ""}</div></li>`,
      )
      .join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(e.name)} projects</title>
<style>${CSS}</style>
</head><body><header class="h">${MARK}<a class="n" href="${base}/events/${esc(e.slug)}" target="_blank" rel="noopener">${esc(e.name)}</a><span class="k">${page.total} projects</span></header><ul class="g">${cards}</ul><footer class="f"><span>${page.total} projects from <a href="${base}/events/${esc(e.slug)}" target="_blank" rel="noopener">${esc(e.name)}</a></span><span class="b">judged on dogfood</span></footer></body></html>`;
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return new Response("Event not found", {
      status: status === 404 ? 404 : 500,
    });
  }
}
