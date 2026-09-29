import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { PairwiseForm } from "@/components/pairwise";
import {
  BackLink,
  Callout,
  EmptyState,
  Kbd,
  Page,
  PageHeader,
  Problem,
} from "@/components/ui";
import { load, requireMe } from "@/lib/api";
import { judgingOpen, when } from "@/lib/format";
import type { Event, PairOffer } from "@/lib/types";

export const metadata: Metadata = { title: "Pairwise judging" };

export default async function Pairwise({
  params,
}: PageProps<"/judge/[event]/pairwise">) {
  const { event } = await params;
  const here = `/judge/${event}/pairwise`;
  await requireMe(here);
  const er = await load<Event>(`/events/${event}`, here);
  if (!er.ok) return <Problem error={er.error} />;
  const e = er.data;
  const open = judgingOpen(e);
  const or = open
    ? await load<PairOffer>(`/events/${e.id}/pairwise/next`, here)
    : null;
  if (or && !or.ok) return <Problem error={or.error} />;
  const offer = or?.data;

  return (
    <Page>
      <BackLink href="/judge">Judging</BackLink>
      <PageHeader
        eyebrow={`Pairwise · ${e.name}`}
        title={
          <>
            Which is <span className="font-serif italic">better</span>?
          </>
        }
        sub="No scores, just a choice. The server picks the pair whose outcome it is least sure about, and fits a Bradley–Terry model to every judge's choices."
        actions={
          offer && (
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-ink-2">
              <Icon name="split" size={13} className="text-accent" />
              <span className="tabular text-ink">{offer.done}</span>
              {offer.done === 1 ? "comparison" : "comparisons"} recorded
            </div>
          )
        }
      >
        {offer?.a && offer.b && (
          <p className="mt-4 hidden items-center gap-2 text-xs text-muted sm:flex">
            <Kbd>A</Kbd>
            <Kbd>B</Kbd> pick a side
            <span className="text-line-strong">·</span>
            <Kbd>T</Kbd> tie
          </p>
        )}
      </PageHeader>

      {!open ? (
        <EmptyState
          icon="lock"
          title="Judging is closed."
          action={
            <Link href="/judge" className={buttonClass("secondary")}>
              Back to your queue
            </Link>
          }
        >
          {e.judging_close_at
            ? `Comparisons closed ${when(e.judging_close_at)}.`
            : "Comparisons aren't being accepted for this event."}
        </EmptyState>
      ) : offer?.a && offer.b ? (
        <>
          {offer.streak >= offer.pause_after && (
            <Callout tone="info" title="Time for a short break?">
              You've made {offer.streak} comparisons in a row. Verdicts drift
              when attention does; this pair will still be here when you come
              back.
            </Callout>
          )}
          {offer.reason && (
            <p className="mb-4 flex items-center gap-2 text-sm text-muted">
              <Icon name="info" size={14} className="shrink-0" />
              <span>
                <span className="text-ink-2">Why this pair: </span>
                {offer.reason}
              </span>
            </p>
          )}
          <PairwiseForm
            key={`${offer.a.id}:${offer.b.id}`}
            event={e.id}
            a={offer.a}
            b={offer.b}
          />
        </>
      ) : (
        <EmptyState
          icon="check"
          title="You're all caught up."
          action={
            <Link href="/judge" className={buttonClass("secondary")}>
              Back to your queue
            </Link>
          }
        >
          You have compared every pair available to you. Thank you.
        </EmptyState>
      )}
    </Page>
  );
}
