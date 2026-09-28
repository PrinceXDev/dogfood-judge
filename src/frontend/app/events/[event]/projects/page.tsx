import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/button";
import { Gallery } from "@/components/gallery";
import { Icon } from "@/components/icons";
import { BackLink, Page, PageHeader, Problem } from "@/components/ui";
import { load } from "@/lib/api";
import type { Event } from "@/lib/types";

export const metadata: Metadata = { title: "Projects" };

export default async function EventGallery({
  params,
  searchParams,
}: PageProps<"/events/[event]/projects">) {
  const { event } = await params;
  const sp = await searchParams;
  const one = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const r = await load<Event>(`/events/${event}`, `/events/${event}/projects`);
  if (!r.ok) return <Problem error={r.error} />;
  const e = r.data;
  return (
    <Page>
      <BackLink href={`/events/${e.slug}`}>{e.name}</BackLink>
      <PageHeader
        eyebrow={e.name}
        title="Projects"
        sub={
          e.results_published_at
            ? "Results are published. Rankings live on the results page."
            : "Everything submitted to this event. Judges' scores stay private until results are published."
        }
        actions={
          e.results_published_at ? (
            <Link
              href={`/events/${e.slug}/results`}
              className={buttonClass("secondary")}
            >
              <Icon name="trophy" size={14} />
              Results
            </Link>
          ) : undefined
        }
      />
      <Gallery
        event={e}
        search={{ q: one("q"), track: one("track"), page: one("page") }}
      />
    </Page>
  );
}
