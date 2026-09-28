import type { Event } from "./types";

// An event's schedule as four stages, derived only from its dates. Progress
// here is elapsed *time* in each window, which is what the schedule knows;
// judging completion comes from /progress and is shown separately.

export type StageState = "done" | "live" | "upcoming" | "off";
export type Stage = {
  key: "submissions" | "judging" | "voting" | "results";
  label: string;
  state: StageState;
  pct: number;
  start: string | null;
  end: string | null;
};

const t = (s: string | null | undefined) => (s ? new Date(s).getTime() : null);

function windowStage(
  key: Stage["key"],
  label: string,
  start: string | null,
  end: string | null,
  now: number,
): Stage {
  const a = t(start);
  const b = t(end);
  if (a === null) return { key, label, state: "off", pct: 0, start, end };
  if (now < a) return { key, label, state: "upcoming", pct: 0, start, end };
  if (b === null) return { key, label, state: "live", pct: 50, start, end };
  if (now >= b) return { key, label, state: "done", pct: 100, start, end };
  return {
    key,
    label,
    state: "live",
    pct: (100 * (now - a)) / Math.max(1, b - a),
    start,
    end,
  };
}

export function timeline(e: Event, now = Date.now()): Stage[] {
  const published = !!e.results_published_at;
  const judgingEnd = e.judging_close_at ?? e.results_published_at;
  const judging = windowStage(
    "judging",
    "Judging",
    e.submissions_close_at,
    judgingEnd,
    now,
  );
  if (published) {
    judging.state = "done";
    judging.pct = 100;
  }
  return [
    windowStage(
      "submissions",
      "Submissions",
      e.submissions_open_at,
      e.submissions_close_at,
      now,
    ),
    judging,
    windowStage("voting", "Voting", e.voting_open_at, e.voting_close_at, now),
    {
      key: "results",
      label: "Results",
      state: published ? "done" : "upcoming",
      pct: published ? 100 : 0,
      start: e.results_published_at,
      end: null,
    },
  ];
}

/** The next deadline worth counting down to, if any. */
export function nextDeadline(
  e: Event,
  now = Date.now(),
): { label: string; at: string } | null {
  const cands: [string, string | null][] = [
    ["Submissions open", e.submissions_open_at],
    ["Submissions close", e.submissions_close_at],
    ["Voting opens", e.voting_open_at],
    ["Voting closes", e.voting_close_at],
    ["Judging closes", e.results_published_at ? null : e.judging_close_at],
  ];
  const next = cands
    .filter(([, at]) => at && new Date(at).getTime() > now)
    .sort(
      (a, b) =>
        new Date(a[1] as string).getTime() - new Date(b[1] as string).getTime(),
    )[0];
  return next ? { label: next[0], at: next[1] as string } : null;
}
