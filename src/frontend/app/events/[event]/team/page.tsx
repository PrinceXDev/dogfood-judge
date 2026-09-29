import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  createTeam,
  leaveTeam,
  rotateInvite,
  saveSubmission,
} from "@/app/actions";
import { Countdown } from "@/components/account/countdown";
import { buttonClass } from "@/components/button";
import { ActionForm, CopyField, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { ProjectLinks } from "@/components/project/links";
import {
  BackLink,
  Callout,
  Field,
  inputCls,
  Page,
  PageHeader,
  Panel,
  Problem,
  Tag,
} from "@/components/ui";
import { ApiError, api, load, requireMe, rolesIn } from "@/lib/api";
import { submissionsOpen, when } from "@/lib/format";
import type { Event, Project, Team } from "@/lib/types";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({
  params,
}: PageProps<"/events/[event]/team">) {
  const { event } = await params;
  const me = await requireMe(`/events/${event}/team`);
  const r = await load<Event>(`/events/${event}`, `/events/${event}/team`);
  if (!r.ok) return <Problem error={r.error} />;
  const e = r.data;
  const roles = rolesIn(me, e.id);
  const team = await api<Team>(`/events/${e.id}/team`).catch((err) => {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  });
  const open = submissionsOpen(e);
  const closed = Date.now() >= new Date(e.submissions_close_at).getTime();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;

  const back = <BackLink href={`/events/${e.slug}`}>{e.name}</BackLink>;

  if (!team) {
    return (
      <Page width="narrow">
        {back}
        <PageHeader
          eyebrow="Team workspace"
          title={<>Join {e.name}</>}
          sub={
            !roles.judge &&
            !closed &&
            `Create a team, then share its invite link with up to ${e.max_team_size - 1} teammates. Got a link from a teammate? Open it to join their team.`
          }
        />
        {roles.judge ? (
          <Callout tone="warn" title="You judge this event">
            Judges cannot join a team in an event they score.
          </Callout>
        ) : closed ? (
          <Callout tone="warn" title="Teams are locked">
            Submissions closed {when(e.submissions_close_at)}.
          </Callout>
        ) : (
          <Panel title="New team" icon="users" bodyClass="p-5">
            <ActionForm
              action={createTeam}
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="event" value={e.id} />
              <div className="min-w-0 flex-1 basis-56">
                <Field label="Team name">
                  <input
                    name="name"
                    maxLength={60}
                    required
                    className={inputCls}
                  />
                </Field>
              </div>
              <Submit variant="accent">Create team</Submit>
            </ActionForm>
          </Panel>
        )}
      </Page>
    );
  }

  const p = team.project;
  const members = team.members ?? [];
  const submitted = p?.status === "submitted";

  return (
    <Page>
      {back}
      <PageHeader
        eyebrow="Team workspace"
        title={team.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {submitted ? (
              <Tag tone="good" dot>
                submitted
              </Tag>
            ) : p ? (
              <Tag tone="warn" dot>
                draft, not submitted
              </Tag>
            ) : (
              <Tag dot>no project yet</Tag>
            )}
            {closed && (
              <Tag>
                <Icon name="lock" size={11} />
                locked
              </Tag>
            )}
            <span className="font-mono text-xs text-muted">{team.id}</span>
          </span>
        }
        actions={
          p && (
            <Link href={`/p/${p.id}`} className={buttonClass("secondary")}>
              View project
              <Icon name="arrowUpRight" size={14} />
            </Link>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-6">
          <StatusStrip e={e} p={p} open={open} closed={closed} />

          {open ? (
            <Panel title="Submission" icon="file" bodyClass="p-5 sm:p-6">
              <ActionForm action={saveSubmission} className="grid gap-5">
                <input type="hidden" name="event" value={e.id} />
                {p && <input type="hidden" name="project_id" value={p.id} />}
                <Field label="Title">
                  <input
                    name="title"
                    maxLength={120}
                    required
                    defaultValue={p?.title}
                    className={`${inputCls} text-base font-medium`}
                  />
                </Field>
                <Field label="One-line summary" hint="Up to 280 characters.">
                  <input
                    name="summary"
                    maxLength={280}
                    defaultValue={p?.summary}
                    className={inputCls}
                  />
                </Field>
                {!!e.tracks?.length && (
                  <Field label="Track">
                    <select
                      name="track_id"
                      defaultValue={p?.track_id ?? ""}
                      className={inputCls}
                    >
                      <option value="">Choose a track</option>
                      {e.tracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Description">
                  <textarea
                    name="description"
                    rows={8}
                    maxLength={20000}
                    defaultValue={p?.description}
                    className={`${inputCls} leading-relaxed`}
                  />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Repository URL">
                    <input
                      type="url"
                      name="repo_url"
                      placeholder="https://"
                      defaultValue={p?.repo_url}
                      className={`${inputCls} font-mono text-[13px]`}
                    />
                  </Field>
                  <Field label="Demo URL">
                    <input
                      type="url"
                      name="demo_url"
                      placeholder="https://"
                      defaultValue={p?.demo_url}
                      className={`${inputCls} font-mono text-[13px]`}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
                  <Submit variant="secondary" name="intent" value="draft">
                    Save draft
                  </Submit>
                  <Submit variant="accent" name="intent" value="submit">
                    {!p || p.status === "draft" ? "Submit" : "Save changes"}
                  </Submit>
                  <p className="basis-full text-xs leading-relaxed text-muted sm:basis-auto sm:flex-1 sm:text-right">
                    Editable until the deadline, even after submitting.
                  </p>
                </div>
                <p className="flex gap-2 text-xs leading-relaxed text-muted">
                  <Icon name="lock" size={13} className="mt-px shrink-0" />
                  After the deadline the server, and the database itself, refuse
                  every change.
                </p>
              </ActionForm>
            </Panel>
          ) : p ? (
            <LockedProject e={e} p={p} closed={closed} />
          ) : (
            <Panel title="Submission" icon="file" bodyClass="p-5">
              <p className="text-sm text-ink-2">
                {closed
                  ? "Submissions closed before this team saved a project."
                  : `Submissions are not open yet. They open ${when(e.submissions_open_at)}.`}
              </p>
            </Panel>
          )}
        </div>

        <aside className="grid content-start gap-6">
          <Panel
            title="Members"
            icon="users"
            aside={
              <span className="font-mono tabular">
                <span className="text-ink">{members.length}</span>/
                {e.max_team_size}
              </span>
            }
            bodyClass="p-0"
          >
            <div aria-hidden="true" className="flex gap-1 px-4 pt-4">
              {Array.from({ length: e.max_team_size }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: one slot per seat
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i < members.length ? "bg-accent" : "bg-line"}`}
                />
              ))}
            </div>
            <ul className="divide-y divide-line px-4 py-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/15 font-mono text-[11px] font-medium uppercase text-accent"
                  >
                    {m.name.charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm text-ink">
                      {m.name}
                      {m.id === me.user.id && <Tag>you</Tag>}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted">
                      {m.email}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          {open && team.invite_token && (
            <Panel title="Invite link" icon="copy" bodyClass="p-4">
              <p className="mb-3 text-[13px] text-ink-2">
                Anyone with this link can join while seats and submissions are
                open.
              </p>
              <CopyField value={`${origin}/join/${team.invite_token}`} />
              <ActionForm
                action={rotateInvite}
                confirm="The old link will stop working. Continue?"
                className="mt-3"
              >
                <input type="hidden" name="event" value={e.id} />
                <Submit size="sm" variant="ghost">
                  <Icon name="split" size={13} />
                  Replace link
                </Submit>
              </ActionForm>
            </Panel>
          )}

          {open && (
            <ActionForm action={leaveTeam} confirm="Leave this team?">
              <input type="hidden" name="event" value={e.id} />
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
                <p className="text-[13px] text-muted">
                  Leaving frees your seat.
                </p>
                <Submit size="sm" variant="danger">
                  Leave team
                </Submit>
              </div>
            </ActionForm>
          )}
        </aside>
      </div>
    </Page>
  );
}

function StatusStrip({
  e,
  p,
  open,
  closed,
}: {
  e: Event;
  p?: Project;
  open: boolean;
  closed: boolean;
}) {
  const steps: { label: string; done: boolean; detail?: ReactNode }[] = [
    { label: "Team formed", done: true },
    { label: "Draft saved", done: !!p },
    {
      label: "Submitted",
      done: p?.status === "submitted",
      detail: p?.submitted_at ? (
        <span className="font-mono">{when(p.submitted_at)}</span>
      ) : undefined,
    },
    { label: "Locked", done: closed },
  ];
  return (
    <section
      aria-label="Submission status"
      className="overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow)]"
    >
      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {open ? "Deadline in" : closed ? "Submissions closed" : "Opens"}
          </p>
          <div className="mt-1">
            {open ? (
              <Countdown to={e.submissions_close_at} />
            ) : (
              <span className="flex items-center gap-2 font-mono text-2xl font-medium tracking-tight text-ink-2">
                <Icon name={closed ? "lock" : "clock"} size={18} />
                {closed ? "Locked" : "Soon"}
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-muted">
            <time
              dateTime={
                open || closed ? e.submissions_close_at : e.submissions_open_at
              }
            >
              {when(
                open || closed ? e.submissions_close_at : e.submissions_open_at,
              )}
            </time>
          </p>
        </div>
        <ol className="flex flex-wrap gap-x-5 gap-y-2 sm:justify-end">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-[13px]">
              <span
                className={`grid size-5 place-items-center rounded-full border ${s.done ? "border-accent/40 bg-accent/15 text-accent" : "border-line-strong text-muted"}`}
              >
                {s.done ? (
                  <Icon name="check" size={11} />
                ) : (
                  <span className="size-1 rounded-full bg-current" />
                )}
              </span>
              <span className={s.done ? "text-ink" : "text-muted"}>
                {s.label}
                <span className="sr-only">
                  {s.done ? " (done)" : " (not yet)"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function LockedProject({
  e,
  p,
  closed,
}: {
  e: Event;
  p: Project;
  closed: boolean;
}) {
  return (
    <Panel
      title="Submission"
      icon="lock"
      aside={<span>Read-only</span>}
      bodyClass="p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">
            <Link href={`/p/${p.id}`} className="hover:text-accent">
              {p.title}
            </Link>
          </h2>
          {p.summary && (
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              {p.summary}
            </p>
          )}
        </div>
        {p.track_name && <Tag tone="info">{p.track_name}</Tag>}
      </div>
      {(p.repo_url || p.demo_url) && (
        <div className="mt-4">
          <ProjectLinks p={p} empty={false} />
        </div>
      )}
      <Callout
        tone="neutral"
        title="Submissions are closed; the project is locked."
      >
        The deadline passed {when(e.submissions_close_at)}. The server and the
        database refuse every change from here on.
      </Callout>
      {p.status === "submitted" && closed ? (
        <Link
          href={`/events/${e.slug}/certificate`}
          className="glow-edge group flex items-center gap-3 rounded-lg border border-accent/25 bg-accent/[0.06] px-4 py-3 transition-colors hover:border-accent/50"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-md border border-accent/30 bg-surface text-accent">
            <Icon name="shieldCheck" size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">
              Your signed participation certificate
            </span>
            <span className="block text-xs text-ink-2">
              Ed25519-signed, verifiable offline.
            </span>
          </span>
          <Icon
            name="arrowRight"
            size={15}
            className="text-accent transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ) : (
        p.status !== "submitted" && (
          <p className="text-sm text-warn">
            This project was saved as a draft and never submitted.
          </p>
        )
      )}
    </Panel>
  );
}
