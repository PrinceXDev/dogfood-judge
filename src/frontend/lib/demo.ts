// Shapes of GET /api/v1/demo/simulate: the real judging engine run on one
// synthetic hackathon. Only a simulation knows the ground truth, which is
// what lets the landing page show *why* normalization matters.

export type DemoConfig = {
  projects: number;
  judges: number;
  coverage: number;
  leniency: number;
  scale: number;
  noise: number;
  seed: number;
};

export type EngineProject = {
  project: string;
  reviews: number;
  scores: Record<string, number>;
  ranks: Record<string, number>;
  se: number;
  rank_low: number;
  rank_high: number;
  prob_top_k: number;
  rank_change: number;
  provisional: boolean;
  ahead_of_next: number;
};

export type EngineJudge = {
  judge: string;
  reviews: number;
  mean_given: number;
  sd_given: number;
  bias: number;
  bias_se: number;
  scale: number;
  flags: string[] | null;
  agreement: number;
  has_agreement: boolean;
  influence: number;
  outliers: number;
  flips_top_k: number;
  flips_first: boolean;
};

export type EngineRobustness = {
  winner: string;
  refits: number;
  winner_held: number;
  winner_flips: string[] | null;
  top_k: string[] | null;
  top_k_held: number;
  top_k_flips: string[] | null;
  pivotal: string;
  pivotal_tau: number;
  runner_up_gap: number;
  winner_margin: number;
};

export type EngineOutlier = {
  judge: string;
  project: string;
  score: number;
  expected: number;
  z: number;
  rank_with: number;
  rank_without: number;
};

export type EngineReport = {
  methods: string[];
  primary: string;
  projects: EngineProject[];
  judges: EngineJudge[];
  fit: { mu: number; sigma: number; tau_bias: number; tau_quality: number };
  agreement: Record<string, number>;
  components: number;
  top_k: number;
  bootstrap: number;
  reviews: number;
  robustness?: EngineRobustness;
  outliers: EngineOutlier[] | null;
};

export type DemoResult = {
  config: DemoConfig;
  truth: { id: string; truth: number; true_rank: number }[];
  judges: { id: string; true_bias: number; true_scale: number }[];
  reviews: { judge: string; project: string; score: number }[];
  report: EngineReport;
  accuracy: {
    raw_tau: number;
    adjusted_tau: number;
    raw_top_k: number;
    adjusted_top_k: number;
    raw_winner: boolean;
    adjusted_winner: boolean;
  };
};

/** The world the landing-page story is told with (chosen because it shows
 *  an outlier review, two winner-flipping judges and a real accuracy gain). */
export const STORY_WORLD: DemoConfig = {
  projects: 24,
  judges: 8,
  coverage: 3,
  leniency: 0.6,
  scale: 0.35,
  noise: 0.6,
  seed: 388,
};

export function demoQuery(c: DemoConfig): string {
  return new URLSearchParams(
    Object.entries(c).map(([k, v]) => [k, String(v)]),
  ).toString();
}

/** Human labels for synthetic ids: p07 → "Project 07", j03 → "Judge 03". */
export const pLabel = (id: string) => `Project ${id.slice(1)}`;
export const jLabel = (id: string) => `Judge ${id.slice(1)}`;
