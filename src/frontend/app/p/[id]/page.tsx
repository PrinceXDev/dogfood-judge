import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { addComment, vote } from "@/app/actions";
import { buttonClass } from "@/components/button";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Comments } from "@/components/project/comments";
import { ProjectIdentity } from "@/components/project/identity";
import { ProjectLinks } from "@/components/project/links";
import {
  BackLink,
  DataList,
  inputCls,
  Page,
  Panel,
  Problem,
  Tag,
} from "@/components/ui";
import { api, getMe, load, rolesIn } from "@/lib/api";
import { phase, votingOpen, when } from "@/lib/format";
import { hostOf, linkState } from "@/lib/links";
import type { Ballot, Comment, Event, Project } from "@/lib/types";

export async function generateMetadata({
  params,
}: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = await api<Project>(`/projects/${id}`).catch(() => null);
  return { title: p?.title ?? "Project" };
}

export default async function ProjectPage({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const r = await load<Project>(`/projects/${id}`, `/p/${id}`);
  if (!r.ok) return <Problem error={r.error} />;
  const p = r.data;
  const me = await getMe();
  const [e, comments] = await Promise.all([
    api<Event>(`/events/${p.event_id}`),
    api<Comment[] | null>(`/projects/${p.id}/comments`),
  ]);
  const roles = rolesIn(me, e.id);
  const open = votingOpen(e);
  const ballot =
    me && open
      ? await api<Ballot>(`/events/${e.id}/ballot`).catch(() => null)
      : null;
  const voted = ballot?.my_votes?.includes(p.id) ?? false;
  const next = encodeURIComponent(`/p/${p.id}`);
  const edited =
    p.submitted_at && p.updated_at && p.updated_at !== p.submitted_at;

  return (
    <Page>
      <BackLink href={`/events/${e.slug}/projects`}>{e.name} projects</BackLink>

      <header className="relative grid animate-rise overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)] md:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <ProjectIdentity
          id={p.id}
          title={p.title}
          className="h-36 border-b border-line sm:h-44 md:order-last md:h-auto md:min-h-72 md:border-b-0 md:border-l"
        />
        <div className="relative flex min-w-0 flex-col justify-end px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-center gap-1.5">
            {p.track_name && (
              <Link
                href={`/events/${e.slug}/projects?track=${encodeURIComponent(p.track_id ?? "")}`}
                className="rounded-full transition-opacity hover:opacity-80"
              >
                <Tag tone="accent">{p.track_name}</Tag>
              </Link>
            )}
            {p.status === "draft" && (
              <Tag tone="warn" dot>
                draft: only your team and organizers see this
              </Tag>
            )}
            {p.duplicate_of && (
              <Tag tone="bad" dot>
                duplicate of{" "}
                <Link
                  href={`/p/${p.duplicate_of}`}
                  className="font-mono underline decoration-bad/40 hover:decoration-bad"
                >
                  {p.duplicate_of}
                </Link>
              </Tag>
            )}
            {p.disqualified_reason && (
              <Tag tone="bad" dot className="whitespace-normal">
                disqualified: {p.disqualified_reason}
              </Tag>
            )}
          </div>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
            {p.title}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[15px] text-ink-2">
            <Icon name="users" size={15} className="text-muted" />
            {p.team_name}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <ProjectLinks p={p} size="md" primary />
            <p className="font-mono text-[11px] leading-relaxed text-muted">
              <span className="text-ink-2">{p.id}</span>
              {p.submitted_at ? (
                <>
                  {" · "}submitted{" "}
                  <time dateTime={p.submitted_at}>{when(p.submitted_at)}</time>
                </>
              ) : (
                " · not submitted"
              )}
              {edited && (
                <>
                  <br className="sm:hidden" />
                  {" · "}edited{" "}
                  <time dateTime={p.updated_at}>{when(p.updated_at)}</time>
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <section aria-labelledby="about">
            <h2 id="about" className="sr-only">
              About
            </h2>
            {p.summary ? (
              <p className="text-pretty text-lg leading-relaxed font-medium tracking-[-0.01em] text-ink sm:text-xl">
                {p.summary}
              </p>
            ) : (
              <p className="text-muted">No summary yet.</p>
            )}
            {p.description ? (
              // Plain text from the team: whitespace kept, never parsed as HTML.
              <div className="mt-6 whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2/50 p-5 text-[15px] leading-relaxed text-ink-2">
                {p.description}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">
                The team hasn't written a longer description.
              </p>
            )}
          </section>

          <Comments
            comments={comments ?? []}
            signedIn={Boolean(me)}
            loginHref={`/login?next=${next}`}
            form={
              me && p.status === "submitted" ? (
                <ActionForm action={addComment} className="grid gap-3">
                  <input type="hidden" name="project" value={p.id} />
                  <label className="sr-only" htmlFor="comment-body">
                    Comment
                  </label>
                  <textarea
                    id="comment-body"
                    name="body"
                    required
                    data-error-missing="Write your comment before posting it."
                    maxLength={2000}
                    rows={3}
                    className={`${inputCls} resize-y`}
                    placeholder={`Say something useful to ${p.team_name}`}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted">
                      Plain text, up to 2000 characters. Organizers can hide
                      comments.
                    </span>
                    <Submit size="sm">Post comment</Submit>
                  </div>
                </ActionForm>
              ) : me ? (
                <p className="text-sm text-muted">
                  Comments open once the project is submitted.
                </p>
              ) : null
            }
          />
        </div>

        <aside className="grid content-start gap-4">
          <Panel title="Built for" icon="flag">
            <Link
              href={`/events/${e.slug}`}
              data-nav-item
              className="group -m-1 block rounded-md p-1"
            >
              <span className="flex items-center justify-between gap-2 font-medium text-ink group-hover:text-accent">
                {e.name}
                <Icon
                  name="arrowRight"
                  size={14}
                  className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </span>
              <span className="mt-1 block text-xs text-muted">{phase(e)}</span>
            </Link>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[13px]">
              <Link
                href={`/events/${e.slug}/projects`}
                className="text-ink-2 hover:text-ink"
              >
                All projects
              </Link>
              {e.results_published_at && (
                <Link
                  href={`/events/${e.slug}/results`}
                  className="text-ink-2 hover:text-ink"
                >
                  Results
                </Link>
              )}
            </div>
          </Panel>

          {open ? (
            <Panel
              title="Community vote"
              icon="vote"
              aside={
                e.voting_close_at ? (
                  <span className="font-mono text-[11px]">
                    closes {when(e.voting_close_at)}
                  </span>
                ) : undefined
              }
            >
              {me ? (
                <ActionForm action={vote} className="grid gap-3">
                  <input type="hidden" name="project" value={p.id} />
                  {voted ? (
                    <>
                      <p className="flex items-center gap-2 text-sm text-ink">
                        <Icon name="check" size={15} className="text-accent" />
                        You voted for this project.
                      </p>
                      <Submit variant="secondary" name="intent" value="unvote">
                        Withdraw vote
                      </Submit>
                    </>
                  ) : (
                    <Submit
                      variant="accent"
                      name="intent"
                      value="vote"
                      disabled={ballot ? ballot.remaining <= 0 : false}
                    >
                      <Icon name="vote" size={15} />
                      Vote for this project
                    </Submit>
                  )}
                  <p className="text-xs leading-relaxed text-muted">
                    <span className="font-mono text-ink-2 tabular">
                      {ballot?.remaining ?? 0}
                    </span>{" "}
                    vote{ballot?.remaining === 1 ? "" : "s"} left. Tallies stay
                    hidden until results are published.{" "}
                    <Link
                      href={`/events/${e.slug}/ballot`}
                      className="text-ink-2 underline decoration-line-strong hover:text-ink"
                    >
                      Your ballot
                    </Link>
                  </p>
                </ActionForm>
              ) : (
                <div className="grid gap-3">
                  <p className="text-sm text-ink-2">
                    Sign in to back this project. Each account gets{" "}
                    <span className="font-mono tabular">
                      {e.votes_per_voter}
                    </span>{" "}
                    votes.
                  </p>
                  <Link
                    href={`/login?next=${next}`}
                    className={buttonClass("secondary")}
                  >
                    Sign in to vote
                  </Link>
                </div>
              )}
            </Panel>
          ) : e.voting_open_at && e.voting_close_at ? (
            <Panel title="Community vote" icon="vote">
              <p className="text-sm text-muted">
                Voting{" "}
                {new Date(e.voting_open_at) > new Date() ? "opens" : "closed"}{" "}
                <span className="font-mono text-xs text-ink-2">
                  {when(
                    new Date(e.voting_open_at) > new Date()
                      ? e.voting_open_at
                      : e.voting_close_at,
                  )}
                </span>
                .
              </p>
            </Panel>
          ) : null}

          <Panel title="Record" icon="file">
            <DataList
              className="text-[13px]"
              items={[
                [
                  "Project",
                  <span key="id" className="font-mono text-xs">
                    {p.id}
                  </span>,
                ],
                ["Team", p.team_name],
                [
                  "Track",
                  p.track_name ?? (
                    <span key="t" className="text-muted">
                      none
                    </span>
                  ),
                ],
                [
                  "Status",
                  <span
                    key="s"
                    className={p.status === "draft" ? "text-warn" : "text-ink"}
                  >
                    {p.status}
                  </span>,
                ],
                ...(p.repo_url
                  ? ([
                      [
                        "Repo",
                        <span key="r" className="font-mono text-xs">
                          {hostOf(p.repo_url)}
                          {linkState(p.repo_url) === "placeholder" && (
                            <span className="ml-2 text-muted">
                              (sample data)
                            </span>
                          )}
                        </span>,
                      ],
                    ] as [string, ReactNode][])
                  : []),
              ]}
            />
          </Panel>

          {roles.participant && (
            <Panel title="Participant" icon="users">
              <Link
                href={`/events/${e.slug}/team`}
                className="flex items-center justify-between text-sm text-ink-2 hover:text-ink"
              >
                Your team and submission
                <Icon name="arrowRight" size={14} />
              </Link>
            </Panel>
          )}

          {roles.organizer && (
            <Panel title="Organizer" icon="shield">
              <Link
                href={`/organize/${e.slug}/moderation`}
                className={`${buttonClass("secondary", "sm")} w-full`}
              >
                <Icon name="flag" size={13} />
                Moderate
              </Link>
            </Panel>
          )}
        </aside>
      </div>
    </Page>
  );
}
