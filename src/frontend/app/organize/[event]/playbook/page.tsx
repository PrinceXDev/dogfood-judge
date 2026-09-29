import Link from "next/link";
import { buttonClass } from "@/components/button";
import { PrintButton } from "@/components/forms";
import { Icon, type IconName } from "@/components/icons";
import { publicOrigin } from "@/components/trust/origin";
import {
  Callout,
  DataList,
  PageHeader,
  Panel,
  Problem,
  Section,
  Tag,
  type Tone,
} from "@/components/ui";
import { api, load, requireMe } from "@/lib/api";
import { checklist, type StepState } from "@/lib/checklist";
import { when } from "@/lib/format";
import { playbookMarkdown, TROUBLESHOOTING } from "@/lib/playbook";
import type {
  AuditLog,
  Event,
  JudgeSummary,
  Progress,
  Results,
} from "@/lib/types";

const STATE: Record<StepState, { tone: Tone; icon: IconName; label: string }> =
  {
    done: { tone: "good", icon: "check", label: "done" },
    todo: { tone: "warn", icon: "arrowRight", label: "to do" },
    waiting: { tone: "info", icon: "clock", label: "waiting" },
    skipped: { tone: "neutral", icon: "x", label: "skipped" },
  };

export default async function Playbook({
  params,
}: PageProps<"/organize/[event]/playbook">) {
  const { event } = await params;
  const here = `/organize/${event}/playbook`;
  await requireMe(here);
  const er = await load<Event>(`/events/${event}`, here);
  if (!er.ok) return <Problem error={er.error} />;
  const e = er.data;
  const pr = await load<Progress>(`/events/${e.id}/progress`, here);
  if (!pr.ok) return <Problem error={pr.error} />;
  const [judges, results, audit, origin] = await Promise.all([
    api<JudgeSummary[] | null>(`/events/${e.id}/judges`).then((j) => j ?? []),
    api<Results>(`/events/${e.id}/results`).catch(() => null),
    api<AuditLog>(`/events/${e.id}/audit`).catch(() => null),
    publicOrigin(),
  ]);
  // The audit endpoint returns the newest 500 entries, so a tie-breaker run
  // long before a burst of reviews can fall off; the step then reads "to do".
  const tiebreakRun = (audit?.entries ?? []).some(
    (x) => x.action === "assignment.tiebreak",
  );
  const steps = checklist({
    event: e,
    progress: pr.data,
    judges,
    report: results?.report ?? null,
    rows: results?.rows ?? [],
    tiebreakRun,
  });
  const base = `/organize/${e.slug}`;
  const done = steps.filter((s) => s.state === "done").length;
  const counted = steps.filter((s) => s.state !== "skipped").length;
  const next = steps.find((s) => s.state === "todo");
  const md = playbookMarkdown({
    event: e,
    steps,
    judges: judges.length,
    origin,
  });

  return (
    <>
      <PageHeader
        eyebrow="Playbook"
        title="Run this event"
        sub="Every step below is worked out from the event's live state, so it can't say done before it is. Each one links to where the work happens."
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <a
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`}
              download={`${e.slug}-playbook.md`}
              className={buttonClass("secondary")}
            >
              <Icon name="download" size={14} /> Download as Markdown
            </a>
            <PrintButton label="Save as PDF" />
          </div>
        }
      />

      {next ? (
        <Callout
          tone="accent"
          title={`Next: ${next.label}`}
          action={
            <Link href={base + next.path} className={buttonClass("accent")}>
              {next.cta} <Icon name="arrowRight" size={13} />
            </Link>
          }
        >
          {next.detail}
        </Callout>
      ) : (
        <Callout tone="good" title="Nothing left to do">
          Every step that applies is done or waiting on a deadline.
        </Callout>
      )}

      <Panel
        title="Checklist"
        icon="check"
        aside={
          <span className="font-mono tabular">
            {done}/{counted} done
          </span>
        }
        bodyClass=""
      >
        <ol>
          {steps.map((s, i) => {
            const st = STATE[s.state];
            return (
              <li
                key={s.key}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center"
              >
                <span className="mt-0.5 font-mono text-xs text-muted tabular sm:mt-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium ${s.state === "skipped" ? "text-muted" : "text-ink"}`}
                  >
                    {s.label}
                  </p>
                  <p className="text-xs text-muted">{s.detail}</p>
                </div>
                <div className="col-start-2 flex items-center gap-3 sm:col-start-auto sm:contents">
                  <Tag tone={st.tone} className="sm:justify-self-end">
                    <Icon name={st.icon} size={11} />
                    {st.label}
                  </Tag>
                  <Link
                    href={base + s.path}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline sm:w-36 sm:justify-end"
                  >
                    {s.cta} <Icon name="arrowRight" size={11} />
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="This event" icon="info">
          <DataList
            items={[
              [
                "Slug",
                <span key="slug" className="font-mono">
                  {e.slug}
                </span>,
              ],
              [
                "Submissions",
                `${when(e.submissions_open_at)} → ${when(e.submissions_close_at)}`,
              ],
              ["Judging closes", when(e.judging_close_at)],
              [
                "Voting",
                e.voting_open_at
                  ? `${when(e.voting_open_at)} → ${when(e.voting_close_at)}`
                  : "not scheduled",
              ],
              [
                "Judges",
                `${judges.length} invited · ${e.reviews_per_project} reviews per project`,
              ],
              [
                "Public page",
                <Link
                  key="public"
                  href={`/events/${e.slug}`}
                  className="text-accent"
                >
                  /events/{e.slug}
                </Link>,
              ],
            ]}
          />
        </Panel>
        <Panel title="Inviting judges" icon="users">
          <ol className="grid list-decimal gap-2 pl-5 text-sm text-ink-2">
            <li>
              On the{" "}
              <Link href={`${base}#invite`} className="text-accent">
                command center
              </Link>
              , create an invite link with the role Judge.
            </li>
            <li>Add the judge's email to make the link work only for them.</li>
            <li>
              Send the link. The judge opens it, signs in or creates an account,
              and accepts; their assignments then appear at{" "}
              <span className="font-mono">/judge</span>.
            </li>
            <li>
              Once at least {e.reviews_per_project} judges are in,{" "}
              <Link href={`${base}#judges`} className="text-accent">
                run the assignment engine
              </Link>
              .
            </li>
          </ol>
        </Panel>
      </div>

      <Section
        id="troubleshooting"
        eyebrow="When something goes wrong"
        title="Troubleshooting"
      >
        <div className="grid gap-3 md:grid-cols-2">
          {TROUBLESHOOTING.map((t) => (
            <Link
              key={t.problem}
              href={base + t.path}
              className="group rounded-lg border border-line bg-surface p-4 hover:border-line-strong hover:bg-surface-hover/60"
            >
              <p className="flex items-center justify-between gap-3 text-sm font-medium text-ink">
                {t.problem}
                <Icon
                  name="arrowRight"
                  size={13}
                  className="text-muted group-hover:text-accent"
                />
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.fix}</p>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
