import type { Metadata } from "next";
import { createEvent } from "@/app/actions";
import { EventForm } from "@/components/event-form";
import { Card, Page, PageHeader, Problem } from "@/components/ui";
import { requireMe } from "@/lib/api";

export const metadata: Metadata = { title: "New event" };

export default async function NewEvent() {
  const me = await requireMe("/organize/new");
  if (!me.can_create_events)
    return (
      <Page>
        <Problem
          error={{ status: 403, message: "Only admins can create events." }}
        />
      </Page>
    );
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const open = now.toISOString().slice(0, 16);
  const close = new Date(now.getTime() + 72 * 3600 * 1000)
    .toISOString()
    .slice(0, 16);
  return (
    <Page width="medium">
      <PageHeader
        eyebrow="New event"
        title={
          <>
            Start a hackathon worth{" "}
            <span className="font-serif font-normal italic text-accent">
              defending
            </span>
          </>
        }
        sub="Set the timeline and limits now; tracks, rubric weights, prizes and webhooks can all be changed later in settings. You'll land there once the event exists."
      />
      <Card className="sm:p-6">
        <EventForm action={createEvent} defaults={{ open, close }} />
      </Card>
    </Page>
  );
}
