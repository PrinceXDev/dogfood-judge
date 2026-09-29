import type { Metadata } from "next";
import Link from "next/link";
import { login } from "@/app/actions";
import { AuthShell } from "@/components/account/auth-shell";
import { PasswordField } from "@/components/account/password-field";
import {
  authErrorMessage,
  SocialSignIn,
} from "@/components/account/social-sign-in";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Field, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = String(sp.next ?? "/");
  const problem = authErrorMessage(
    typeof sp.error === "string" ? sp.error : undefined,
  );
  return (
    <AuthShell
      eyebrow="Sign in"
      title="Welcome back."
      sub="Pick up where the scoring left off."
      footer={
        <>
          <p>
            No account?{" "}
            <Link
              href={`/signup?next=${encodeURIComponent(next)}`}
              className="font-medium text-accent hover:underline"
            >
              Create one
            </Link>
            .
          </p>
          <p className="mt-2 flex gap-2">
            <Icon name="info" size={14} className="mt-[3px] shrink-0" />
            <span>
              Imported as a judge or participant? Ask an organizer for your
              activation link.
            </span>
          </p>
        </>
      }
    >
      {problem && (
        <p
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-md border border-bad/30 bg-bad/[0.07] px-3 py-2 text-sm text-ink"
        >
          <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-bad" />
          {problem}
        </p>
      )}
      <div className="mb-5">
        <SocialSignIn next={next} />
      </div>
      <ActionForm action={login}>
        <input type="hidden" name="next" value={next} />
        <Field label="Email">
          <input
            type="email"
            name="email"
            autoComplete="username"
            placeholder="you@example.org"
            required
            className={inputCls}
          />
        </Field>
        <Field label="Password">
          <PasswordField autoComplete="current-password" />
        </Field>
        <Submit variant="accent" className="mt-1 w-full">
          Sign in
          <Icon name="arrowRight" size={15} />
        </Submit>
      </ActionForm>
    </AuthShell>
  );
}
