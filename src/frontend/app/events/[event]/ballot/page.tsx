import type { Metadata } from "next";
import Link from "next/link";
import { vote } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import {
  BackLink,
  Callout,
  EmptyState,
  Page,
  PageHeader,
  Problem,
  Tag,
} from "@/components/ui";
import { api, load, requireMe } from "@/lib/api";
import { when } from "@/lib/format";
import type { Ballot, Event } from "@/lib/types";

export const metadata: Metadata = { title: "Community vote" };

export default async function BallotPage({
  params,
}: PageProps<"/events/[event]/ballot">) {
  const { event } = await params;
  await requireMe(`/events/${event}/ballot`);
  const r = await load<Ballot>(
    `/events/${event}/ballot`,
    `/events/${event}/ballot`,
  );
  if (!r.ok) return <Problem error={r.error} />;
  const b = r.data;
  const e = await api<Event>(`/events/${b.event_id}`);
  const projects = b.projects ?? [];
  const voted = new Set(b.my_votes ?? []);
  const total = e.votes_per_voter;
  const mine = projects.filter((p) => voted.has(p.id));

  return (
    <Page>
      <BackLink href={`/events/${e.slug}`}>{e.name}</BackLink>
      <PageHeader
        eyebrow="Community vote"
        title={
          <>
            Back the work you{" "}
            <span className="font-serif font-normal italic text-accent">
              believe
            </span>{" "}
            in.
          </>
        }
        sub="Community votes are tallied separately from the judges' scores."
      />

      {!b.open && (
        <Callout tone="warn" title="Voting is not open.">
          {e.voting_open_at && Date.now() < new Date(e.voting_open_at).getTime()
            ? `It opens ${when(e.voting_open_at)}.`
            : "The voting window has closed."}
        </Callout>
      )}

      <section
        aria-label="Your vote budget"
        className="relative mb-8 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]"
      >
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(90deg,transparent,black_60%)]" />
        <div className="relative grid gap-6 p-5 sm:p-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Votes left
            </p>
            <p className="mt-1 font-mono text-4xl font-medium tracking-tight tabular">
              <span className={b.remaining > 0 ? "text-accent" : "text-ink-2"}>
                {b.remaining}
              </span>
              <span className="text-xl text-muted">/{total}</span>
            </p>
            <ul
              aria-label={`${b.remaining} of ${total} votes left`}
              className="mt-3 flex flex-wrap gap-1.5"
            >
              {Array.from({ length: total }, (_, i) => {
                const left = i < b.remaining;
                return (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: one token per vote
                    key={i}
                    aria-hidden="true"
                    className={`size-4 rounded-full border transition-colors duration-300 ${left ? "border-accent bg-accent shadow-[0_0_10px_-2px_var(--glow)]" : "border-line-strong bg-transparent"}`}
                  />
                );
              })}
            </ul>
          </div>
          <div className="grid gap-3 text-sm md:border-l md:border-line md:pl-10">
            {b.closes_at && (
              <p className="flex items-center gap-2 text-ink-2">
                <Icon name="clock" size={14} className="text-muted" />
                Closes{" "}
                <time
                  dateTime={b.closes_at}
                  className="font-mono text-[13px] text-ink"
                >
                  {when(b.closes_at)}
                </time>
              </p>
            )}
            <p className="flex gap-2 text-ink-2">
              <Icon
                name="split"
                size={14}
                className="mt-[3px] shrink-0 text-muted"
              />
              <span>
                The order is shuffled for you, so no project gains from being
                listed first.
              </span>
            </p>
            <p className="flex gap-2 text-ink-2">
              <Icon
                name="eye"
                size={14}
                className="mt-[3px] shrink-0 text-muted"
              />
              <span>Tallies stay hidden until results are published.</span>
            </p>
            {mine.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-ink-2">
                <span className="mr-1 text-muted">Your votes:</span>
                {mine.map((p) => (
                  <Tag key={p.id} tone="accent">
                    <Icon name="check" size={11} />
                    {p.title}
                  </Tag>
                ))}
              </p>
            )}
          </div>
        </div>
      </section>

      {projects.length === 0 ? (
        <EmptyState title="Nothing on the ballot yet." icon="vote">
          Projects appear here once they are submitted.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const isMine = voted.has(p.id);
            return (
              <li key={p.id}>
                <article
                  data-nav-item
                  tabIndex={-1}
                  className={`glow-edge flex h-full flex-col rounded-lg border bg-surface p-4 transition-colors duration-200 ${isMine ? "border-accent/50 bg-accent/[0.04]" : "border-line hover:border-line-strong"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 font-semibold tracking-[-0.01em]">
                      <Link href={`/p/${p.id}`} className="hover:text-accent">
                        {p.title}
                      </Link>
                    </h3>
                    {isMine && (
                      <Tag tone="accent" className="shrink-0">
                        <Icon name="check" size={11} />
                        voted
                      </Tag>
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    {p.team_name}
                    {p.track_name && <Tag>{p.track_name}</Tag>}
                  </p>
                  {p.summary && (
                    <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">
                      {p.summary}
                    </p>
                  )}
                  {b.open && (
                    <ActionForm
                      action={vote}
                      className="mt-auto grid gap-2 pt-4"
                    >
                      <input type="hidden" name="project" value={p.id} />
                      {isMine ? (
                        <Submit
                          size="sm"
                          variant="secondary"
                          name="intent"
                          value="unvote"
                        >
                          Withdraw vote
                        </Submit>
                      ) : b.remaining > 0 ? (
                        <Submit
                          size="sm"
                          variant="secondary"
                          name="intent"
                          value="vote"
                        >
                          <Icon name="vote" size={13} />
                          Vote
                        </Submit>
                      ) : (
                        <p className="rounded-md border border-dashed border-line-strong py-1 text-center text-xs text-muted">
                          No votes left. Withdraw one to vote here.
                        </p>
                      )}
                    </ActionForm>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
