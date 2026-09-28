import type { Metadata } from "next";
import Link from "next/link";
import { signup } from "@/app/actions";
import { AuthShell } from "@/components/account/auth-shell";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Field, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Create account" };

export default async function Signup({ searchParams }: PageProps<"/signup">) {
  const next = String((await searchParams).next ?? "/");
  return (
    <AuthShell
      eyebrow="Create account"
      title="Join the pack."
      sub="One account for building, judging and organizing."
      footer={
        <>
          <p>
            Already have an account?{" "}
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="font-medium text-accent hover:underline"
            >
              Sign in
            </Link>
            .
          </p>
          <p className="mt-2 flex gap-2">
            <Icon name="info" size={14} className="mt-[3px] shrink-0" />
            <span>
              Imported as a judge or participant? You already have an account:
              ask an organizer for your activation link.
            </span>
          </p>
        </>
      }
    >
      <ActionForm action={signup}>
        <input type="hidden" name="next" value={next} />
        <Field label="Name">
          <input
            name="name"
            maxLength={80}
            autoComplete="name"
            required
            className={inputCls}
          />
        </Field>
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
          Create account
          <Icon name="arrowRight" size={15} />
        </Submit>
      </ActionForm>
    </AuthShell>
  );
}
