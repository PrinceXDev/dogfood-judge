import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { CopyField } from "@/components/forms";
import { Icon } from "@/components/icons";
import { ManifestVerifier } from "@/components/results/manifest-verifier";
import { RankingTable } from "@/components/results/ranking";
import {
  BackLink,
  Callout,
  DataList,
  Hash,
  num,
  Page,
  PageHeader,
  Problem,
  Section,
  Table,
} from "@/components/ui";
import { DefensibilityGraph } from "@/components/viz/defensibility-graph";
import { ReviewInfluence } from "@/components/viz/review-influence";
import { api, apiRoot, getMe, load, rolesIn } from "@/lib/api";
import { f2, pct, when } from "@/lib/format";
import type { Bundle, Event, Manifest, Results, SigningKey } from "@/lib/types";

function Sealed({ e, organizer }: { e: Event | null; organizer: boolean }) {
  return (
    <Page width="medium">
      {e && <BackLink href={`/events/${e.slug}`}>{e.name}</BackLink>}
      <div className="relative overflow-hidden rounded-xl border border-line bg-surface px-6 py-16 text-center">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(closest-side,black,transparent)]" />
        <span className="relative mx-auto grid size-12 place-items-center rounded-xl border border-line-strong bg-surface-2 text-accent">
          <Icon name="lock" size={20} />
        </span>
        <h1 className="relative mt-6 text-3xl font-semibold tracking-[-0.03em]">
          Results are sealed.
        </h1>
        <p className="relative mx-auto mt-3 max-w-md text-ink-2">
          Nobody outside the organizing team sees a score until results are
          published. Judges only ever see their own. When they're published, the
          ranking, its uncertainty and a signed, reproducible bundle appear
          here.
        </p>
        {organizer && e && (
          <Link
            href={`/organize/${e.slug}/results`}
            className={`${buttonClass("accent")} relative mt-8`}
          >
            Open the organizer results <Icon name="arrowRight" size={14} />
          </Link>
        )}
      </div>
    </Page>
  );
}

