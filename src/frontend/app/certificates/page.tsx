import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import type { NavEvent } from "@/components/shell/nav-data";
import { recordId, SignatureGlyph } from "@/components/trust/signature";
import { EmptyState, Page, PageHeader, Tag, type Tone } from "@/components/ui";
import { ApiError, api, requireMe } from "@/lib/api";
import { getNav } from "@/lib/nav";
import type { RecordPayload, SignedRecord } from "@/lib/types";

export const metadata: Metadata = { title: "Certificates & records" };

type Role = "judge" | "participant";
type Availability =
  | { ok: true; record: SignedRecord; payload: RecordPayload }
  | { ok: false; tone: Tone; label: string; why: string };

// When each record is issued is decided in src/core/records.go; the codes
// below are the refusals it can return, restated for the viewer.
function explain(role: Role, e: ApiError): Availability {
  const no = (tone: Tone, label: string, why: string): Availability => ({
    ok: false,
    tone,
    label,
    why,
  });
  switch (e.code) {
    case "not_published":
      return no(
        "warn",
        "After results",
        "Judging records are issued once the organizers publish results.",
      );
    case "event_running":
      return no(
        "warn",
        "After submissions close",
        "Certificates are issued once the submission window closes.",
      );
    case "nothing_to_certify":
      return role === "judge"
        ? no(
            "neutral",
            "Nothing to record",
            "You have no completed reviews or comparisons in this event.",
          )
        : no(
            "neutral",
            "No submission",
            "Certificates go to members of a team with a submitted project.",
          );
    case "not_found":
      return no(
        "neutral",
        "No team",
        "You're not on a team in this event, so there's no certificate to issue.",
      );
    default:
      return no("bad", "Unavailable", e.message);
  }
}

async function check(slug: string, role: Role): Promise<Availability> {
  try {
    const r = await api<{ record: SignedRecord; payload: RecordPayload }>(
      `/events/${slug}/records/${role}`,
    );
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return explain(role, e);
    throw e;
  }
}

const LABEL: Record<Role, { title: string; href: (s: string) => string }> = {
  judge: { title: "Judging record", href: (s) => `/judge/${s}/record` },
  participant: {
    title: "Participation certificate",
    href: (s) => `/events/${s}/certificate`,
  },
};

function RecordRow({
  event,
  role,
  a,
}: {
  event: NavEvent;
  role: Role;
  a: Availability;
}) {
  const l = LABEL[role];
  const summary = a.ok
    ? role === "judge"
      ? `${a.payload.reviews_completed ?? 0} reviews${a.payload.comparisons ? ` · ${a.payload.comparisons} comparisons` : ""}`
      : `${a.payload.project_title} · ${a.payload.team}`
    : a.why;
  const body = (
    <>
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-md border ${a.ok ? "border-accent/30 bg-accent/10 text-accent" : "border-line-strong bg-surface-2 text-muted"}`}
      >
        {a.ok ? (
          <SignatureGlyph signature={a.record.signature} size={24} />
        ) : (
          <Icon name={role === "judge" ? "gavel" : "trophy"} size={16} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-ink">{l.title}</p>
          {a.ok ? (
            <Tag tone="good" dot>
              Ready
            </Tag>
          ) : (
            <Tag tone={a.tone}>{a.label}</Tag>
          )}
        </div>
        <p
          className={`mt-0.5 text-sm ${a.ok ? "text-ink-2" : "text-muted"} break-words`}
        >
          {summary}
        </p>
      </div>
      {a.ok && (
        <div className="hidden text-right sm:block">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted">
            record ID
          </p>
          <p className="font-mono text-xs text-ink-2">
            {recordId(a.record.signature)}
          </p>
        </div>
      )}
      {a.ok && (
        <Icon
          name="arrowRight"
          size={16}
          className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
        />
      )}
    </>
  );
  const cls = "flex items-center gap-4 px-4 py-3.5 sm:px-5";
  return a.ok ? (
    <Link
      href={l.href(event.slug)}
      data-nav-item
      className={`group ${cls} transition-colors hover:bg-surface-hover`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default async function Certificates() {
  await requireMe("/certificates");
  const nav = await getNav();
  const events = nav.events.filter((e) => e.judge || e.participant);
  const rows = await Promise.all(
    events.map(async (e) => {
      const roles: Role[] = [
        ...(e.judge ? (["judge"] as const) : []),
        ...(e.participant ? (["participant"] as const) : []),
      ];
      const checks = await Promise.all(roles.map((r) => check(e.slug, r)));
      return {
        event: e,
        items: roles.map((r, i) => ({ role: r, a: checks[i] })),
      };
    }),
  );
  const ready = rows.flatMap((r) => r.items).filter((i) => i.a.ok).length;
  const total = rows.reduce((n, r) => n + r.items.length, 0);

  return (
    <Page width="medium">
      <PageHeader
        eyebrow="Trust"
        title={
          <>
            Certificates{" "}
            <span className="font-serif font-normal italic">&</span> records
          </>
        }
        sub="Signed proof of your judging and building. Each one verifies offline against the portal's public key, so you can share it anywhere."
        actions={
          <Link href="/verify" className={buttonClass("secondary")}>
            <Icon name="shieldCheck" size={14} />
            Verify a record
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="file"
          title="No certificates yet."
          action={
            <Link href="/events" className={buttonClass("secondary")}>
              Browse events
            </Link>
          }
        >
          Records are issued to judges and participants. Join a team or accept a
          judging invite, and yours will appear here.
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 font-mono text-xs text-muted tabular">
            <span className="text-ink">{ready}</span> of {total} ready ·{" "}
            {rows.length} event{rows.length === 1 ? "" : "s"}
          </p>
          <div className="grid gap-4">
            {rows.map(({ event, items }) => (
              <section
                key={event.id}
                aria-labelledby={`ev-${event.id}`}
                className="overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow)]"
              >
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/60 px-4 py-2.5 sm:px-5">
                  <h2 id={`ev-${event.id}`} className="text-[13px] font-medium">
                    <Link
                      href={`/events/${event.slug}`}
                      className="hover:text-accent"
                    >
                      {event.name}
                    </Link>
                  </h2>
                  <div className="flex items-center gap-2">
                    {event.published ? (
                      <Tag tone="accent" dot>
                        Results published
                      </Tag>
                    ) : (
                      <Tag>Results pending</Tag>
                    )}
                  </div>
                </header>
                <div className="divide-y divide-line">
                  {items.map(({ role, a }) => (
                    <RecordRow key={role} event={event} role={role} a={a} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
