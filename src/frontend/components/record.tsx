import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { CopyField, PrintButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { publicOrigin } from "@/components/trust/origin";
import {
  fingerprint,
  recordId,
  SignatureGlyph,
} from "@/components/trust/signature";
import { Eyebrow, Section } from "@/components/ui";
import type { RecordPayload, SignedRecord } from "@/lib/types";

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function issuedDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dayFmt.format(d);
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// Print is always light, whatever theme is on screen. Scoped to the
// certificate so the rest of the print sheet keeps the global print rules.
const printCss = `
@page { margin: 12mm; }
@media print {
  .dj-cert {
    --surface: #ffffff; --surface-2: #f8f9f7; --bg: #ffffff;
    --line: #e2e6e1; --line-strong: #cdd3cc;
    --ink: #0a100e; --ink-2: #3b4643; --muted: #6a7470;
    --accent: #00987a; --accent-2: #0a86a8; --grid: rgb(10 16 14 / 0.05);
    box-shadow: none !important;
    break-inside: avoid;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}`;

function Achievement({ payload }: { payload: RecordPayload }) {
  const strong = (c: ReactNode) => (
    <span className="font-medium text-ink">{c}</span>
  );
  if (payload.role === "judge") {
    const reviews = payload.reviews_completed ?? 0;
    const comps = payload.comparisons ?? 0;
    return (
      <>
        served as a judge at {strong(payload.event_name)}, completing{" "}
        {strong(plural(reviews, "review"))}
        {comps > 0 && <> and {strong(plural(comps, "pairwise comparison"))}</>}.
      </>
    );
  }
  return (
    <>
      built and submitted {strong(payload.project_title)}
      {payload.team && <> with team {strong(payload.team)}</>} at{" "}
      {strong(payload.event_name)}.
    </>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** Corner registration marks, like a proof sheet. */
function Corners() {
  const c = "pointer-events-none absolute size-3 border-accent/70";
  return (
    <>
      <span className={`${c} left-3 top-3 border-l border-t`} />
      <span className={`${c} right-3 top-3 border-r border-t`} />
      <span className={`${c} bottom-3 left-3 border-b border-l`} />
      <span className={`${c} bottom-3 right-3 border-b border-r`} />
    </>
  );
}

export async function RecordView({
  record,
  payload,
}: {
  record: SignedRecord;
  payload: RecordPayload;
}) {
  const json = JSON.stringify(record);
  const origin = await publicOrigin();
  const id = recordId(record.signature);
  const judge = payload.role === "judge";
  const kind = judge ? "Judging record" : "Certificate of participation";

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static print CSS, no user input */}
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
      <article
        aria-label={kind}
        className="dj-cert relative animate-rise overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[var(--shadow)]"
      >
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent" />
        <div className="relative m-2 rounded-lg border border-line sm:m-3">
          <Corners />
          <div className="px-6 py-8 sm:px-12 sm:py-12">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex shrink-0"
                  style={
                    {
                      "--logo-body": "var(--accent)",
                      "--logo-ink": "var(--surface)",
                    } as CSSProperties
                  }
                >
                  <LogoMark size={36} title="Dogfood Judge" />
                </span>
                <div className="leading-tight">
                  <p className="text-[15px] font-semibold tracking-[-0.03em]">
                    Dogfood Judge
                  </p>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
                    {kind}
                  </p>
                </div>
              </div>
              <div className="rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-right">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">
                  record ID
                </p>
                <p className="font-mono text-sm font-medium tracking-[0.08em] text-ink tabular">
                  {id}
                </p>
              </div>
            </header>

            <div className="mx-auto mt-12 max-w-xl text-center sm:mt-16">
              <Eyebrow className="justify-center">{payload.event_name}</Eyebrow>
              <p className="mt-8 text-[15px] text-ink-2">
                {judge ? "This records that" : "This certifies that"}
              </p>
              <h1 className="mt-3 text-balance break-words font-serif text-5xl leading-[1.05] tracking-[-0.01em] text-ink sm:text-6xl">
                {payload.name}
              </h1>
              <div className="mx-auto mt-5 h-px w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
              <p className="mt-5 text-pretty text-base leading-relaxed text-ink-2 sm:text-[17px]">
                <Achievement payload={payload} />
              </p>
            </div>

            <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-6 sm:mt-16 sm:grid-cols-4">
              <Meta label="Issued">
                <time dateTime={payload.issued_at}>
                  {issuedDay(payload.issued_at)}
                </time>
              </Meta>
              <Meta label="Signed with">
                Ed25519
                <span className="block font-mono text-xs text-ink-2">
                  {payload.key_id}
                </span>
              </Meta>
              <Meta label="Event">
                <span className="font-mono text-xs">{payload.event_id}</span>
              </Meta>
              <Meta label="Verify at">
                <span className="break-all font-mono text-xs text-accent">
                  {origin.replace(/^https?:\/\//, "")}/verify
                </span>
              </Meta>
            </dl>

            <div className="mt-6 flex items-center gap-4 rounded-md border border-line bg-surface-2/70 p-3">
              <SignatureGlyph
                signature={record.signature}
                size={52}
                className="text-accent"
              />
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  Signature fingerprint
                </p>
                <p className="mt-1 break-all font-mono text-xs tracking-[0.04em] text-ink-2 tabular">
                  {fingerprint(record.signature)}
                </p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
                  This page is a rendering. The signed record is what verifies:
                  paste it at {origin}/verify or check it offline with the
                  portal's public key.
                </p>
              </div>
            </div>

            {/* On paper, carry the full record so the sheet stays verifiable. */}
            <p className="mt-4 hidden break-all font-mono text-[6.5pt] leading-snug text-muted print:block">
              {json}
            </p>
          </div>
        </div>
      </article>

      <div className="no-print mt-6 flex flex-wrap items-center gap-2">
        <PrintButton label="Print or save as PDF" />
        <Link href="/verify" className={buttonClass("secondary")}>
          <Icon name="shieldCheck" size={14} />
          Verify this record
        </Link>
        <Link href="/certificates" className={buttonClass("ghost")}>
          All certificates
        </Link>
      </div>

      <Section
        className="no-print"
        eyebrow="Machine-verifiable"
        title="Signed record"
        desc={
          <>
            The payload is the exact bytes that were signed; the signature is
            Ed25519 over those bytes. Change one character and it fails. Anyone
            can check it at{" "}
            <Link href="/verify" className="text-accent hover:underline">
              /verify
            </Link>{" "}
            or offline with{" "}
            <code className="font-mono text-[13px]">dogfood verify-record</code>
            .
          </>
        }
      >
        <div className="grid gap-3">
          <CopyField value={json} label="Copy record" />
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken p-4 font-mono text-xs leading-relaxed text-ink-2">
            <span className="text-muted">{"{"}</span>
            {"\n"}
            {(["payload", "signature", "key_id"] as const).map((k, i) => (
              <span key={k}>
                {"  "}
                <span className="text-accent">"{k}"</span>
                <span className="text-muted">: </span>
                <span className="break-all">"{record[k]}"</span>
                {i < 2 ? "," : ""}
                {"\n"}
              </span>
            ))}
            <span className="text-muted">{"}"}</span>
          </pre>
        </div>
      </Section>
    </>
  );
}