export default async function PublicResults({
  params,
}: PageProps<"/events/[event]/results">) {
  const { event } = await params;
  const r = await load<Results>(
    `/events/${event}/results`,
    `/events/${event}/results`,
  );
  if (!r.ok) {
    if (r.error.status !== 403) return <Problem error={r.error} />;
    const e = await api<Event>(`/events/${event}`).catch(() => null);
    return <Sealed e={e} organizer={false} />;
  }
  const res = r.data;
  const me = await getMe();
  if (!res.published)
    return (
      <Sealed e={res.event} organizer={rolesIn(me, res.event.id).organizer} />
    );

  const [bundle, key] = await Promise.all([
    api<Bundle>(`/events/${res.event.id}/results/bundle`).catch(() => null),
    apiRoot<SigningKey>("/.well-known/dogfood-signing-key"),
  ]);
  const manifest: Manifest | null = bundle
    ? JSON.parse(
        Buffer.from(bundle.manifest.payload, "base64").toString("utf8"),
      )
    : null;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const bundleUrl = `${origin}/api/v1/events/${res.event.id}/results/bundle`;
  const rep = res.report;
  const k = rep.top_k;
  const rows = res.rows ?? [];
  const ranked = rows.filter((x) => x.ranks.biasscale);
  const byId = new Map(rows.map((x) => [x.project.id, x.project]));
  const rb = rep.robustness;
  const winner = ranked[0];
  const stable = rb ? rb.winner_held === rb.refits : false;

  // Judge identities stay private on the public page: one anonymous node per
  // refit, spreading the ones that flip the winner evenly around the ring.
  const flips = rb?.winner_flips?.length ?? 0;
  const flipAt = new Set(
    Array.from({ length: flips }, (_, j) =>
      Math.floor((j * (rb?.refits ?? 0)) / flips),
    ),
  );
  const anon = rb
    ? Array.from({ length: rb.refits }, (_, i) => ({
        id: `#${i + 1}`,
        label: `Judge #${i + 1}`,
        flips: flipAt.has(i),
        influence: 0,
      }))
    : [];

  return (
    <Page>
      <BackLink href={`/events/${res.event.slug}`}>{res.event.name}</BackLink>
      <PageHeader
        eyebrow={`Published ${when(res.event.results_published_at)}`}
        title={
          <>
            {res.event.name}:{" "}
            <span className="font-serif font-normal italic text-accent">
              results
            </span>
          </>
        }
        sub="Scores are adjusted for how lenient each judge was and how much of the scale they used, so no project is helped or hurt by who happened to review it. Overlapping rank intervals mean the data doesn't separate those projects."
        actions={
          bundle && (
            <a
              href={`/api/v1/events/${res.event.id}/results/bundle`}
              className={buttonClass("secondary")}
            >
              <Icon name="download" size={14} /> Results bundle
            </a>
          )
        }
      />

      {ranked.length >= 3 && (
        <ol className="grid gap-3 md:grid-cols-3">
          {ranked.slice(0, 3).map((x, i) => (
            <li
              key={x.project.id}
              className={`glow-edge relative overflow-hidden rounded-xl border p-5 ${i === 0 ? "border-accent/40 bg-accent/[0.05]" : "border-line bg-surface"}`}
            >
              <p
                className={`font-mono text-5xl font-medium tabular ${i === 0 ? "text-accent" : "text-ink-2"}`}
              >
                {i + 1}
              </p>
              <Link
                href={`/p/${x.project.id}`}
                className="mt-4 block text-lg font-semibold tracking-tight hover:text-accent"
              >
                {x.project.title}
              </Link>
              <p className="text-sm text-muted">
                {x.project.team_name}
                {x.project.track_name ? ` · ${x.project.track_name}` : ""}
              </p>
              <p className="mt-4 flex gap-4 font-mono text-xs text-ink-2">
                <span>
                  P(top {k}) {pct(x.prob_top_k)}
                </span>
                <span>
                  interval #{x.rank_low}–#{x.rank_high}
                </span>
              </p>
            </li>
          ))}
        </ol>
      )}

      {rb && winner && (
        <Section
          id="defensibility"
          eyebrow="Leave-one-judge-out"
          title="Is the winner defensible?"
          desc="Every judge is removed in turn and the whole model refitted. Judges are anonymous here; the count of refits that change first place is exact."
        >
          <div className="rounded-xl border border-line bg-surface/50 p-5 sm:p-8">
            <DefensibilityGraph
              winner={{ id: winner.project.id, label: winner.project.title }}
              judges={anon}
              refits={rb.refits}
              held={rb.winner_held}
              topK={k}
              probTopK={winner.prob_top_k}
              rankLow={winner.rank_low}
              rankHigh={winner.rank_high}
              margin={rb.winner_margin}
              compact
            />
          </div>
          {!stable && (
            <Callout
              tone="warn"
              title={`First place depends on individual judges in ${rb.refits - rb.winner_held} of ${rb.refits} refits.`}
            >
              {rb.winner_margin < 1
                ? `The winner's lead is ${f2(rb.winner_margin)} standard errors: statistically, a tie with second place.`
                : "The lead itself is clear, but a single judge's reviews can still move it."}
            </Callout>
          )}
        </Section>
      )}

      <Section eyebrow="Ranking" title="Every project, with its uncertainty">
        <RankingTable rows={rows} k={k} />
      </Section>

      {!!rep.outliers?.length && (
        <Section
          eyebrow="Outliers"
          title="Reviews that disagree with everyone"
          desc="The engine flags reviews no judge habit or consensus explains, and reports each one's effect after a full refit without it. Judges are anonymous here."
        >
          <ReviewInfluence
            total={ranked.length}
            reviews={rep.outliers.map((o, i) => ({
              judge: `${o.judge}-${i}`,
              judgeLabel: "A judge",
              project: o.project,
              projectLabel: byId.get(o.project)?.title ?? o.project,
              score: o.score,
              expected: o.expected,
              z: o.z,
              rankWith: o.rank_with,
              rankWithout: o.rank_without,
            }))}
          />
        </Section>
      )}

      {manifest && bundle && (
        <Section
          id="verify"
          eyebrow="Proof chain"
          title="Verify these results yourself"
          desc="The bundle holds every review's criterion scores, with judges replaced by pseudonyms, and a manifest signed by this portal. The manifest commits to a fingerprint of those inputs, to the audit-log entry of the publication, and to the ranking. Re-run the engine offline and you get the same order, or the verifier tells you exactly what differs."
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-lg border border-line bg-surface p-5">
              <DataList
                items={[
                  [
                    "Input fingerprint",
                    <Hash
                      key="d"
                      value={manifest.input_digest}
                      head={20}
                      className="text-accent"
                    />,
                  ],
                  [
                    "Audit anchor",
                    <Hash key="a" value={manifest.audit_anchor} head={20} />,
                  ],
                  ...(manifest.review_root
                    ? ([
                        [
                          "Review root",
                          <span key="r" className="grid gap-0.5">
                            <Hash
                              value={manifest.review_root}
                              head={20}
                              className="text-accent"
                            />
                            <span className="text-[11px] text-muted">
                              All {manifest.review_count ?? 0} reviews
                              committed. A judge can prove each of theirs is
                              here, unchanged, with{" "}
                              <span className="font-mono">
                                dogfood verify-review
                              </span>
                              .
                            </span>
                          </span>,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  [
                    "Engine",
                    <span key="e" className="font-mono text-xs">
                      {manifest.engine}
                    </span>,
                  ],
                  [
                    "Signing key",
                    <span key="k" className="font-mono text-xs">
                      Ed25519 · {manifest.key_id}
                    </span>,
                  ],
                  [
                    "Ranked projects",
                    <span key="n" className="font-mono text-xs">
                      {manifest.ranking.length}
                    </span>,
                  ],
                ]}
              />
            </div>
            <ManifestVerifier
              manifest={bundle.manifest}
              publicKey={key.public_key}
            />
          </div>
          <div className="mt-4 grid gap-2">
            <p className="text-sm text-ink-2">
              Full check, offline: signature, input digest, and a re-run of the
              engine.
            </p>
            <CopyField value={`curl -o bundle.json ${bundleUrl}`} />
            <CopyField
              value={`dogfood verify-results bundle.json --key ${key.public_key}`}
            />
          </div>
        </Section>
      )}

      <Section eyebrow="Community" title="Community vote">
        {res.votes?.length ? (
          <Table>
            <thead>
              <tr>
                <th>Project</th>
                <th className={num}>Votes</th>
              </tr>
            </thead>
            <tbody>
              {res.votes.map((v) => (
                <tr key={v.project.id}>
                  <td>{v.project.title}</td>
                  <td className={num}>{v.counted}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Callout>No community votes were cast.</Callout>
        )}
      </Section>
    </Page>
  );
}
