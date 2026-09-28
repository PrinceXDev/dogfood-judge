import type { Metadata } from "next";
import type { ReactNode } from "react";
import { acceptInvite } from "@/app/actions";
import { AuthChoice, InviteCard } from "@/components/account/invite-card";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { DataList, Problem, Tag } from "@/components/ui";
import { getMe, load } from "@/lib/api";
import { when } from "@/lib/format";
import type { Event } from "@/lib/types";

export const metadata: Metadata = { title: "Invitation" };

type Info = {
  invitation: { email: string; role: string; expires_at: string };
  event: Event;
};

export default async function Invite({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const r = await load<Info>(
    `/invitations/${encodeURIComponent(token)}`,
    `/invite/${token}`,
  );
  if (!r.ok) return <Problem error={r.error} />;
  const { invitation, event } = r.data;
  const me = await getMe();
  const expired = new Date(invitation.expires_at).getTime() <= Date.now();
  return (
    <InviteCard
      eyebrow="Invitation"
      icon={invitation.role === "judge" ? "gavel" : "users"}
      title={
        <>
          You're invited as {/^[aeiou]/i.test(invitation.role) ? "an" : "a"}{" "}
          <span className="text-accent">{invitation.role}</span>
        </>
      }
      eventName={event.name}
      eventHref={`/events/${event.slug}`}
      details={
        <DataList
          className="rounded-lg border border-line bg-sunken px-4 py-3.5"
          items={[
            [
              "Role",
              <Tag key="r" tone="accent">
                {invitation.role}
              </Tag>,
            ],
            ...(invitation.email
              ? ([
                  [
                    "For",
                    <span key="e" className="font-mono text-[13px]">
                      {invitation.email}
                    </span>,
                  ],
                ] as [string, ReactNode][])
              : []),
            [
              "Expires",
              <span
                key="x"
                className={`font-mono text-[13px] tabular ${expired ? "text-bad" : ""}`}
              >
                {when(invitation.expires_at)}
                {expired && " (expired)"}
              </span>,
            ],
          ]}
        />
      }
    >
      {me ? (
        <ActionForm action={acceptInvite}>
          <input type="hidden" name="token" value={token} />
          <Submit variant="accent" size="lg" className="w-full">
            <Icon name="check" size={16} />
            Accept as {me.user.name}
          </Submit>
        </ActionForm>
      ) : (
        <AuthChoice next={`/invite/${token}`} verb="accept" />
      )}
    </InviteCard>
  );
}
