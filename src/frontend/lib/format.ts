import type { Event } from "./types";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function when(iso: string | null | undefined): string {
  if (!iso) return "not set";
  return `${dateFmt.format(new Date(iso))} UTC`;
}

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 172800) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Value for <input type="datetime-local">, in UTC. */
export function inputTime(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16) : "";
}

export const f1 = (v: number) => v.toFixed(1);
export const f2 = (v: number) => v.toFixed(2);
export const pct = (v: number) => `${Math.round(100 * v)}%`;
export const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
export const signedf = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);

export function percent(a: number, b: number): number {
  return b === 0 ? 0 : Math.round((100 * a) / b);
}

export function phase(e: Event, now = new Date()): string {
  const t = now.getTime();
  const at = (s: string | null) => (s ? new Date(s).getTime() : null);
  const open = at(e.submissions_open_at) ?? 0;
  const close = at(e.submissions_close_at) ?? 0;
  const vo = at(e.voting_open_at);
  const vc = at(e.voting_close_at);
  const jc = at(e.judging_close_at);
  if (e.results_published_at) return "results published";
  if (t < open) return "upcoming";
  if (t < close) return "submissions open";
  if (vo !== null && vc !== null && t >= vo && t < vc)
    return "judging and voting";
  if (jc === null || t < jc) return "judging";
  return "awaiting results";
}

export function submissionsOpen(e: Event, now = new Date()) {
  const t = now.getTime();
  return (
    t >= new Date(e.submissions_open_at).getTime() &&
    t < new Date(e.submissions_close_at).getTime()
  );
}

export function judgingOpen(e: Event, now = new Date()) {
  const t = now.getTime();
  if (e.results_published_at) return false;
  if (t < new Date(e.submissions_close_at).getTime()) return false;
  return !e.judging_close_at || t < new Date(e.judging_close_at).getTime();
}

export function votingOpen(e: Event, now = new Date()) {
  if (!e.voting_open_at || !e.voting_close_at) return false;
  const t = now.getTime();
  return (
    t >= new Date(e.voting_open_at).getTime() &&
    t < new Date(e.voting_close_at).getTime()
  );
}
