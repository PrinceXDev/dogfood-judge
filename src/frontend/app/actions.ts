"use server";

import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, api, SESSION_COOKIE, sessionToken } from "@/lib/api";
import type { AssignReport } from "@/lib/types";

// Every mutation in the UI is a server action that forwards the caller's
// session to the Go API as a bearer token. Authorization is decided by Go;
// these functions only translate forms to JSON. Next.js checks the Origin of
// every server action call, which is the CSRF protection for this layer.

export type State = {
  error?: string;
  ok?: string;
  link?: string;
  secret?: string;
  lines?: string[];
} | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

async function attempt(fn: () => Promise<unknown>): Promise<State> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401)
        return { error: "Your session expired. Sign in again." };
      return { error: e.message };
    }
    throw e;
  }
}

async function origin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** datetime-local ("2026-09-28T18:00") → RFC 3339 UTC, or null when empty. */
function utc(v: string): string | null {
  if (!v) return null;
  return v.length === 16 ? `${v}:00Z` : v;
}

// ---------------------------------------------------------------------------
// Accounts

async function setSession(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.DOGFOOD_SECURE_COOKIES === "1",
    path: "/",
    maxAge: 14 * 24 * 3600,
  });
}

export async function login(_: State, fd: FormData): Promise<State> {
  let token = "";
  const err = await attempt(async () => {
    const r = await api<{ token: string }>("/auth/login", {
      method: "POST",
      token: null,
      body: {
        email: str(fd, "email"),
        password: String(fd.get("password") ?? ""),
      },
    });
    token = r.token;
  });
  if (err) return err;
  await setSession(token);
  redirect(safeNext(str(fd, "next")));
}

export async function signup(_: State, fd: FormData): Promise<State> {
  let token = "";
  const err = await attempt(async () => {
    const r = await api<{ token: string }>("/auth/signup", {
      method: "POST",
      token: null,
      body: {
        email: str(fd, "email"),
        name: str(fd, "name"),
        password: String(fd.get("password") ?? ""),
      },
    });
    token = r.token;
  });
  if (err) return err;
  await setSession(token);
  redirect(safeNext(str(fd, "next")));
}

export async function activate(_: State, fd: FormData): Promise<State> {
  let token = "";
  const err = await attempt(async () => {
    const r = await api<{ token: string }>(
      `/activate/${encodeURIComponent(str(fd, "token"))}`,
      {
        method: "POST",
        token: null,
        body: { password: String(fd.get("password") ?? "") },
      },
    );
    token = r.token;
  });
  if (err) return err;
  await setSession(token);
  redirect("/");
}

