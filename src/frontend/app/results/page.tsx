import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyState, Page, PageHeader, Tag } from "@/components/ui";
import { api, getMe, rolesIn } from "@/lib/api";
import { pct, when } from "@/lib/format";
import type { Event, Results } from "@/lib/types";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsIndex() {
  const [events, me] = await Promise.all([
    api<Event[] | null>("/events"),
    getMe(),
  ]);
  const items = await Promise.all(
    (events ?? []).map(async (e) => {
      const organizer = rolesIn(me, e.id).organizer;
      const published = !!e.results_published_at;
      // Only fetch what the viewer may see: published results, or an organizer's preview.
      const res =
        published || organizer
          ? await api<Results>(`/events/${e.id}/results`).catch(() => null)
          : null;
      return { e, organizer, published, res };
    }),
  );

  return (
    <Page width="medium">
      <PageHeader
        eyebrow="Results"
        title={
          <>
            Results you can{" "}
            <span className="font-serif font-normal italic text-accent">
              defend
            </span>
          </>
        }
        sub="Published rankings come with rank intervals, a leave-one-judge-out robustness test and a signed bundle anyone can re-run offline. Unpublished results stay sealed."
      />
      {items.length ? (
        <ul className="grid gap-3">
          {items.map(({ e, organizer, published, res }) => {
            const top = res?.rows?.find((x) => x.ranks.biasscale === 1);
            const rb = res?.report.robustness;
            const href = published
              ? `/events/${e.slug}/results`
              : organizer
                ? `/organize/${e.slug}/results`
                : `/events/${e.slug}/results`;
            return (
              <li key={e.id}>
                <Link
                  href={href}
                  data-nav-item
                  className="glow-edge group grid gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold tracking-tight">{e.name}</h2>
                      {published ? (
                        <Tag tone="good" dot>
                          published{" "}
                          {when(e.results_published_at).replace(" UTC", "")}
                        </Tag>
                      ) : organizer ? (
                        <Tag tone="warn" dot>
                          preview · not published
                        </Tag>
                      ) : (
                        <Tag>
                          <Icon name="lock" size={11} /> sealed
                        </Tag>
                      )}
                    </div>
                    {top ? (
                      <p className="mt-2 text-sm text-ink-2">
                        <span className="text-muted">#1</span>{" "}
                        <span className="text-ink">{top.project.title}</span>
                        <span className="text-muted">
                          {" "}
                          · {top.project.team_name}
                        </span>
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        {published || organizer
                          ? "No reviews yet."
                          : "No score is visible until the organizers publish."}
                      </p>
                    )}
                  </div>
                  {top && rb && (
                    <dl className="flex gap-6 font-mono text-sm">
                      <div>
                        <dt className="text-[10.5px] uppercase tracking-wider text-muted">
                          held
                        </dt>
                        <dd
                          className={
                            rb.winner_held === rb.refits
                              ? "text-accent"
                              : "text-warn"
                          }
                        >
                          {rb.winner_held}/{rb.refits}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10.5px] uppercase tracking-wider text-muted">
                          P(top {res?.report.top_k})
                        </dt>
                        <dd>{pct(top.prob_top_k)}</dd>
                      </div>
                      <Icon
                        name="arrowRight"
                        size={16}
                        className="self-center text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                      />
                    </dl>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No events yet." icon="trophy" />
      )}
    </Page>
  );
}
