"use client";

import { type ChangeEvent, type ReactNode, useState } from "react";
import { Field, inputCls } from "@/components/ui";

// The event's date fields plus a live track of the phases they define. The
// inputs are plain named fields, so the form still posts without JavaScript;
// the track is rendered from the saved values on the server and follows edits
// after hydration.

type Key =
  | "submissions_open_at"
  | "submissions_close_at"
  | "judging_close_at"
  | "voting_open_at"
  | "voting_close_at";

type Values = Record<Key, string>;

const ms = (v: string) =>
  v ? Date.parse(v.length === 16 ? `${v}:00Z` : `${v}Z`) : Number.NaN;

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const d = (t: number) => fmt.format(new Date(t));

function span(a: number, b: number) {
  const h = Math.round((b - a) / 3_600_000);
  if (h < 48) return `${h}h`;
  const days = Math.floor(h / 24);
  return h % 24 ? `${days}d ${h % 24}h` : `${days}d`;
}

export function PhaseTimeline({
  initial,
  now,
}: {
  initial: Values;
  now: string;
}) {
  const [v, setV] = useState<Values>(initial);
  const set = (k: Key) => (e: ChangeEvent<HTMLInputElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  const open = ms(v.submissions_open_at);
  const close = ms(v.submissions_close_at);
  const jc = ms(v.judging_close_at);
  const vo = ms(v.voting_open_at);
  const vc = ms(v.voting_close_at);
  const t = Date.parse(now);

  const known = [open, close, jc, vo, vc].filter((x) => !Number.isNaN(x));
  const warnings: string[] = [];
  if (!Number.isNaN(open) && !Number.isNaN(close) && close <= open)
    warnings.push("Submissions close before they open.");
  if (!Number.isNaN(jc) && !Number.isNaN(close) && jc <= close)
    warnings.push("Judging closes before submissions do.");
  if (!Number.isNaN(vo) && !Number.isNaN(vc) && vc <= vo)
    warnings.push("Community voting closes before it opens.");
  if (Number.isNaN(vo) !== Number.isNaN(vc))
    warnings.push("Community voting needs both an opening and a closing time.");

  let track: ReactNode = null;
  if (known.length >= 2 && !Number.isNaN(open) && !Number.isNaN(close)) {
    const lo0 = Math.min(...known);
    let hi0 = Math.max(...known);
    // Open-ended judging gets a tail so it's visible past the last date.
    if (Number.isNaN(jc)) hi0 += Math.max((hi0 - lo0) * 0.12, 3_600_000);
    const pad = (hi0 - lo0) * 0.03 || 3_600_000;
    const lo = lo0 - pad;
    const hi = hi0 + pad;
    const x = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`;
    const w = (a: number, b: number) =>
      `${Math.max(((b - a) / (hi - lo)) * 100, 0.6)}%`;
    const lanes: {
      name: string;
      a: number;
      b: number;
      cls: string;
      note: string;
      open?: boolean;
    }[] = [
      {
        name: "Submissions",
        a: open,
        b: close,
        cls: "bg-accent",
        note: close > open ? span(open, close) : "invalid",
      },
      {
        name: "Judging",
        a: close,
        b: Number.isNaN(jc) ? hi0 : jc,
        cls: "bg-info",
        note: Number.isNaN(jc)
          ? "until results are published"
          : jc > close
            ? span(close, jc)
            : "invalid",
        open: Number.isNaN(jc),
      },
    ];
    if (!Number.isNaN(vo) && !Number.isNaN(vc))
      lanes.push({
        name: "Voting",
        a: vo,
        b: vc,
        cls: "bg-accent-2",
        note: vc > vo ? span(vo, vc) : "invalid",
      });
    const showNow = t >= lo && t <= hi;
    track = (
      <div className="relative">
        <div className="grid gap-2.5">
          {lanes.map((l) => (
            <div
              key={l.name}
              className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink">{l.name}</p>
                <p
                  className={`truncate font-mono text-[10.5px] ${l.note === "invalid" ? "text-bad" : "text-muted"}`}
                >
                  {l.note}
                </p>
              </div>
              <div className="relative h-5 rounded-sm bg-line/50">
                {l.b > l.a && (
                  <div
                    className={`absolute inset-y-0 rounded-sm ${l.cls} ${l.open ? "[mask-image:linear-gradient(90deg,black_60%,transparent)]" : ""} opacity-80`}
                    style={{ left: x(l.a), width: w(l.a, l.b) }}
                    title={`${l.name}: ${d(l.a)} → ${l.open ? "open-ended" : d(l.b)} UTC`}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        {showNow && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-5 bottom-0 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 inset-x-0 sm:grid-cols-[8rem_minmax(0,1fr)]"
          >
            <span />
            <span className="relative">
              <span
                className="absolute inset-y-0 w-px bg-ink"
                style={{ left: x(t) }}
              >
                <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded-sm bg-ink px-1 font-mono text-[9.5px] leading-4 text-bg">
                  now
                </span>
              </span>
            </span>
          </div>
        )}
        <div className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 font-mono text-[10.5px] text-muted sm:grid-cols-[8rem_minmax(0,1fr)]">
          <span />
          <span className="flex justify-between gap-2">
            <span>{d(lo0)}</span>
            <span>
              {Number.isNaN(jc) ? `${d(Math.max(...known))} +` : d(hi0)}
            </span>
          </span>
        </div>
      </div>
    );
  }

  const field = (
    k: Key,
    label: string,
    opts: { required?: boolean; hint?: string } = {},
  ) => (
    <Field label={label} hint={opts.hint}>
      <input
        type="datetime-local"
        name={k}
        required={opts.required}
        value={v[k]}
        onChange={set(k)}
        className={`${inputCls} font-mono tabular`}
      />
    </Field>
  );

  return (
    <div className="grid gap-5">
      <div className="rounded-md border border-line bg-sunken/60 p-4 pt-6">
        {track ?? (
          <p className="text-center text-xs text-muted">
            Set when submissions open and close to see the timeline.
          </p>
        )}
        {warnings.length > 0 && (
          <ul role="alert" className="mt-4 grid gap-1 text-xs text-warn">
            {warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("submissions_open_at", "Submissions open (UTC)", {
          required: true,
        })}
        {field("submissions_close_at", "Submissions close (UTC)", {
          required: true,
        })}
      </div>
      {field("judging_close_at", "Judging closes (UTC)", {
        hint: "Optional: publishing results also closes judging.",
      })}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("voting_open_at", "Community voting opens")}
        {field("voting_close_at", "Community voting closes")}
      </div>
    </div>
  );
}