export async function logout() {
  if (await sessionToken()) {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}

export async function createToken(_: State, fd: FormData): Promise<State> {
  let token = "";
  const err = await attempt(async () => {
    token = (
      await api<{ token: string }>("/tokens", {
        method: "POST",
        body: { label: str(fd, "label") },
      })
    ).token;
  });
  return err ?? { ok: "Token created. It is shown once.", secret: token };
}

// ---------------------------------------------------------------------------
// Participants

export async function createTeam(_: State, fd: FormData): Promise<State> {
  const ev = str(fd, "event");
  const err = await attempt(() =>
    api(`/events/${ev}/teams`, {
      method: "POST",
      body: { name: str(fd, "name") },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Team created." };
}

export async function joinTeam(_: State, fd: FormData): Promise<State> {
  let eventId = "";
  const err = await attempt(async () => {
    eventId = (
      await api<{ event_id: string }>("/teams/join", {
        method: "POST",
        body: { token: str(fd, "token") },
      })
    ).event_id;
  });
  if (err) return err;
  redirect(`/events/${eventId}/team`);
}

export async function leaveTeam(_: State, fd: FormData): Promise<State> {
  const ev = str(fd, "event");
  const err = await attempt(() =>
    api(`/events/${ev}/team/leave`, { method: "POST" }),
  );
  if (err) return err;
  redirect(`/events/${ev}`);
}

export async function rotateInvite(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(`/events/${str(fd, "event")}/team/invite/rotate`, { method: "POST" }),
  );
  if (err) return err;
  refresh();
  return { ok: "New invite link created; the old one no longer works." };
}

export async function saveSubmission(_: State, fd: FormData): Promise<State> {
  const ev = str(fd, "event");
  const id = str(fd, "project_id");
  const submit = str(fd, "intent") === "submit";
  const body = {
    title: str(fd, "title"),
    summary: str(fd, "summary"),
    description: String(fd.get("description") ?? ""),
    repo_url: str(fd, "repo_url"),
    demo_url: str(fd, "demo_url"),
    track_id: str(fd, "track_id"),
    submit,
  };
  const err = await attempt(() =>
    id
      ? api(`/projects/${id}`, { method: "PATCH", body })
      : api(`/events/${ev}/projects`, { method: "POST", body }),
  );
  if (err) return err;
  refresh();
  return {
    ok: submit
      ? "Submitted. You can keep editing until the deadline."
      : "Draft saved.",
  };
}

export async function vote(_: State, fd: FormData): Promise<State> {
  const id = str(fd, "project");
  const undo = str(fd, "intent") === "unvote";
  const err = await attempt(() =>
    api(`/projects/${id}/vote`, { method: undo ? "DELETE" : "POST" }),
  );
  if (err) return err;
  refresh();
  return { ok: undo ? "Vote withdrawn." : "Vote recorded." };
}

export async function addComment(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(`/projects/${str(fd, "project")}/comments`, {
      method: "POST",
      body: { body: str(fd, "body") },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Comment posted." };
}

// ---------------------------------------------------------------------------
// Judges

export async function acceptInvite(_: State, fd: FormData): Promise<State> {
  let slug = "";
  const err = await attempt(async () => {
    slug = (
      await api<{ slug: string }>(
        `/invitations/${encodeURIComponent(str(fd, "token"))}/accept`,
        { method: "POST" },
      )
    ).slug;
  });
  if (err) return err;
  redirect(`/events/${slug}`);
}

export async function submitReview(_: State, fd: FormData): Promise<State> {
  const ev = str(fd, "event");
  const project = str(fd, "project");
  const scores: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("c_")) scores[k.slice(2)] = Number(v);
  }
  const err = await attempt(() =>
    api(`/events/${ev}/reviews/${project}`, {
      method: "PUT",
      body: { scores, comment: String(fd.get("comment") ?? "") },
    }),
  );
  if (err) return err;
  const next = str(fd, "next");
  redirect(next ? `/judge/${ev}/p/${next}` : "/judge");
}

export async function recuse(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(
      `/events/${str(fd, "event")}/assignments/${str(fd, "project")}/recuse`,
      {
        method: "POST",
        body: { reason: str(fd, "reason") },
      },
    ),
  );
  if (err) return err;
  redirect("/judge");
}

export async function compare(_: State, fd: FormData): Promise<State> {
  const ev = str(fd, "event");
  const err = await attempt(() =>
    api(`/events/${ev}/pairwise`, {
      method: "POST",
      body: { a: str(fd, "a"), b: str(fd, "b"), outcome: str(fd, "outcome") },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Recorded." };
}

// ---------------------------------------------------------------------------
// Organizers

function eventBody(fd: FormData) {
  const lines = (k: string) =>
    str(fd, k)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    name: str(fd, "name"),
    slug: str(fd, "slug"),
    description: String(fd.get("description") ?? ""),
    submissions_open_at: utc(str(fd, "submissions_open_at")),
    submissions_close_at: utc(str(fd, "submissions_close_at")),
    judging_close_at: utc(str(fd, "judging_close_at")),
    voting_open_at: utc(str(fd, "voting_open_at")),
    voting_close_at: utc(str(fd, "voting_close_at")),
    reviews_per_project: num(fd, "reviews_per_project"),
    max_team_size: num(fd, "max_team_size"),
    votes_per_voter: num(fd, "votes_per_voter"),
    is_public: fd.get("is_public") === "on",
    tracks: lines("tracks"),
    criteria: lines("criteria"),
  };
}

export async function createEvent(_: State, fd: FormData): Promise<State> {
  let slug = "";
  const err = await attempt(async () => {
    slug = (
      await api<{ slug: string }>("/events", {
        method: "POST",
        body: eventBody(fd),
      })
    ).slug;
  });
  if (err) return err;
  redirect(`/organize/${slug}/settings`);
}

export async function updateEvent(_: State, fd: FormData): Promise<State> {
  let slug = "";
  const err = await attempt(async () => {
    slug = (
      await api<{ slug: string }>(`/events/${str(fd, "event")}`, {
        method: "PATCH",
        body: eventBody(fd),
      })
    ).slug;
  });
  if (err) return err;
  redirect(`/organize/${slug}/settings?saved=1`);
}

export async function addTrack(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(`/events/${str(fd, "event")}/tracks`, {
      method: "POST",
      body: { name: str(fd, "name") },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Track added." };
}

export async function addPrize(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(`/events/${str(fd, "event")}/prizes`, {
      method: "POST",
      body: {
        name: str(fd, "name"),
        value: str(fd, "value"),
        track_id: str(fd, "track_id"),
      },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Prize added." };
}

export async function saveRubric(_: State, fd: FormData): Promise<State> {
  const ev = str(fd, "event");
  const err = await attempt(async () => {
    const name = str(fd, "new_name");
    if (name) {
      await api(`/events/${ev}/criteria`, {
        method: "POST",
        body: { name, weight: Number(fd.get("new_weight")) || 1 },
      });
    }
    const weights: Record<string, number> = {};
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("w_")) weights[k.slice(2)] = Number(v);
    }
    if (Object.keys(weights).length) {
      await api(`/events/${ev}/criteria/weights`, {
        method: "PUT",
        body: weights,
      });
    }
  });
  if (err) return err;
  refresh();
  return { ok: "Rubric saved. Results recompute from the raw scores." };
}

export async function grantExtension(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(`/events/${str(fd, "event")}/teams/${str(fd, "team")}/extension`, {
      method: "POST",
      body: { minutes: num(fd, "minutes"), reason: str(fd, "reason") },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Extension granted and recorded in the audit log." };
}

export async function invite(_: State, fd: FormData): Promise<State> {
  let token = "";
  const err = await attempt(async () => {
    const r = await api<{ invitation: { token: string } }>(
      `/events/${str(fd, "event")}/invitations`,
      {
        method: "POST",
        body: { email: str(fd, "email"), role: str(fd, "role") },
      },
    );
    token = r.invitation.token;
  });
  if (err) return err;
  return {
    ok: "Invitation link (single use, 14 days, shown once):",
    link: `${await origin()}/invite/${token}`,
  };
}

export async function activationLink(_: State, fd: FormData): Promise<State> {
  let url = "";
  const err = await attempt(async () => {
    const r = await api<{ url: string }>(
      `/events/${str(fd, "event")}/users/${str(fd, "user")}/activation`,
      {
        method: "POST",
      },
    );
    // The API builds the link from its own host; rebase it on the public origin.
    url = `${await origin()}/activate/${r.url.split("/activate/")[1]}`;
  });
  if (err) return err;
  return {
    ok: `Activation link for ${str(fd, "name")} (7 days, shown once):`,
    link: url,
  };
}

function assignLines(r: AssignReport): string[] {
  const out = [
    `${r.new?.length ?? 0} new assignment(s); judge load ${r.load_min}–${r.load_max}; ${r.components} connected judge group(s).`,
  ];
  if (r.underfilled?.length)
    out.push(
      `${r.underfilled.length} project(s) could not be filled: invite more judges.`,
    );
  if (r.off_track)
    out.push(`${r.off_track} assignment(s) outside the judges' tracks.`);
  return out;
}

export async function runAssignment(_: State, fd: FormData): Promise<State> {
  let lines: string[] = [];
  const err = await attempt(async () => {
    lines = assignLines(
      await api<AssignReport>(`/events/${str(fd, "event")}/assignments/run`, {
        method: "POST",
      }),
    );
  });
  if (err) return err;
  refresh();
  return { ok: "Assignment engine ran.", lines };
}

export async function runTiebreak(_: State, fd: FormData): Promise<State> {
  let lines: string[] = [];
  const err = await attempt(async () => {
    const r = await api<{
      candidates: { title: string; prob_top_k: number }[] | null;
      assign: AssignReport;
    }>(`/events/${str(fd, "event")}/assignments/tiebreak`, {
      method: "POST",
      body: { max: 5 },
    });
    const c = r.candidates ?? [];
    lines = c.length
      ? [
          `${r.assign.new?.length ?? 0} tie-breaker review(s) for ${c.length} project(s) on the prize boundary:`,
          ...c.map(
            (x) => `${x.title}: P(top k) ${Math.round(100 * x.prob_top_k)}%`,
          ),
        ]
      : [
          "No project is on the prize boundary (every P(top k) is below 5% or above 95%). Nothing to add.",
        ];
  });
  if (err) return err;
  refresh();
  return { ok: "Tie-breaker round.", lines };
}

export async function publish(_: State, fd: FormData): Promise<State> {
  const published = str(fd, "publish") === "1";
  const err = await attempt(() =>
    api(`/events/${str(fd, "event")}/publish`, {
      method: "POST",
      body: { published },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: published ? "Results published." : "Results hidden again." };
}

export async function moderateProject(_: State, fd: FormData): Promise<State> {
  const id = str(fd, "project");
  const intent = str(fd, "intent");
  const err = await attempt(async () => {
    if (intent === "disqualify") {
      await api(`/projects/${id}/disqualify`, {
        method: "POST",
        body: { reason: str(fd, "reason") },
      });
    } else if (intent === "reinstate") {
      await api(`/projects/${id}/disqualify`, {
        method: "POST",
        body: { reason: "" },
      });
      await api(`/projects/${id}/duplicate`, {
        method: "POST",
        body: { of: "" },
      });
    } else {
      await api(`/projects/${id}/duplicate`, {
        method: "POST",
        body: { of: str(fd, "of") },
      });
    }
  });
  if (err) return err;
  refresh();
  return { ok: "Project updated." };
}

export async function reviewVote(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(`/events/${str(fd, "event")}/votes/review`, {
      method: "POST",
      body: {
        user: str(fd, "user"),
        project: str(fd, "project"),
        approve: str(fd, "approve") === "1",
      },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Done." };
}

export async function hideComment(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(`/comments/${str(fd, "comment")}/hide`, {
      method: "POST",
      body: { hidden: str(fd, "hide") === "1" },
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Done." };
}

export async function createWebhook(_: State, fd: FormData): Promise<State> {
  let secret = "";
  const err = await attempt(async () => {
    secret =
      (
        await api<{ secret: string }>(`/events/${str(fd, "event")}/webhooks`, {
          method: "POST",
          body: {
            url: str(fd, "url"),
            topics: fd.getAll("topics").map(String),
          },
        })
      ).secret ?? "";
  });
  if (err) return err;
  refresh();
  return { ok: "Webhook added. Signing secret (shown once):", secret };
}

export async function deleteWebhook(_: State, fd: FormData): Promise<State> {
  const err = await attempt(() =>
    api(`/events/${str(fd, "event")}/webhooks/${str(fd, "id")}`, {
      method: "DELETE",
    }),
  );
  if (err) return err;
  refresh();
  return { ok: "Webhook removed." };
}

// ---------------------------------------------------------------------------
// Public

export async function verifyRecord(_: State, fd: FormData): Promise<State> {
  const raw = String(fd.get("record") ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "That is not a record: paste the JSON exactly as issued." };
  }
  const rec = (parsed as { record?: unknown }).record ?? parsed;
  try {
    const r = await api<{
      valid: boolean;
      reason?: string;
      payload?: Record<string, unknown>;
    }>("/records/verify", {
      method: "POST",
      token: null,
      body: rec,
    });
    if (!r.valid) return { error: r.reason ?? "Not valid." };
    const p = r.payload ?? {};
    return {
      ok: "Valid: signed by this portal.",
      lines: Object.entries(p)
        .filter(([k]) => k !== "type" && k !== "key_id")
        .map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`),
    };
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    throw e;
  }
}
