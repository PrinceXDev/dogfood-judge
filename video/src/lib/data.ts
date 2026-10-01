// Numbers and names from the DOGFOOD fixtures (fixtures.json) and the
// engine's own report on them (JUDGING.md). The video should never claim
// something the product does not print.

export const FIXTURE = {
  projects: 41,
  judges: 30,
  reviews: 126,
  winner: "Salt Ledger",
  winnerId: "prj_11",
  runnerUp: "Iron Switch",
  winnerHeld: 24,
  // Removing any of these judges changes first place (JUDGING.md §3.9).
  decidingJudges: [2, 4, 16, 20, 29, 30],
  leadSE: 0.05,
  pTop3Leader: 0.51,
  leaderInterval: [1, 6] as const,
  mostInfluential: "jdg_24",
  influentialTau: 0.78,
  flatJudge: "jdg_07",
  authCases: 44,
};

export const PODIUM = [
  { id: "prj_11", title: "Salt Ledger", track: "Developer tools" },
  { id: "prj_34", title: "Iron Switch", track: "Fintech" },
  { id: "prj_37", title: "Salt Loom", track: "Climate" },
  { id: "prj_25", title: "Dry Relay", track: "Health" },
  { id: "prj_08", title: "North Drift", track: "Education" },
];

// Tie-breaker targets on the fixture (JUDGING.md §1.1), with their P(top 3).
export const TIEBREAK = [
  { id: "prj_34", title: "Iron Switch", p: 0.65 },
  { id: "prj_11", title: "Salt Ledger", p: 0.55 },
  { id: "prj_37", title: "Salt Loom", p: 0.49 },
  { id: "prj_25", title: "Dry Relay", p: 0.24 },
  { id: "prj_08", title: "North Drift", p: 0.2 },
  { id: "prj_01", title: "Glass Signal", p: 0.03 },
  { id: "prj_19", title: "Small Relay", p: 0.01 },
  { id: "prj_22", title: "Quiet Forge", p: 0.0 },
];

export const PROJECT_NAMES = [
  "Glass Signal", "Salt Ledger", "Iron Switch", "Salt Loom", "Dry Relay", "North Drift",
  "Dry Harbour", "Small Relay", "Quiet Forge", "Amber Index", "Cold Atlas", "Pale Engine",
  "Lunar Sieve", "Moss Vector", "Brass Orbit", "Fern Socket", "Static Bloom", "Copper Tide",
  "Velvet Queue", "Hollow Mint", "Ember Grid", "Paper Comet", "Slate Pulse", "Tidal Ledger",
];
