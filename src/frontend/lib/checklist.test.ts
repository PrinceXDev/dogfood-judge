import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type ChecklistInput, checklist, type StepState } from "./checklist.ts";
import type {
  Event,
  JudgeSummary,
  Progress,
  Report,
  ResultRow,
} from "./types.ts";

// Inputs shaped like the seeded fixture event, advanced through its phases.

const NOW = Date.parse("2026-05-10T12:00:00Z");
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

function event(over: Partial<Event> = {}): Event {
  return {
    id: "evt_1",
    slug: "fixture",
    name: "Fixture Hack",
    description: "",
    submissions_open_at: iso(-3),
    submissions_close_at: iso(1),
    judging_close_at: iso(4),
    voting_open_at: null,
    voting_close_at: null,
    results_published_at: null,
    reviews_per_project: 3,
    max_team_size: 4,
    votes_per_voter: 3,
    is_public: true,
    created_at: iso(-10),
    criteria: [
      {
        id: "c1",
        key: "impact",
        name: "Impact",
        description: "",
        weight: 1,
        scale_min: 1,
        scale_max: 5,
      },
    ],
    ...over,
  };
}

function progress(over: Partial<Progress> = {}): Progress {
  return {
    event_id: "evt_1",
    phase: "submissions open",
    projects: 12,
    drafts: 2,
    assignments: 0,
    done: 0,
    percent: 0,
    fully_reviewed: 0,
    unassigned: 12,
    judges: [],
    review_histogram: {},
    comparisons: 0,
    votes: 0,
    flagged_votes: 0,
    stability_lag: 10,
    updated_at: iso(0),
    ...over,
  };
}

const judge = (id: string, can_login = true): JudgeSummary => ({
  user: { id, email: `${id}@x.test`, name: id, is_admin: false },
  tracks: [],
  assigned: 0,
  done: 0,
  can_login,
});

function report(over: Partial<Report> = {}): Report {
  return {
    methods: ["raw", "biasscale"],
    primary: "biasscale",
    fit: {
      mu: 3,
      sigma: 1,
      tau_bias: 0.3,
      tau_quality: 0.8,
      tau_scale_prior: 0.2,
      iterations: 20,
      converged: true,
    },
    agreement: {},
    components: 1,
    top_k: 3,
    bootstrap: 300,
    reviews: 36,
    outliers: [],
    ...over,
  };
}

const row = (p: number): ResultRow =>
  ({ ranks: { biasscale: 1 }, prob_top_k: p }) as unknown as ResultRow;

function states(input: Partial<ChecklistInput>): Record<string, StepState> {
  const steps = checklist({
    event: event(),
    progress: progress(),
    judges: [],
    report: null,
    rows: [],
    tiebreakRun: false,
    now: NOW,
    ...input,
  });
  return Object.fromEntries(steps.map((s) => [s.key, s.state]));
}

describe("checklist", () => {
  test("a new event only has setup to do", () => {
    const s = states({ event: event({ criteria: [] }) });
    assert.equal(s.schedule, "done");
    assert.equal(s.rubric, "todo");
    assert.equal(s.invited, "todo");
    assert.equal(s.activated, "todo");
    assert.equal(s.closed, "waiting");
    assert.equal(s.connected, "waiting");
    assert.equal(s.boundary, "waiting");
    assert.equal(s.voting, "skipped");
    assert.equal(s.published, "todo");
  });

  test("judges must reach reviews_per_project and all sign in", () => {
    const few = states({ judges: [judge("a"), judge("b")] });
    assert.equal(few.invited, "todo");
    assert.equal(few.activated, "done");
    const inactive = states({
      judges: [judge("a"), judge("b"), judge("c", false)],
    });
    assert.equal(inactive.invited, "done");
    assert.equal(inactive.activated, "todo");
  });

  test("judging in progress with split judge groups", () => {
    const s = states({
      event: event({ submissions_close_at: iso(-1) }),
      progress: progress({
        assignments: 36,
        done: 20,
        percent: 56,
        unassigned: 0,
      }),
      report: report({ components: 2, reviews: 20 }),
      rows: [row(0.99), row(0.5)],
    });
    assert.equal(s.closed, "done");
    assert.equal(s.assigned, "done");
    assert.equal(s.connected, "todo");
    assert.equal(s.judged, "todo");
    assert.equal(s.boundary, "todo");
  });

  test("under-assigned projects keep assignments open", () => {
    const s = states({
      progress: progress({ assignments: 30, unassigned: 2 }),
    });
    assert.equal(s.assigned, "todo");
  });

  test("the boundary resolves by certainty or by a tie-breaker run", () => {
    const base = {
      event: event({ submissions_close_at: iso(-1) }),
      progress: progress({
        assignments: 36,
        done: 36,
        percent: 100,
        unassigned: 0,
      }),
      report: report(),
    };
    assert.equal(
      states({ ...base, rows: [row(0.99), row(0.01)] }).boundary,
      "done",
    );
    assert.equal(states({ ...base, rows: [row(0.4)] }).boundary, "todo");
    assert.equal(
      states({ ...base, rows: [row(0.4)], tiebreakRun: true }).boundary,
      "done",
    );
    assert.equal(states(base).judged, "done");
  });

  test("voting waits for its deadline, then for held votes", () => {
    const voting = { voting_open_at: iso(-1), voting_close_at: iso(1) };
    assert.equal(states({ event: event(voting) }).voting, "waiting");
    const closed = event({ voting_open_at: iso(-3), voting_close_at: iso(-1) });
    assert.equal(
      states({ event: closed, progress: progress({ flagged_votes: 4 }) })
        .voting,
      "todo",
    );
    assert.equal(states({ event: closed }).voting, "done");
  });

  test("publishing with an unresolved boundary skips that step", () => {
    const s = states({
      event: event({
        submissions_close_at: iso(-3),
        results_published_at: iso(-1),
      }),
      report: report(),
      rows: [row(0.6)],
    });
    assert.equal(s.published, "done");
    assert.equal(s.boundary, "skipped");
    assert.equal(s.judged, "skipped");
  });

  test("every step links somewhere inside the organizer area", () => {
    const steps = checklist({
      event: event(),
      progress: progress(),
      judges: [],
      report: null,
      rows: [],
      tiebreakRun: false,
      now: NOW,
    });
    assert.equal(steps.length, 11);
    for (const s of steps) assert.match(s.path, /^(|[/#].*)$/);
  });
});
