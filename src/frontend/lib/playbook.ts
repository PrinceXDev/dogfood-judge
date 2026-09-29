import type { Step } from "./checklist";
import { when } from "./format";
import type { Event } from "./types";

// Fixes for problems the product already handles, each pointing at the page
// where it is done. Shared by the playbook page and its Markdown export.
export const TROUBLESHOOTING: { problem: string; fix: string; path: string }[] =
  [
    {
      problem: "A judge lost their sign-in link",
      fix: "Issue a new activation link from the judge list. It lasts 7 days and is shown once, so send it straight away.",
      path: "#judges",
    },
    {
      problem: "One team needs more time",
      fix: "Grant that team a deadline extension. Other teams keep the original deadline, and the extension is recorded in the audit log.",
      path: "/settings#extensions",
    },
    {
      problem: "The same project was submitted twice",
      fix: "Mark the copy as a duplicate in moderation. It is excluded from results without deleting anything.",
      path: "/moderation",
    },
    {
      problem: "Results won't publish",
      fix: "Results can't be published while community voting is open. Close voting or wait for its deadline, then review any held votes.",
      path: "/settings#event",
    },
    {
      problem: "Judges split into groups that share no projects",
      fix: "Run the assignment engine again. It adds bridging reviews so every score can be put on one scale.",
      path: "#judges",
    },
  ];

const MARK: Record<Step["state"], string> = {
  done: "[x]",
  todo: "[ ]",
  waiting: "[ ]",
  skipped: "[-]",
};

export function playbookMarkdown({
  event: e,
  steps,
  judges,
  origin,
}: {
  event: Event;
  steps: Step[];
  judges: number;
  origin: string;
}): string {
  const base = `${origin}/organize/${e.slug}`;
  const api = `${origin}/api/v1/events/${e.id}`;
  const lines = [
    `# ${e.name}: organizer playbook`,
    "",
    `Generated ${when(new Date().toISOString())} from the event's live state.`,
    "",
    "## Event",
    "",
    `- Slug: \`${e.slug}\``,
    `- Command center: ${base}`,
    `- Public page: ${origin}/events/${e.slug}`,
    `- Submissions: ${when(e.submissions_open_at)} to ${when(e.submissions_close_at)}`,
    `- Judging closes: ${when(e.judging_close_at)}`,
    `- Voting: ${e.voting_open_at ? `${when(e.voting_open_at)} to ${when(e.voting_close_at)}` : "not scheduled"}`,
    `- Judges: ${judges} invited, ${e.reviews_per_project} reviews per project`,
    `- Rubric: ${(e.criteria ?? []).map((c) => `${c.name} (×${c.weight})`).join(", ") || "no criteria yet"}`,
    "",
    "## Checklist",
    "",
    ...steps.map(
      (s) =>
        `- ${MARK[s.state]} **${s.label}**${s.state === "waiting" ? " (waiting)" : s.state === "skipped" ? " (skipped)" : ""}: ${s.detail} ${base}${s.path}`,
    ),
    "",
    "## Inviting judges",
    "",
    `1. On the command center, create an invite link with the role "Judge" (${base}#invite).`,
    "2. Add the judge's email to make the link work only for that account.",
    "3. Send the link. The judge opens it, signs in or creates an account, and accepts; their assignments then appear at /judge.",
    `4. Once at least ${e.reviews_per_project} judges are in, run the assignment engine (${base}#judges).`,
    "",
    "## Exports",
    "",
    `- Every criterion score: ${api}/export/scores.csv`,
    `- Ranking with intervals: ${api}/export/results.csv`,
    `- Full event, re-importable: ${api}/export.json`,
    `- Signed, pseudonymized results bundle: ${api}/results/bundle`,
    "",
    "## Troubleshooting",
    "",
    ...TROUBLESHOOTING.flatMap((t) => [
      `### ${t.problem}`,
      "",
      `${t.fix} ${base}${t.path}`,
      "",
    ]),
  ];
  return lines.join("\n");
}
