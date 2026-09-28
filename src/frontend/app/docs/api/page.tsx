import type { Metadata } from "next";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { CodeBlock } from "@/components/docs/code-block";
import { Icon } from "@/components/icons";
import { Kbd, Page, Tag } from "@/components/ui";

export const metadata: Metadata = { title: "API" };

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "auth", label: "Authentication" },
  { id: "examples", label: "Examples" },
  { id: "public", label: "Public endpoints" },
  { id: "errors", label: "Errors" },
  { id: "webhooks", label: "Webhooks" },
  { id: "reference", label: "Reference" },
];

// Tags in src/web/static/openapi.yaml, in document order.
const GROUPS = [
  "auth",
  "events",
  "projects",
  "teams",
  "judging",
  "results",
  "voting",
  "portability",
];

const ERRORS: [number, string][] = [
  [400, "The request is malformed or fails validation."],
  [401, "No valid session or bearer token."],
  [403, "Authenticated, but your roles don't allow it."],
  [404, "The resource doesn't exist, or you can't see it."],
  [409, "Conflicts with current state, e.g. submissions closed."],
  [429, "Rate limited. Back off and retry."],
];

const code = (s: string) => (
  <code className="rounded border border-line bg-surface-2 px-1 py-px font-mono text-[12.5px] text-ink">
    {s}
  </code>
);

function Doc({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-line py-10 first:border-t-0 first:pt-0"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
        {kicker}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
        {title}
      </h2>
      <div className="mt-4 grid gap-3 text-[15px] leading-relaxed text-ink-2">
        {children}
      </div>
    </section>
  );
}

function Endpoint({
  method,
  path,
  children,
}: {
  method: string;
  path: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
        <span className="rounded border border-good/30 bg-good/10 px-1.5 py-px text-[11px] font-medium text-good">
          {method}
        </span>
        <span className="text-ink">{path}</span>
        <Tag className="ml-auto">no auth</Tag>
      </p>
      <div className="mt-2.5 grid gap-2 text-sm leading-relaxed text-ink-2">
        {children}
      </div>
    </div>
  );
}

