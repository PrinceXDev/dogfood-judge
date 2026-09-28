import type { Metadata } from "next";
import { joinTeam } from "@/app/actions";
import { AuthChoice, InviteCard } from "@/components/account/invite-card";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Problem } from "@/components/ui";
import { getMe, load } from "@/lib/api";
import type { Event } from "@/lib/types";

export const metadata: Metadata = { title: "Join team" };

type Invite = {
  team: { id: string; name: string; members: string[] };
  event: Event;
};

export default async function Join({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const r = await load<Invite>(
    `/teams/invite/${encodeURIComponent(token)}`,
    `/join/${token}`,
  );
  if (!r.ok) return <Problem error={r.error} />;
  const { team, event } = r.data;
  const members = team.members ?? [];
  const max = event.max_team_size;
  const full = members.length >= max;
  const me = await getMe();
  return (
    <InviteCard
      eyebrow="Team invite"
      icon="users"
      title={<>Join {team.name}</>}
      eventName={event.name}
      eventHref={`/events/${event.slug}`}
      details={
        <div className="rounded-lg border border-line bg-sunken px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">Members</p>
            <p className="font-mono text-sm tabular text-ink">
              {members.length}
              <span className="text-muted">/{max}</span>
            </p>
          </div>
          <div aria-hidden="true" className="mt-2 flex gap-1">
            {Array.from({ length: max }, (_, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: one slot per seat
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i < members.length ? "bg-accent" : "bg-line"}`}
              />
            ))}
          </div>
          {members.length > 0 && (
            <ul className="mt-3.5 flex flex-wrap gap-1.5">
              {members.map((m) => (
                <li
                  key={m}
                  className="flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-[13px]"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-5 place-items-center rounded-full bg-accent/15 font-mono text-[10px] font-medium uppercase text-accent"
                  >
                    {m.charAt(0)}
                  </span>
                  {m}
                </li>
              ))}
            </ul>
          )}
          {full && (
            <p className="mt-3 text-xs text-warn">
              This team is full; the server will refuse new members.
            </p>
          )}
        </div>
      }
    >
      {me ? (
        <ActionForm action={joinTeam}>
          <input type="hidden" name="token" value={token} />
          <Submit variant="accent" size="lg" className="w-full">
            <Icon name="users" size={16} />
            Join team as {me.user.name}
          </Submit>
        </ActionForm>
      ) : (
        <AuthChoice next={`/join/${token}`} verb="join" />
      )}
    </InviteCard>
  );
}
