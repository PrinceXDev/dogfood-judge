// Real screenshots, optional. Drop PNGs into public/screenshots/ and list them
// here; the browser frames will show them instead of the built-in mock UI.
// Capture at 1600x900 (16:9) from `docker compose up` → http://localhost:8080.
//
//   create:      /organize/new
//   teams:       /events/playground-hack/team
//   submissions: /events/sample-hack-2026/projects
//   assignment:  /organize/sample-hack-2026  (Assignments)
//   scoring:     /judging  (as jonas.vogel@example.org)
//   analysis:    /results/sample-hack-2026  ("Is the winner defensible?")
//   publish:     /organize/sample-hack-2026/settings  (Publish)
//   verify:      /verify
export type ScreenKey =
  | "create"
  | "teams"
  | "submissions"
  | "assignment"
  | "scoring"
  | "analysis"
  | "publish"
  | "verify";

export const SCREENSHOTS: Partial<Record<ScreenKey, string>> = {
  // create: "screenshots/create.png",
};
