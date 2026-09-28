import type { Metadata } from "next";
import Link from "next/link";
import { recuse } from "@/app/actions";
import { buttonClass } from "@/components/button";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { RubricForm } from "@/components/judge/rubric-form";
import {
  Bar,
  Callout,
  Eyebrow,
  Field,
  Hash,
  inputCls,
  Problem,
  StatusDot,
  Tag,
} from "@/components/ui";
import { load, requireMe } from "@/lib/api";
import { ago, f2, judgingOpen, percent, when } from "@/lib/format";
import type { Assignment, Event } from "@/lib/types";

export const metadata: Metadata = { title: "Review" };

const statusTone = {
  pending: "warn",
  done: "good",
  recused: "neutral",
} as const;
const statusLabel = {
  pending: "to review",
  done: "reviewed",
  recused: "declined",
} as const;

function AssignmentNav({
  list,
  slug,
  current,
}: {
  list: Assignment[];
  slug: string;
  current: string;
}) {
  return (
    <ol className="grid gap-0.5">
      {list.map((x) => {
        const here = x.project.id === current;
        return (
          <li key={x.project.id}>
            <Link
              href={`/judge/${slug}/p/${x.project.id}`}
              aria-current={here ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2 text-[13px] transition-colors duration-150 ${here ? "border-accent bg-accent/[0.07] text-ink" : "border-transparent text-ink-2 hover:bg-surface-hover hover:text-ink"}`}
            >
              <StatusDot
                tone={statusTone[x.status]}
                label={statusLabel[x.status]}
              />
              <span
                className={`min-w-0 flex-1 truncate ${x.status === "recused" ? "line-through decoration-muted/60" : ""}`}
              >
                {x.project.title}
              </span>
              {x.review && (
                <span className="font-mono text-[11px] text-muted tabular">
                  {f2(x.review.composite)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export default async function ReviewPage({
  params,
}: PageProps<"/judge/[event]/p/[project]">) {
  const { event, project } = await params;
  const here = `/judge/${event}/p/${project}`;
  await requireMe(here);
  const [er, ar] = await Promise.all([
    load<Event>(`/events/${event}`, here),
    load<Assignment[] | null>(
      `/judge/assignments?event=${encodeURIComponent(event)}`,
      here,
    ),
  ]);
  if (!er.ok) return <Problem error={er.error} />;
  if (!ar.ok) return <Problem error={ar.error} />;
  const e = er.data;
  const list = ar.data ?? [];
  const a = list.find((x) => x.project.id === project);
  if (!a)
    return (
      <Problem
        error={{ status: 403, message: "This project is not assigned to you." }}
      />
    );
  const next =
    list.find((x) => x.status === "pending" && x.project.id !== project)
      ?.project.id ?? "";
  const done = list.filter((x) => x.status === "done").length;
  const assigned = list.filter((x) => x.status !== "recused").length;
  const open = judgingOpen(e);
  const criteria = e.criteria ?? [];
  const p = a.project;

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 pb-16 pt-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            href="/judge"
            className="group inline-flex items-center gap-1.5 text-muted transition-colors hover:text-ink"
          >
            <Icon
              name="arrowLeft"
              size={14}
              className="transition-transform group-hover:-translate-x-0.5"
            />
            Judging
          </Link>
          <span className="text-line-strong">/</span>
          <span className="truncate text-ink-2">{e.name}</span>
        </div>
        <div className="flex items-center gap-3">
          {open ? (
            <Tag tone="accent" dot>
              judging open
            </Tag>
          ) : (
            <Tag tone="warn" dot>
              judging closed
            </Tag>
          )}
          <Bar
            value={percent(done, assigned)}
            className="w-24 sm:w-32"
            label={`${done} of ${assigned} reviews done`}
          />
          <span className="whitespace-nowrap font-mono text-xs text-ink-2 tabular">
            {done}
            <span className="text-muted"> / {assigned}</span>
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)_380px] xl:grid-cols-[250px_minmax(0,1fr)_400px]">
        {/* Left: every assignment for this event. On mobile it folds away. */}
        <nav aria-label="Your assignments" className="min-w-0">
          <details className="rounded-lg border border-line bg-surface lg:hidden">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium">
              Your assignments
              <span className="font-mono text-xs text-muted">
                {list.length}
              </span>
            </summary>
            <div className="border-t border-line p-2">
              <AssignmentNav list={list} slug={e.slug} current={p.id} />
            </div>
          </details>
          <div className="hidden lg:sticky lg:top-[4.5rem] lg:block">
            <Eyebrow tone="neutral" className="mb-3 px-2.5">
              Queue · {list.length}
            </Eyebrow>
            <AssignmentNav list={list} slug={e.slug} current={p.id} />
            {open && (
              <Link
                href={`/judge/${e.slug}/pairwise`}
                className="mt-4 flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <Icon name="split" size={13} />
                Pairwise mode
              </Link>
            )}
          </div>
        </nav>

        {/* Center: the project itself. */}
        <article className="min-w-0 animate-rise">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {p.track_name && <Tag tone="accent">{p.track_name}</Tag>}
            <Tag tone={statusTone[a.status]} dot>
              {statusLabel[a.status]}
            </Tag>
            <Hash value={p.id} className="text-muted" />
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            {p.title}
          </h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-ink-2">
            <Icon name="users" size={14} className="text-muted" />
            {p.team_name}
          </p>
          {p.summary && (
            <p className="mt-6 text-pretty text-lg leading-relaxed text-ink">
              {p.summary}
            </p>
          )}
          {(p.repo_url || p.demo_url) && (
            <div className="mt-5 flex flex-wrap gap-2">
              {p.repo_url && (
                <a
                  href={p.repo_url}
                  target="_blank"
                  rel="noopener nofollow"
                  className={buttonClass("secondary", "sm")}
                >
                  <Icon name="github" size={13} />
                  Repository
                  <Icon name="arrowUpRight" size={12} className="text-muted" />
                </a>
              )}
              {p.demo_url && (
                <a
                  href={p.demo_url}
                  target="_blank"
                  rel="noopener nofollow"
                  className={buttonClass("secondary", "sm")}
                >
                  <Icon name="eye" size={13} />
                  Live demo
                  <Icon name="arrowUpRight" size={12} className="text-muted" />
                </a>
              )}
            </div>
          )}
          {p.description ? (
            <div className="mt-8">
              <Eyebrow tone="neutral" className="mb-3">
                Description
              </Eyebrow>
              <div className="whitespace-pre-wrap rounded-lg border border-line bg-surface px-5 py-4 text-[15px] leading-relaxed text-ink-2">
                {p.description}
              </div>
            </div>
          ) : (
            <p className="mt-8 text-sm text-muted">
              The team didn't write a longer description.
            </p>
          )}
          {a.reason && (
            <div className="mt-6 flex gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3">
              <Icon
                name="gavel"
                size={15}
                className="mt-0.5 shrink-0 text-muted"
              />
              <div className="text-sm">
                <p className="font-medium text-ink">Why you were assigned</p>
                <p className="mt-0.5 font-mono text-xs text-ink-2">
                  {a.reason}
                </p>
              </div>
            </div>
          )}
        </article>

        {/* Right: the rubric. */}
        <aside
          aria-label="Rubric"
          className="min-w-0 lg:sticky lg:top-[4.5rem] lg:self-start"
        >
          {open ? (
            <>
              <section className="overflow-clip rounded-lg border border-line bg-surface shadow-[var(--shadow)] lg:flex lg:max-h-[calc(100vh-5.5rem)] lg:flex-col">
                <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
                  <h2 className="flex items-center gap-2 text-[13px] font-medium">
                    <Icon name="gavel" size={14} className="text-muted" />
                    Rubric
                  </h2>
                  <span className="text-xs text-muted">
                    {a.review
                      ? `saved ${ago(a.review.updated_at)}`
                      : `${criteria.length} criteria`}
                  </span>
                </header>
                <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {criteria.length ? (
                    <RubricForm
                      event={e.slug}
                      project={p.id}
                      next={next}
                      criteria={criteria}
                      initial={a.review?.scores ?? {}}
                      comment={a.review?.comment ?? ""}
                      updating={!!a.review}
                    />
                  ) : (
                    <p className="p-4 text-sm text-muted">
                      The organizers haven't defined a rubric for this event
                      yet, so there is nothing to score.
                    </p>
                  )}
                </div>
              </section>
              {a.status === "pending" && (
                <details className="group mt-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
                  <summary className="flex cursor-pointer items-center justify-between text-ink-2 hover:text-ink">
                    Conflict of interest?
                    <Icon
                      name="chevronDown"
                      size={14}
                      className="text-muted transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="mt-2 text-xs text-muted">
                    Decline this assignment if you can't judge it fairly. The
                    organizer sees your reason and can reassign the project.
                  </p>
                  <ActionForm
                    action={recuse}
                    confirm="Decline this assignment? The organizer will see your reason."
                    className="mt-3 grid gap-3"
                  >
                    <input type="hidden" name="event" value={e.id} />
                    <input type="hidden" name="project" value={p.id} />
                    <Field label="Reason">
                      <input
                        name="reason"
                        required
                        maxLength={200}
                        placeholder="e.g. I mentor this team"
                        className={inputCls}
                      />
                    </Field>
                    <div>
                      <Submit variant="danger" size="sm">
                        Decline assignment
                      </Submit>
                    </div>
                  </ActionForm>
                </details>
              )}
            </>
          ) : (
            <ClosedRubric e={e} a={a} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ClosedRubric({ e, a }: { e: Event; a: Assignment }) {
  const criteria = e.criteria ?? [];
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-4 py-2.5 text-[13px] font-medium">
        <Icon name="lock" size={14} className="text-muted" />
        Judging closed
      </header>
      <div className="p-4">
        <Callout tone="warn">
          {e.results_published_at
            ? "Results are published, so reviews are final."
            : e.judging_close_at
              ? `Judging closed ${when(e.judging_close_at)}. Reviews can no longer be changed.`
              : "Judging is not open for this event."}
        </Callout>
        {a.review ? (
          <>
            <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
              Your submitted scores
            </p>
            <dl className="grid gap-1.5 text-sm">
              {criteria.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 border-b border-line pb-1.5"
                >
                  <dt className="text-ink-2">{c.name}</dt>
                  <dd className="font-mono tabular">
                    {a.review?.scores[c.key] ?? "·"}
                    <span className="text-muted">/{c.scale_max}</span>
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 pt-1">
                <dt className="font-medium">Weighted score</dt>
                <dd className="font-mono text-lg tabular">
                  {f2(a.review.composite)}
                </dd>
              </div>
            </dl>
            {e.results_published_at && (
              <Link
                href={`/judge/${e.slug}/record`}
                className={`${buttonClass("secondary", "sm")} mt-4`}
              >
                <Icon name="shieldCheck" size={13} />
                Your signed record
              </Link>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            You didn't submit a review for this project.
          </p>
        )}
      </div>
    </section>
  );
}
