// Shapes of the Go API's JSON (see src/web/static/openapi.yaml). Go encodes
// empty slices as null, so list fields are nullable and read with `?? []`.

export type Role = "organizer" | "judge" | "participant";

export interface User {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
}

export interface Me {
  user: User;
  roles: Record<string, Role[]>;
  can_create_events: boolean;
  csrf_token: string;
}

export interface Track {
  id: string;
  name: string;
  description: string;
}

export interface Prize {
  id: string;
  track_id?: string;
  name: string;
  description: string;
  value: string;
}

export interface Criterion {
  id: string;
  key: string;
  name: string;
  description: string;
  weight: number;
  scale_min: number;
  scale_max: number;
}

export interface Event {
  id: string;
  slug: string;
  name: string;
  description: string;
  submissions_open_at: string;
  submissions_close_at: string;
  judging_close_at: string | null;
  voting_open_at: string | null;
  voting_close_at: string | null;
  results_published_at: string | null;
  reviews_per_project: number;
  max_team_size: number;
  votes_per_voter: number;
  is_public: boolean;
  created_at: string;
  tracks?: Track[] | null;
  prizes?: Prize[] | null;
  criteria?: Criterion[] | null;
}

export interface Project {
  id: string;
  event_id: string;
  team_id: string;
  team_name: string;
  track_id?: string;
  track_name?: string;
  title: string;
  summary: string;
  description: string;
  repo_url: string;
  demo_url: string;
  status: "draft" | "submitted";
  submitted_at: string | null;
  updated_at: string;
  duplicate_of?: string;
  disqualified_reason?: string;
}

export interface GalleryPage {
  projects: Project[] | null;
  total: number;
  page: number;
  page_size: number;
}

export interface Team {
  id: string;
  event_id: string;
  name: string;
  invite_token?: string;
  members: User[] | null;
  project?: Project;
}

export interface Review {
  judge_id: string;
  judge_name?: string;
  project_id: string;
  event_id: string;
  scores: Record<string, number>;
  composite: number;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  event_id: string;
  event_name: string;
  event_slug: string;
  project: Project;
  status: "pending" | "done" | "recused";
  reason: string;
  review?: Review;
}

export interface JudgeProgress {
  id: string;
  name: string;
  assigned: number;
  done: number;
  last_review_at: string | null;
}

export interface Progress {
  event_id: string;
  phase: string;
  projects: number;
  drafts: number;
  assignments: number;
  done: number;
  percent: number;
  fully_reviewed: number;
  unassigned: number;
  judges: JudgeProgress[] | null;
  review_histogram: Record<string, number>;
  comparisons: number;
  votes: number;
  flagged_votes: number;
  pairwise_stability?: number;
  stability_lag: number;
  updated_at: string;
}

export interface JudgeSummary {
  user: User;
  tracks: string[] | null;
  assigned: number;
  done: number;
  can_login: boolean;
}

export interface ProjectResult {
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
  /** rank_dist[r - 1]: bootstrap replicates placing the project r-th. */
  rank_dist: number[] | null;
}

export interface ResultRow extends ProjectResult {
  project: Project;
}

export interface JudgeRow {
  name: string;
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
  drift?: JudgeDrift;
}

export interface JudgeDrift {
  reviews: number;
  spread_ratio: number;
  spread_p: number;
  noise_ratio: number;
  noise_p: number;
}

export interface Robustness {
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
  /** Organizers only: each leave-one-judge-out refit's top k, in rank order. */
  refit_top_k?: Record<string, string[] | null> | null;
}

export interface OutlierReview {
  judge: string;
  project: string;
  score: number;
  expected: number;
  z: number;
  rank_with: number;
  rank_without: number;
}

export interface Report {
  methods: string[];
  primary: string;
  fit: {
    mu: number;
    sigma: number;
    tau_bias: number;
    tau_quality: number;
    tau_scale_prior: number;
    iterations: number;
    converged: boolean;
  };
  agreement: Record<string, number>;
  components: number;
  top_k: number;
  bootstrap: number;
  reviews: number;
  robustness?: Robustness;
  outliers: OutlierReview[] | null;
}

export interface PairwiseRow {
  project: Project;
  strength: number;
  se: number;
  comparisons: number;
  rank: number;
  rank_dist: number[] | null;
}

export interface VoteTally {
  project: Project;
  counted: number;
  held: number;
}

export interface Results {
  event: Event;
  report: Report;
  rows: ResultRow[] | null;
  judges: JudgeRow[] | null;
  pairwise: PairwiseRow[] | null;
  votes?: VoteTally[] | null;
  excluded: Project[] | null;
  published: boolean;
}

export interface Ballot {
  event_id: string;
  projects: Project[] | null;
  my_votes: string[] | null;
  remaining: number;
  open: boolean;
  closes_at: string | null;
}

export interface PairOffer {
  event_id: string;
  a: Project | null;
  b: Project | null;
  done: number;
  reason?: string;
  streak: number;
  pause_after: number;
}

export interface Comment {
  id: string;
  project_id: string;
  user_id: string;
  user_name: string;
  body: string;
  created_at: string;
  hidden: boolean;
}

export interface FlaggedVote {
  project_id: string;
  title: string;
  user_id: string;
  user_name: string;
  ip_hash: string;
  reason: string;
  created_at: string;
}

export interface Webhook {
  id: string;
  url: string;
  secret?: string;
  topics: string[];
  active: boolean;
  created_at: string;
}

export interface Delivery {
  id: number;
  webhook_id: string;
  topic: string;
  status: string;
  attempts: number;
  last_error: string;
  created_at: string;
}

export interface AuditEntry {
  seq: number;
  at: string;
  actor_id: string;
  event_id: string;
  action: string;
  target: string;
  detail: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
}

export interface AuditLog {
  verification: { ok: boolean; entries: number; broken_at?: number };
  entries: AuditEntry[] | null;
  names: Record<string, string>;
}

export interface SignedRecord {
  payload: string;
  signature: string;
  key_id: string;
}

export interface RecordPayload {
  type: string;
  role: "judge" | "participant";
  event_id: string;
  event_name: string;
  name: string;
  reviews_completed?: number;
  comparisons?: number;
  project_title?: string;
  team?: string;
  issued_at: string;
  key_id: string;
  pseudonym?: string;
  review_leaves?: string[];
}

export interface Manifest {
  type: string;
  event_id: string;
  event_name: string;
  published_at: string;
  engine: string;
  input_digest: string;
  audit_anchor: string;
  ranking: { rank: number; project: string; title: string; adjusted: number }[];
  key_id: string;
  /** v2 manifests: Merkle root over every review leaf. */
  review_root?: string;
  review_count?: number;
}

export interface Bundle {
  manifest: SignedRecord;
  inputs: { event_id: string; reviews: unknown[] | null };
}

export interface SigningKey {
  alg: string;
  key_id: string;
  public_key: string;
}

export interface DuplicatePair {
  original: Project;
  duplicate: Project;
}

export interface EventAssignment {
  judge: string;
  judge_name: string;
  project: string;
  project_title: string;
  status: "pending" | "done" | "recused";
  reason: string;
  recuse_reason?: string;
}

export interface AssignReport {
  new: { judge: string; project: string; reason: string }[] | null;
  load_min: number;
  load_max: number;
  load_mean: number;
  components: number;
  underfilled: string[] | null;
  off_track: number;
}
