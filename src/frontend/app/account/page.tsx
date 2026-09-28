import type { Metadata } from "next";
import Link from "next/link";
import { createToken, logout } from "@/app/actions";
import { Preferences } from "@/components/account/preferences";
import { buttonClass } from "@/components/button";
import { ActionForm, Submit } from "@/components/forms";
import { Icon, type IconName } from "@/components/icons";
import {
  DataList,
  Field,
  inputCls,
  Kbd,
  Page,
  PageHeader,
  Panel,
  Tag,
} from "@/components/ui";
import { requireMe } from "@/lib/api";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: "profile", label: "Profile", icon: "users" },
  { id: "preferences", label: "Preferences", icon: "settings" },
  { id: "tokens", label: "API tokens", icon: "key" },
  { id: "shortcuts", label: "Keyboard", icon: "command" },
];

// Mirrors the global keyboard layer in components/shell/command-palette.tsx.
const SHORTCUTS: [string[], string][] = [
  [["⌘", "K"], "Command palette (Ctrl K on Windows and Linux)"],
  [["G", "D"], "Go to dashboard"],
  [["G", "E"], "Go to events"],
  [["G", "P"], "Go to projects"],
  [["G", "J"], "Go to judging"],
  [["G", "R"], "Go to results"],
  [["G", "C"], "Go to certificates"],
  [["J"], "Next item in a list"],
  [["K"], "Previous item in a list"],
  [["?"], "Show every shortcut"],
];

export default async function Account() {
  const me = await requireMe("/account");
  const count = { organizer: 0, judge: 0, participant: 0 };
  for (const roles of Object.values(me.roles ?? {})) {
    for (const r of roles) count[r]++;
  }
  const roleTags = (Object.keys(count) as (keyof typeof count)[]).filter(
    (r) => count[r] > 0,
  );

  return (
    <Page width="medium">
      <PageHeader
        eyebrow="Settings"
        title="Account settings"
        sub="Your profile, how the interface looks, and credentials for the API."
      />
      <div className="grid gap-8 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="md:sticky md:top-24 md:self-start"
        >
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  data-nav-item
                  className="flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <Icon name={s.icon} size={14} className="text-muted" />
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-6">
          <Panel id="profile" title="Profile" icon="users" bodyClass="p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent/10 text-lg font-semibold uppercase text-accent"
              >
                {me.user.name.charAt(0)}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
                  {me.user.name}
                  {me.user.is_admin && (
                    <Tag tone="good" dot>
                      admin
                    </Tag>
                  )}
                </p>
                <p className="truncate font-mono text-[13px] text-ink-2">
                  {me.user.email}
                </p>
              </div>
            </div>
            <DataList
              className="mt-5 border-t border-line pt-4"
              items={[
                [
                  "User ID",
                  <span key="id" className="font-mono text-[13px]">
                    {me.user.id}
                  </span>,
                ],
                [
                  "Roles",
                  roleTags.length ? (
                    <span key="r" className="flex flex-wrap gap-1.5">
                      {roleTags.map((r) => (
                        <Tag key={r}>
                          {r} ·{" "}
                          <span className="font-mono tabular">{count[r]}</span>{" "}
                          {count[r] === 1 ? "event" : "events"}
                        </Tag>
                      ))}
                    </span>
                  ) : (
                    <span key="r" className="text-muted">
                      No event roles yet
                    </span>
                  ),
                ],
                [
                  "Create events",
                  <span key="c" className="text-ink-2">
                    {me.can_create_events ? "Allowed" : "Not allowed"}
                  </span>,
                ],
              ]}
            />
            <form action={logout} className="mt-5">
              <button type="submit" className={buttonClass("secondary", "sm")}>
                <Icon name="logOut" size={13} />
                Sign out
              </button>
            </form>
          </Panel>

          <Panel
            id="preferences"
            title="Preferences"
            icon="settings"
            aside={<span>Stored in this browser</span>}
            bodyClass="p-5"
          >
            <Preferences />
          </Panel>

          <Panel id="tokens" title="API tokens" icon="key" bodyClass="p-5">
            <p className="max-w-2xl text-sm leading-relaxed text-ink-2">
              Tokens act with your roles and never expire; treat them like
              passwords. Send one on every request to the{" "}
              <Link href="/docs/api" className="text-accent hover:underline">
                JSON API
              </Link>
              :
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-sunken px-3.5 py-2.5 font-mono text-xs leading-relaxed text-ink-2">
              <span className="text-muted">Authorization: </span>
              <span className="text-accent">Bearer</span> &lt;token&gt;
            </pre>
            <ActionForm
              action={createToken}
              className="mt-5 grid gap-3 border-t border-line pt-5"
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Field label="Label" hint="So you know what uses it.">
                    <input
                      name="label"
                      placeholder="e.g. results script"
                      maxLength={60}
                      className={inputCls}
                    />
                  </Field>
                </div>
                <Submit>
                  <Icon name="plus" size={14} />
                  Create token
                </Submit>
              </div>
            </ActionForm>
          </Panel>

          <Panel
            id="shortcuts"
            title="Keyboard"
            icon="command"
            aside={
              <span className="flex items-center gap-1.5">
                Press <Kbd>?</Kbd> anywhere
              </span>
            }
            bodyClass="p-0"
          >
            <ul className="divide-y divide-line">
              {SHORTCUTS.map(([keys, label]) => (
                <li
                  key={label}
                  className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm"
                >
                  <span className="text-ink-2">{label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {keys.map((k, i) => (
                      <span key={k} className="flex items-center gap-1">
                        {i > 0 && keys[0] === "G" && (
                          <span className="text-[11px] text-muted">then</span>
                        )}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
