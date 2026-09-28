import type { Metadata } from "next";
import Link from "next/link";
import { CopyField } from "@/components/forms";
import { Icon } from "@/components/icons";
import { VerifyConsole } from "@/components/trust/verify-console";
import { Eyebrow, Page, Section } from "@/components/ui";
import { apiRoot } from "@/lib/api";
import type { SigningKey } from "@/lib/types";

export const metadata: Metadata = { title: "Verify a record" };

export default async function Verify() {
  const key = await apiRoot<SigningKey>("/.well-known/dogfood-signing-key");
  const command = `dogfood verify-record record.json --key ${key.public_key}`;
  return (
    <Page width="wide">
      <header className="relative mb-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
        <div className="bg-grid pointer-events-none absolute -inset-x-4 -top-10 -z-10 h-72 [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        <div className="min-w-0 animate-rise">
          <Eyebrow className="mb-3">Trust · Ed25519</Eyebrow>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
            Verify <span className="font-serif font-normal italic">record</span>
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-ink-2">
            Judging records and participation certificates are signed by this
            portal. Paste one below to prove it hasn't been altered since it was
            issued. Nobody needs an account, and nothing you paste is stored.
          </p>
        </div>

        <section
          aria-labelledby="key-title"
          className="glow-edge min-w-0 animate-rise rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow)] [animation-delay:80ms]"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="key-title"
              className="flex items-center gap-2 text-[13px] font-medium"
            >
              <Icon name="key" size={14} className="text-accent" />
              Portal signing key
            </h2>
            <span className="rounded border border-line-strong px-1.5 py-px font-mono text-[10.5px] text-ink-2">
              {key.alg}
            </span>
          </div>
          <dl className="mt-3 grid gap-3">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                Key ID
              </dt>
              <dd className="mt-1 font-mono text-sm text-ink tabular">
                {key.key_id}
              </dd>
            </div>
            <div>
              <dt className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                Public key
              </dt>
              <dd>
                <CopyField value={key.public_key} />
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Published at{" "}
            <a
              href="/.well-known/dogfood-signing-key"
              className="font-mono text-ink-2 underline-offset-2 hover:text-accent hover:underline"
            >
              /.well-known/dogfood-signing-key
            </a>
          </p>
        </section>
      </header>

      <VerifyConsole keyId={key.key_id} />

      <Section
        eyebrow="Offline"
        title="Verify without trusting this server"
        desc="The check needs only the record and the public key above. Run it on your own machine with the Dogfood CLI; it never calls back to this portal."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <div className="overflow-hidden rounded-lg border border-line bg-sunken">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2 font-mono text-[11px] text-muted">
              <Icon name="terminal" size={13} />
              shell
            </div>
            <div className="p-3">
              <CopyField value={command} />
            </div>
          </div>
          <div className="text-sm leading-relaxed text-ink-2">
            Save the record as{" "}
            <code className="font-mono text-xs text-ink">record.json</code>{" "}
            first: use <span className="text-ink">Copy record</span> on any
            certificate, or find yours under{" "}
            <Link href="/certificates" className="text-accent hover:underline">
              Certificates
            </Link>
            .
          </div>
        </div>
      </Section>
    </Page>
  );
}
