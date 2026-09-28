import type { Metadata } from "next";
import { RecordView } from "@/components/record";
import { BackLink, Page, Problem } from "@/components/ui";
import { load, requireMe } from "@/lib/api";
import type { RecordPayload, SignedRecord } from "@/lib/types";

export const metadata: Metadata = { title: "Certificate" };

export default async function Certificate({
  params,
}: PageProps<"/events/[event]/certificate">) {
  const { event } = await params;
  await requireMe(`/events/${event}/certificate`);
  const r = await load<{ record: SignedRecord; payload: RecordPayload }>(
    `/events/${event}/records/participant`,
    `/events/${event}/certificate`,
  );
  if (!r.ok) return <Problem error={r.error} />;
  return (
    <Page width="medium">
      <div className="no-print">
        <BackLink href={`/events/${event}`}>
          {r.data.payload.event_name}
        </BackLink>
      </div>
      <RecordView record={r.data.record} payload={r.data.payload} />
    </Page>
  );
}
