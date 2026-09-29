import { Icon } from "@/components/icons";
import { api } from "@/lib/api";

// Sign in with an identity provider. Only providers the operator configured
// are listed (GET /auth/providers); with none, as on a default offline
// instance, this renders nothing and the email form stands alone. The links
// are plain navigations: the Go API runs the OAuth round trip and comes back
// with a session cookie, or to /login?error=… (see authErrorMessage).

export type Provider = { id: string; name: string };

export async function providers(): Promise<Provider[]> {
  return (
    (await api<Provider[] | null>("/auth/providers", { token: null }).catch(
      () => [],
    )) ?? []
  );
}

// Monochrome marks, drawn in currentColor, except Google's, whose brand rules
// require the four-colour G on sign-in buttons.
function Mark({ id }: { id: string }) {
  switch (id) {
    case "google":
      return (
        <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      );
    case "github":
      return (
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="currentColor"
        >
          <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57l-.02-2.04c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3" />
        </svg>
      );
    case "linkedin":
      return (
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="currentColor"
        >
          <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13Zm1.78 13.02H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
        </svg>
      );
    case "x":
      return (
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="currentColor"
        >
          <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.6l5.24 6.93ZM17.61 20.64h2.04L6.49 3.24H4.3Z" />
        </svg>
      );
    default:
      return <Icon name="key" size={16} />;
  }
}

export async function SocialSignIn({
  next,
  verb = "Continue",
}: {
  next: string;
  verb?: string;
}) {
  const list = await providers();
  if (!list.length) return null;
  const q = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <div className="grid gap-3">
      <p className="text-xs font-medium text-ink-2">{verb} with</p>
      <div className={`grid gap-2 ${list.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {list.map((p) => (
          <a
            key={p.id}
            href={`/api/v1/auth/${p.id}/start${q}`}
            className="flex h-10 items-center justify-center gap-2.5 rounded-md border border-line-strong bg-surface-2 px-3 text-sm font-medium text-ink transition-[background-color,border-color] duration-150 hover:border-muted/60 hover:bg-surface-hover"
          >
            <Mark id={p.id} />
            <span aria-hidden="true">{p.name}</span>
            <span className="sr-only">
              {verb} with {p.name}
            </span>
          </a>
        ))}
      </div>
      <p className="text-center text-[11px] leading-relaxed text-muted">
        You'll be sent to the provider to confirm. We only receive your name and
        a verified email address.
      </p>
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-muted">
        <span className="h-px flex-1 bg-line" />
        or with email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

/** Words for the error codes the OAuth callback redirects with. */
export function authErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  const name = (id: string) =>
    ({ github: "GitHub", google: "Google", linkedin: "LinkedIn", x: "X" })[
      id
    ] ?? id;
  if (code.startsWith("oauth_email_")) {
    const p = name(code.slice("oauth_email_".length));
    return `${p} didn't share a verified email address, so we can't match you to an account. Verify your email with ${p}, or sign in with email and password.`;
  }
  return (
    {
      oauth_unavailable: "That sign-in option isn't set up on this portal.",
      oauth_denied:
        "Sign-in was cancelled at the provider, and nothing was shared. You can try again or use email.",
      oauth_state:
        "That sign-in attempt expired or was started in another tab. Please try again.",
      oauth_failed:
        "We couldn't finish signing you in with the provider. Try again in a moment, or use email.",
      rate_limited:
        "Too many sign-in attempts from here. Wait a minute and try again.",
    }[code] ?? null
  );
}
