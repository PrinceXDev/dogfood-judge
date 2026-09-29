import type { Event, JudgeSummary, Progress, Report, ResultRow } from "./types";

// The organizer checklist. Every step is derived from event state rather than
// ticked by hand, so nothing is stored and it can never drift from reality.
// Keep this file free of runtime imports: `node --test` runs it directly.

export type StepState = "done" | "todo" | "waiting" | "skipped";

export type Step = {
  key: string;
  label: string;
  state: StepState;
  /** The event's own numbers behind the state. */
  detail: string;
  /** Path relative to /organize/{slug}, where the step is done. */
  path: string;
  cta: string;
};

export type ChecklistInput = {
  event: Event;
  progress: Progress;
  judges: JudgeSummary[];
  report: Report | null;
  rows: ResultRow[];
  /** An `assignment.tiebreak` entry exists in the audit log. */
  tiebreakRun: boolean;
  now?: number;
};

/** Projects whose top-k place is uncertain: the tie-breaker's own rule. */
export function onBoundary(rows: ResultRow[]): ResultRow[] {
  return rows.filter(
    (x) => x.ranks.biasscale && x.prob_top_k > 0.05 && x.prob_top_k < 0.95,
  );
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const at = (s: string | null | undefined) => (s ? new Date(s).getTime() : null);

export function checklist(input: ChecklistInput): Step[] {
  const { event: e, progress: p, judges, report, rows, tiebreakRun } = input;
  const now = input.now ?? Date.now();
  const published = !!e.results_published_at;
  const closeAt = at(e.submissions_close_at);
  const criteria = e.criteria ?? [];
  const active = judges.filter((j) => j.can_login).length;
  const reviewed = !!report && report.reviews > 0;
  const k = report?.top_k ?? 3;
  const boundary = onBoundary(rows).length;
  const votingClose = at(e.voting_close_at);

  const steps: Step[] = [
    {
      key: "schedule",
      label: "Event created, dates set",
      state: closeAt !== null ? "done" : "todo",
      detail:
        closeAt !== null
          ? "Submission deadline is set."
          : "No submission deadline yet.",
      path: "/settings#event",
      cta: "Edit dates",
    },
    {
      key: "rubric",
      label: "Rubric has at least one criterion",
      state: criteria.length > 0 ? "done" : "todo",
      detail: `${plural(criteria.length, "criterion", "criteria")} defined.`,
      path: "/settings#rubric",
      cta: "Edit rubric",
    },
    {
      key: "invited",
      label: "Judges invited",
      state: judges.length >= e.reviews_per_project ? "done" : "todo",
      detail: `${plural(judges.length, "judge")} invited; each project needs ${e.reviews_per_project}.`,
      path: "#invite",
      cta: "Invite judges",
    },
    {
      key: "activated",
      label: "Judges activated",
      state: judges.length > 0 && active === judges.length ? "done" : "todo",
      detail: `${active} of ${plural(judges.length, "judge")} can sign in.`,
      path: "#judges",
      cta: "Activation links",
    },
    {
      key: "closed",
      label: "Submissions closed",
      state: closeAt !== null && now >= closeAt ? "done" : "waiting",
      detail:
        closeAt === null
          ? "Waiting for a submission deadline."
          : now >= closeAt
            ? `${plural(p.projects, "project")} submitted, ${plural(p.drafts, "draft")} left unsubmitted.`
            : `Open until the deadline; ${plural(p.projects, "project")} submitted so far.`,
      path: "/settings#event",
      cta: "Edit dates",
    },
    {
      key: "assigned",
      label: "Assignments run",
      state: p.assignments > 0 && p.unassigned === 0 ? "done" : "todo",
      detail:
        p.assignments === 0
          ? "No assignments yet."
          : p.unassigned > 0
            ? `${plural(p.unassigned, "project")} short of ${e.reviews_per_project} reviewers.`
            : `${plural(p.assignments, "assignment")}; every project has enough reviewers.`,
      path: "#judges",
      cta: "Run assignment",
    },
    {
      key: "connected",
      label: "Judge groups connected",
      state: !reviewed ? "waiting" : report.components === 1 ? "done" : "todo",
      detail: !reviewed
        ? "Needs at least one review."
        : report.components === 1
          ? "All judges share projects, so scores are on one scale."
          : `Judges form ${report.components} groups that share no projects.`,
      path: "#judges",
      cta: "Add bridging reviews",
    },
    {
      key: "judged",
      label: "Judging complete",
      state:
        p.assignments > 0 && p.percent === 100
          ? "done"
          : published
            ? "skipped" // publishing closes judging; nothing is left to do here
            : "todo",
      detail:
        published && p.percent < 100
          ? `Published with ${p.assignments - p.done} of ${plural(p.assignments, "assignment")} unreviewed.`
          : `${p.done} of ${plural(p.assignments, "assignment")} reviewed (${Math.floor(p.percent)}%).`,
      path: "",
      cta: "Progress",
    },
    {
      key: "boundary",
      label: "Prize boundary resolved",
      state: !reviewed
        ? "waiting"
        : boundary === 0 || tiebreakRun
          ? "done"
          : published
            ? "skipped"
            : "todo",
      detail: !reviewed
        ? "Needs results to measure."
        : boundary === 0
          ? `Every project is clearly in or out of the top ${k}.`
          : tiebreakRun
            ? `Tie-breaker has run; ${plural(boundary, "project")} still between 5% and 95% for the top ${k}.`
            : published
              ? `Published with ${plural(boundary, "project")} on the boundary.`
              : `${plural(boundary, "project")} between 5% and 95% for the top ${k}.`,
      path: "/results#boundary",
      cta: "Tie-breaker round",
    },
    {
      key: "voting",
      label: "Voting closed, held votes reviewed",
      state:
        votingClose === null
          ? "skipped"
          : now < votingClose
            ? "waiting"
            : p.flagged_votes > 0
              ? "todo"
              : "done",
      detail:
        votingClose === null
          ? "Community voting isn't scheduled."
          : now < votingClose
            ? `Voting is still open; ${plural(p.votes, "vote")} so far.`
            : p.flagged_votes > 0
              ? `${plural(p.flagged_votes, "held vote")} to review.`
              : `${plural(p.votes, "vote")} counted, none held.`,
      path: "/moderation#votes",
      cta: "Review votes",
    },
    {
      key: "published",
      label: "Results published and signed",
      state: published ? "done" : "todo",
      detail: published
        ? "Signed manifest is anchored to the audit log."
        : "Not published yet.",
      path: "/results",
      cta: published ? "Manage" : "Review & publish",
    },
  ];
  return steps;
}
