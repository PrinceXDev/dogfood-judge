import {
  addPrize,
  addTrack,
  createWebhook,
  deleteWebhook,
  grantExtension,
  saveRubric,
  updateEvent,
} from "@/app/actions";
import { EventForm } from "@/components/event-form";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { RubricWeights } from "@/components/settings/rubric-weights";
import {
  Callout,
  Card,
  EmptyState,
  Field,
  inputCls,
  num,
  PageHeader,
  Panel,
  Problem,
  Section,
  StatusDot,
  Table,
  Tag,
  type Tone,
} from "@/components/ui";
import { api, load, requireMe } from "@/lib/api";
import { ago, when } from "@/lib/format";
import type { Delivery, Event, Project, Webhook } from "@/lib/types";

const TOPICS = ["project.submitted", "review.submitted", "results.published"];

const JUMP: [string, string][] = [
  ["#event", "Event"],
  ["#rubric", "Rubric"],
  ["#tracks", "Tracks & prizes"],
  ["#extensions", "Extensions"],
  ["#webhooks", "Webhooks"],
];

function deliveryTone(s: string): Tone {
  if (s === "delivered") return "good";
  if (s === "failed") return "bad";
  if (s === "pending") return "warn";
  return "neutral";
}

export default async function Settings({
  params,
  searchParams,
}: PageProps<"/organize/[event]/settings">) {
  const { event } = await params;
  const here = `/organize/${event}/settings`;
  await requireMe(here);
  const er = await load<Event>(`/events/${event}`, here);
  if (!er.ok) return <Problem error={er.error} />;
  const e = er.data;
  const pr = await load<Project[]>(`/events/${e.id}/all-projects`, here);
  if (!pr.ok) return <Problem error={pr.error} />;
  const [hooks, deliveries] = await Promise.all([
    api<Webhook[] | null>(`/events/${e.id}/webhooks`),
    api<Delivery[] | null>(`/events/${e.id}/webhooks/deliveries`),
  ]);
  const teams = [
    ...new Map(pr.data.map((p) => [p.team_id, p.team_name])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const saved = (await searchParams).saved;
  const tracks = e.tracks ?? [];
  const prizes = e.prizes ?? [];
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const hookUrl = new Map((hooks ?? []).map((h) => [h.id, h.url]));

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Event configuration"
        sub="Timeline, capacities, rubric and integrations. Changes take effect immediately and are recorded in the audit trail."
      />
      <nav
        aria-label="Settings sections"
        className="-mt-2 mb-8 flex flex-wrap gap-1.5"
      >
        {JUMP.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="inline-flex h-7 items-center rounded-full border border-line-strong bg-surface px-2.5 text-[12.5px] text-ink-2 transition-colors hover:border-muted/50 hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>

      {saved && (
        <Callout tone="good" title="Saved.">
          The change is live and written to the audit trail.
        </Callout>
      )}

      <Section title="Event" eyebrow="General" id="event">
        <Card className="sm:p-6">
          <EventForm action={updateEvent} event={e} />
        </Card>
      </Section>

      <Section
        title="Rubric"
        eyebrow="Scoring"
        id="rubric"
        desc="Weights set how much each criterion contributes. The bars show each one's normalized share."
      >
        <ActionForm action={saveRubric} className="grid gap-4">
          <input type="hidden" name="event" value={e.id} />
          <RubricWeights criteria={e.criteria ?? []} />
          <p className="rounded-md border border-line bg-sunken/60 px-3 py-2 text-xs text-muted">
            A review&apos;s weighted score is{" "}
            <span className="font-mono text-ink-2">
              Σ(weight × score) / Σ weight
            </span>
            . Re-weighting recomputes every result; raw scores never change.
          </p>
          <div>
            <Submit>Save rubric</Submit>
          </div>
        </ActionForm>
      </Section>

      <Section title="Tracks & prizes" eyebrow="Structure" id="tracks">
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel
            title="Tracks"
            icon="layers"
            aside={<span className="font-mono tabular">{tracks.length}</span>}
          >
            {tracks.length ? (
              <ul className="mb-4 flex flex-wrap gap-1.5">
                {tracks.map((t) => (
                  <li key={t.id}>
                    <Tag>{t.name}</Tag>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">
                No tracks: every project competes overall.
              </p>
            )}
            <ActionForm action={addTrack} className="grid gap-2">
              <input type="hidden" name="event" value={e.id} />
              <div className="flex gap-2">
                <input
                  name="name"
                  required
                  placeholder="New track"
                  aria-label="New track name"
                  className={inputCls}
                />
                <Submit size="md" variant="secondary">
                  <Icon name="plus" size={13} />
                  Add
                </Submit>
              </div>
            </ActionForm>
          </Panel>

          <Panel
            title="Prizes"
            icon="trophy"
            aside={<span className="font-mono tabular">{prizes.length}</span>}
          >
            {prizes.length ? (
              <ul className="mb-4 divide-y divide-line rounded-md border border-line">
                {prizes.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-muted">
                        {p.track_id
                          ? (trackName.get(p.track_id) ?? p.track_id)
                          : "Overall"}
                      </span>
                    </span>
                    {p.value && (
                      <span className="shrink-0 font-mono text-xs text-accent">
                        {p.value}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">No prizes yet.</p>
            )}
            <ActionForm action={addPrize} className="grid gap-2">
              <input type="hidden" name="event" value={e.id} />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  name="name"
                  required
                  placeholder="Prize name"
                  aria-label="Prize name"
                  className={inputCls}
                />
                <input
                  name="value"
                  placeholder="Value, e.g. 500 USD"
                  aria-label="Prize value"
                  className={inputCls}
                />
              </div>
              <select
                name="track_id"
                aria-label="Prize track"
                className={inputCls}
              >
                <option value="">Overall</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <div>
                <Submit size="sm" variant="secondary">
                  <Icon name="plus" size={13} />
                  Add prize
                </Submit>
              </div>
            </ActionForm>
          </Panel>
        </div>
      </Section>

      <Section
        title="Deadline extension"
        eyebrow="Exceptions"
        id="extensions"
        desc="Give one team more time (accessibility needs, outages). Enforced by the database and audited."
      >
        <Card className="max-w-2xl">
          {teams.length ? (
            <ActionForm action={grantExtension} className="grid gap-3">
              <input type="hidden" name="event" value={e.id} />
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <Field label="Team">
                  <select name="team" required className={inputCls}>
                    {teams.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Minutes" hint="max 10080">
                  <input
                    type="number"
                    name="minutes"
                    defaultValue={60}
                    min={1}
                    max={10080}
                    className={`${inputCls} font-mono tabular`}
                  />
                </Field>
              </div>
              <Field label="Reason">
                <input name="reason" required className={inputCls} />
              </Field>
              <div>
                <Submit size="sm">
                  <Icon name="clock" size={13} />
                  Grant extension
                </Submit>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">
              No teams have a project yet, so there is no one to extend.
            </p>
          )}
        </Card>
      </Section>

      <Section
        title="Webhooks"
        eyebrow="Integrations"
        id="webhooks"
        desc={
          <>
            Deliveries carry{" "}
            <code className="font-mono text-xs text-ink">
              X-Dogfood-Signature: sha256=HMAC(secret, body)
            </code>{" "}
            and retry with backoff up to 8 times.
          </>
        }
      >
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-2">
            {(hooks ?? []).map((h) => (
              <ActionForm
                key={h.id}
                action={deleteWebhook}
                className="grid gap-2 rounded-lg border border-line bg-surface px-4 py-3"
              >
                <input type="hidden" name="event" value={e.id} />
                <input type="hidden" name="id" value={h.id} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <StatusDot
                        tone={h.active ? "good" : "neutral"}
                        label={h.active ? "active" : "inactive"}
                      />
                      <span
                        className="truncate font-mono text-sm"
                        title={h.url}
                      >
                        {h.url}
                      </span>
                    </p>
                    <p className="mt-2 flex flex-wrap gap-1">
                      {h.topics.map((t) => (
                        <span
                          key={t}
                          className="rounded border border-line-strong bg-surface-2 px-1.5 font-mono text-[10.5px] text-ink-2"
                        >
                          {t}
                        </span>
                      ))}
                    </p>
                    <p className="mt-1.5 text-xs text-muted">
                      {h.active ? "Active" : "Inactive"} · added{" "}
                      <time dateTime={h.created_at} title={when(h.created_at)}>
                        {ago(h.created_at)}
                      </time>
                    </p>
                  </div>
                  <Submit size="sm" variant="ghost">
                    Remove
                  </Submit>
                </div>
              </ActionForm>
            ))}
            {!hooks?.length && (
              <EmptyState icon="terminal" title="No webhooks yet.">
                Add an endpoint to be notified when projects are submitted,
                reviews come in, or results are published.
              </EmptyState>
            )}
          </div>

          <Panel title="Add a webhook" icon="plus">
            <ActionForm action={createWebhook} className="grid gap-3">
              <input type="hidden" name="event" value={e.id} />
              <Field label="URL">
                <input
                  type="url"
                  name="url"
                  required
                  placeholder="http://localhost:9000/hook"
                  className={`${inputCls} font-mono`}
                />
              </Field>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-[13px] font-medium">
                  Topics
                </legend>
                {TOPICS.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="topics"
                      value={t}
                      defaultChecked
                      className="size-4 accent-[var(--accent)]"
                    />
                    <span className="font-mono text-xs text-ink-2">{t}</span>
                  </label>
                ))}
              </fieldset>
              <div>
                <Submit variant="secondary" size="sm">
                  Add webhook
                </Submit>
              </div>
            </ActionForm>
          </Panel>
        </div>

        <h3 className="mt-8 mb-3 text-sm font-semibold">Recent deliveries</h3>
        {deliveries?.length ? (
          <Table>
            <thead>
              <tr>
                <th>Topic</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th className={num}>Attempts</th>
                <th>When</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono text-xs">{d.topic}</td>
                  <td
                    className="max-w-48 truncate font-mono text-xs text-muted"
                    title={hookUrl.get(d.webhook_id) ?? d.webhook_id}
                  >
                    {hookUrl.get(d.webhook_id) ?? d.webhook_id}
                  </td>
                  <td>
                    <Tag tone={deliveryTone(d.status)} dot>
                      {d.status}
                    </Tag>
                  </td>
                  <td className={num}>{d.attempts}</td>
                  <td className="whitespace-nowrap text-xs text-muted">
                    <time dateTime={d.created_at} title={when(d.created_at)}>
                      {ago(d.created_at)}
                    </time>
                  </td>
                  <td
                    className="max-w-64 truncate font-mono text-xs text-bad"
                    title={d.last_error}
                  >
                    {d.last_error}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="rounded-md border border-dashed border-line-strong px-4 py-3 text-sm text-muted">
            Nothing delivered yet.
          </p>
        )}
      </Section>
    </>
  );
}
