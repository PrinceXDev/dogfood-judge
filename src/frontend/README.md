# Dogfood Judge: frontend

Next.js 16 (App Router), Tailwind CSS 4, Biome. It is a client of the Go API
and nothing more: every page is server-rendered from `/api/v1` calls, and
every form is a server action that forwards the user's session to the API as
a bearer token. It holds no data and makes no authorization decisions.

```
browser ──► Go :8080 ──┬─ /api/*          answered by Go
                       └─ everything else ──► Next.js :3000 ──(server side)──► Go /api/v1
```

## Develop

```bash
# terminal 1, repo root: the API, proxying pages to Next
DOGFOOD_FRONTEND_URL=http://127.0.0.1:3000 go run ./src/cmd/dogfood

# terminal 2, here
npm install
API_URL=http://127.0.0.1:8080 npm run dev -- -p 3000
# open http://localhost:8080
```

## Check

```bash
npm run check   # route types + TypeScript + Biome (lint and format)
npm run build
```

Layout: `app/` routes (one folder per page), `app/actions.ts` (every
mutation), `lib/api.ts` (server-only API client and session), `lib/types.ts`
(the API's JSON shapes), `lib/demo.ts` (shapes of the public engine demo).

- `app/globals.css`: design tokens. Components use semantic classes only
  (`bg-surface`, `text-muted`, `border-line`, `text-accent`…); dark is the
  default theme and `[data-theme="light"]` is designed separately.
- `components/ui.tsx`, `button.ts`, `forms.tsx`, `icons.tsx`, `logo.tsx`,
  `motion.tsx`: the design system (server components unless noted).
- `components/shell/`: nav, footer, organizer sidebar, and the command
  palette, which owns the global shortcuts (⌘K, G + key, J/K through any
  `[data-nav-item]`, `?`).
- `components/viz/`: the judging visualizations (defensibility graph, review
  influence, prize boundary, normalization, score breakdown), shared by the
  landing page (synthetic data) and the results pages (real data).
- `components/landing/`: the landing page. It is driven by
  `GET /api/v1/demo/simulate`, which runs the real engine on a synthetic
  hackathon; Lenis + GSAP ScrollTrigger are loaded only there.

Every number on screen comes from the API. When the API doesn't provide
something, pages say so instead of inventing it.
