import Link from "next/link";
import { Icon } from "@/components/icons";
import { OrgNav } from "@/components/shell/org-nav";
import { StatusDot, Tag } from "@/components/ui";
import { ApiError, api, getMe, rolesIn } from "@/lib/api";
import { phase } from "@/lib/format";
import type { Event } from "@/lib/types";

// Chrome for every organizer page: event identity, phase, and the command
// center navigation. It only renders for the event's organizers (and admins);
// anyone else sees the page body, where the API's refusal is explained.
export default async function OrganizerLayout({
  children,
  params,
}: LayoutProps<"/organize/[event]">) {
  const { event } = await params;
  const [me, e] = await Promise.all([
    getMe(),
    api<Event>(`/events/${event}`).catch((err) => {
      if (err instanceof ApiError) return null;
      throw err;
    }),
  ]);
  const allowed =
    !!e && !!me && (rolesIn(me, e.id).organizer || me.user.is_admin);
  if (!e || !allowed) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        {children}
      </div>
    );
  }
  const ph = phase(e);
  const live = ph !== "results published" && ph !== "upcoming";
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <Link href="/dashboard" className="hover:text-ink">
              Organize
            </Link>
            <Icon name="chevronRight" size={11} />
            <span className="truncate">{e.slug}</span>
          </p>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-[-0.03em]">
            {e.name}
            <Tag
              tone={
                live
                  ? "accent"
                  : ph === "results published"
                    ? "good"
                    : "neutral"
              }
            >
              {live && <StatusDot tone="accent" pulse />}
              {ph}
            </Tag>
          </h1>
        </div>
        <Link
          href={`/events/${e.slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          Public page <Icon name="arrowUpRight" size={13} />
        </Link>
      </div>
      <div className="flex flex-col pt-6 lg:flex-row lg:gap-10 lg:pt-8">
        <OrgNav slug={e.slug} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
