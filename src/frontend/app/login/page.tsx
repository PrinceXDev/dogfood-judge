import type { Metadata } from "next";
import Link from "next/link";
import { login } from "@/app/actions";
import { AuthShell } from "@/components/account/auth-shell";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Field, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: PageProps<"/login">) {
  const next = String((await searchParams).next ?? "/");
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
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            className={inputCls}
          />
        </Field>
        <Submit variant="accent" className="mt-1 w-full">
          Sign in
          <Icon name="arrowRight" size={15} />
        </Submit>
      </ActionForm>
    </AuthShell>
  );
}