export default function ApiDocs() {
  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_200px]">
        <nav
          aria-label="On this page"
          className="lg:sticky lg:top-24 lg:self-start"
        >
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            JSON API · v1
          </p>
          <ul className="flex gap-1 overflow-x-auto border-line lg:flex-col lg:border-l">
            {TOC.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  data-nav-item
                  className="-ml-px block whitespace-nowrap rounded-md border-transparent px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink lg:rounded-none lg:border-l lg:hover:border-accent"
                >
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="min-w-0 max-w-3xl">
          <header className="mb-10 animate-rise">
            <p className="flex items-center gap-2 font-mono text-xs text-muted">
              <Icon name="terminal" size={14} className="text-accent" />
              /api/v1
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">
              JSON API
            </h1>
            <p className="mt-3 text-pretty text-[15px] leading-relaxed text-ink-2">
              This interface is itself a client of the API: every page action is
              an HTTP call to {code("/api/v1")}. The full description is an
              OpenAPI 3.1 document.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href="/api/v1/openapi.yaml" className={buttonClass("accent")}>
                <Icon name="file" size={14} />
                openapi.yaml
              </a>
              <a href="#examples" className={buttonClass("secondary")}>
                Examples
              </a>
            </div>
          </header>

          <Doc id="overview" kicker="01" title="Overview">
            <p>
              The pages and the API call the same service layer, so
              authorization is identical in both. {code("{event}")} accepts an
              event id ({code("evt_01")}) or slug ({code("sample-hack-2026")}).
              Timestamps are RFC 3339 in UTC. Empty lists may arrive as{" "}
              {code("null")}.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {GROUPS.map((g) => (
                <li key={g}>
                  <Tag>{g}</Tag>
                </li>
              ))}
            </ul>
          </Doc>

          <Doc id="auth" kicker="02" title="Authentication">
            <p>
              Sign in for a session token, or create a long-lived API token on
              your{" "}
              <a href="/account#tokens" className="text-accent hover:underline">
                account page
              </a>
              . Send either as a bearer header.
            </p>
            <CodeBlock
              title="sign in"
              code={`curl -s -X POST localhost:8080/api/v1/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"organizer@dogfood.local","password":"dogfood-demo"}'
# → {"token": "…"}; then send  Authorization: Bearer <token>`}
            />
            <p className="text-sm">
              Cookie sessions also work; state-changing cookie requests must
              send {code("X-CSRF-Token")}.
            </p>
          </Doc>

          <Doc id="examples" kicker="03" title="Examples">
            <CodeBlock
              title="public gallery"
              code={`curl -s 'localhost:8080/api/v1/events/evt_01/projects?q=signal'`}
            />
            <CodeBlock
              title="judges and scores"
              code={`# your own scores (judge)
curl -s localhost:8080/api/v1/judge/scores -H "Authorization: Bearer $TOKEN"

# another judge's scores: 403 unless you organize that event
curl -si 'localhost:8080/api/v1/judge/scores?judge=jdg_26' -H "Authorization: Bearer $OTHER_JUDGE"`}
            />
            <CodeBlock
              title="results"
              code={`# normalized results with robustness and outliers (organizer)
curl -s localhost:8080/api/v1/events/evt_01/results -H "Authorization: Bearer $TOKEN"

# reproducible, signed results (public once published)
curl -s -o bundle.json localhost:8080/api/v1/events/evt_01/results/bundle
dogfood verify-results bundle.json --key "$(curl -s localhost:8080/.well-known/dogfood-signing-key | jq -r .public_key)"`}
            />
            <CodeBlock
              title="portability"
              code={`# export everything, import it elsewhere
curl -s localhost:8080/api/v1/events/evt_01/export.json -H "Authorization: Bearer $TOKEN" > event.json
curl -s -X POST otherhost:8080/api/v1/import -H "Authorization: Bearer $ADMIN" --data-binary @event.json`}
            />
          </Doc>

          <Doc id="public" kicker="04" title="Public endpoints">
            <p>
              Two read-only endpoints power the landing page. Neither exposes
              event data beyond aggregate counts.
            </p>
            <Endpoint method="GET" path="/api/v1/stats">
              <p>
                Instance-wide counts over public events: {code("events")},{" "}
                {code("projects")}, {code("judges")}, {code("reviews")},{" "}
                {code("comparisons")}, {code("audit_entries")}. No scores or
                names.
              </p>
            </Endpoint>
            <CodeBlock
              title="stats"
              code="curl -s localhost:8080/api/v1/stats"
            />
            <Endpoint method="GET" path="/api/v1/demo/simulate">
              <p>
                Runs the real judging engine on one synthetic hackathon. Returns{" "}
                {code("config")}, the ground {code("truth")}, the generated{" "}
                {code("judges")} and {code("reviews")}, the full analysis{" "}
                {code("report")}, and its {code("accuracy")} against the truth
                (raw versus adjusted Kendall τ, top-k hits and winner).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Param</th>
                      <th className="py-1.5 pr-4 font-medium">Default</th>
                      <th className="py-1.5 font-medium">Meaning</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:border-t [&_td]:border-line [&_td]:py-1.5 [&_td]:pr-4">
                    {(
                      [
                        ["projects", "24", "Projects, clamped 6–40"],
                        ["judges", "8", "Judges, clamped 3–16"],
                        ["coverage", "3", "Reviews per project, clamped 2–6"],
                        [
                          "leniency",
                          "0.5",
                          "SD of judge leniency in scale points",
                        ],
                        ["scale", "0.35", "Log-normal SD of judge scale use"],
                        ["noise", "0.6", "Per-criterion noise SD"],
                        ["seed", "0", "Random seed"],
                      ] as const
                    ).map(([k, d, m]) => (
                      <tr key={k}>
                        <td className="font-mono text-ink">{k}</td>
                        <td className="font-mono tabular">{d}</td>
                        <td>{m}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">
                Results are cached per parameter set; uncached fits are rate
                limited and may return 429.
              </p>
            </Endpoint>
            <CodeBlock
              title="simulate"
              code={`curl -s 'localhost:8080/api/v1/demo/simulate?projects=24&judges=8&coverage=3&seed=7' | jq .accuracy`}
            />
          </Doc>

          <Doc id="errors" kicker="05" title="Errors">
            <p>Errors are JSON with a stable, machine-readable code:</p>
            <CodeBlock
              title="error body"
              lang="json"
              code={`{"error": {"code": "submissions_closed", "message": "…"}}`}
            />
            <dl className="overflow-hidden rounded-lg border border-line bg-surface text-sm">
              {ERRORS.map(([s, m]) => (
                <div
                  key={s}
                  className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 border-t border-line px-4 py-2.5 first:border-t-0"
                >
                  <dt
                    className={`font-mono tabular ${s === 429 || s === 409 ? "text-warn" : "text-bad"}`}
                  >
                    {s}
                  </dt>
                  <dd className="text-ink-2">{m}</dd>
                </div>
              ))}
            </dl>
          </Doc>

          <Doc id="webhooks" kicker="06" title="Webhooks">
            <p>
              Organizers register URLs per event (Settings → Webhooks) for the
              topics {code("project.submitted")}, {code("review.submitted")},{" "}
              {code("results.published")} or {code("*")}. Deliveries are POSTed
              as JSON {code("{topic, event_id, at, data}")}, retried with
              exponential backoff up to 8 attempts.
            </p>
            <p>
              Each delivery carries{" "}
              {code("X-Dogfood-Signature: sha256=<HMAC of body>")}, a hex
              HMAC-SHA256 of the raw body with the webhook's secret. Compare it
              in constant time before trusting the payload.
            </p>
            <CodeBlock
              title="verify a delivery"
              code={`# expected value of X-Dogfood-Signature, minus the "sha256=" prefix
printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex`}
            />
          </Doc>

          <Doc id="reference" kicker="07" title="Reference">
            <p>
              Every endpoint, schema and error response is in the OpenAPI
              document. Load it into any OpenAPI tool, or read it raw.
            </p>
            <a
              href="/api/v1/openapi.yaml"
              className="glow-edge group flex items-center gap-4 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-md border border-line-strong bg-surface-2 text-accent">
                <Icon name="file" size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm text-ink">
                  /api/v1/openapi.yaml
                </span>
                <span className="block text-[13px] text-muted">
                  OpenAPI 3.1 · MIT
                </span>
              </span>
              <Icon
                name="arrowUpRight"
                size={16}
                className="text-muted transition-colors group-hover:text-accent"
              />
            </a>
          </Doc>
        </article>

        <aside className="hidden xl:block">
          <div className="sticky top-24 rounded-lg border border-line bg-surface p-4 text-[13px]">
            <p className="font-medium text-ink">Base URL</p>
            <p className="mt-1 break-all font-mono text-xs text-ink-2">
              http://localhost:8080/api/v1
            </p>
            <p className="mt-4 font-medium text-ink">Auth header</p>
            <p className="mt-1 break-all font-mono text-xs text-ink-2">
              Authorization: Bearer &lt;token&gt;
            </p>
            <p className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              Jump anywhere with <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </p>
          </div>
        </aside>
      </div>
    </Page>
  );
}
