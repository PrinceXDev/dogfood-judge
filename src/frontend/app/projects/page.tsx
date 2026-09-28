import type { Metadata } from "next";
import { Gallery } from "@/components/gallery";
import { Page, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Gallery" };

export default async function GalleryPage({
  searchParams,
}: PageProps<"/projects">) {
  const sp = await searchParams;
  const one = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  return (
    <Page>
      <PageHeader
        eyebrow="Gallery"
        title={
          <>
            Every submission,{" "}
            <span className="font-serif font-normal italic text-accent">
              in the open
            </span>
            .
          </>
        }
        sub="Browse what teams built across public events. Search by title, team, summary or track."
      />
      <Gallery
        search={{
          q: one("q"),
          track: one("track"),
          event: one("event"),
          page: one("page"),
        }}
      />
    </Page>
  );
}
