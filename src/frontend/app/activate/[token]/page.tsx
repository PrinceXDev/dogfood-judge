import type { Metadata } from "next";
import { activate } from "@/app/actions";
import { AuthShell } from "@/components/account/auth-shell";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Field, inputCls, Problem } from "@/components/ui";
import { load } from "@/lib/api";

export const metadata: Metadata = { title: "Activate account" };

export default async function Activate({
  params,
}: PageProps<"/activate/[token]">) {
  const { token } = await params;
  const r = await load<{ email: string; name: string }>(
    `/activate/${encodeURIComponent(token)}`,
    "/",
  );
  if (!r.ok) return <Problem error={r.error} />;
  return (
    <AuthShell
      eyebrow="Activate"
      title="Activate your account"
      sub={
        <>
          You were added
          {r.data.name && (
            <>
              {" "}
              as <span className="text-ink">{r.data.name}</span>
            </>
          )}{" "}
          with{" "}
          <span className="font-mono text-[13px] text-ink">{r.data.email}</span>
          . Choose a password to sign in.
        </>
      }
      footer={
        <p className="flex gap-2">
          <Icon name="info" size={14} className="mt-[3px] shrink-0" />
          <span>
            If this link stops working, ask an organizer for a new activation
            link.
          </span>
        </p>
      }
    >
      <ActionForm action={activate}>
        <input type="hidden" name="token" value={token} />
        {/* Lets password managers save the new password against this email. */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={r.data.email}
          readOnly
          hidden
        />
        <Field label="Password" hint="At least 10 characters.">
          <input
            type="password"
            name="password"
            minLength={10}
            autoComplete="new-password"
            required
            className={inputCls}
          />
        </Field>
        <Submit variant="accent" className="mt-1 w-full">
          Activate
          <Icon name="arrowRight" size={15} />
        </Submit>
      </ActionForm>
    </AuthShell>
  );
}
