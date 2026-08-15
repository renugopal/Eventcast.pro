"use client";

import Link from "next/link";
import { usePlatformResource } from "../_lib/platformClient";
import { DataTable, PageHeading, ResourceGate, formatTimestamp } from "../_components/PlatformUI";

interface PlatformEventRow {
  id: string;
  slug: string;
  pageState: string;
  eventVisibility: string;
  scheduledStartAt: string | null;
  studioId: string;
  studioSlug: string | null;
  lifecycleStatus: string;
}

interface PlatformEventsResponse {
  events: PlatformEventRow[];
  page: number;
  pageSize: number;
  total: number;
}

export default function PlatformEventsPage() {
  const { resource } = usePlatformResource<PlatformEventsResponse>("/api/platform/events");

  return (
    <div>
      <PageHeading
        title="All Events"
        description="Every event across every studio. Open one to reach its operational drill-down: assignment state, activation provenance, recording and retention state, and the R2 cleanup dry run."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <div className="ec-card" style={{ padding: "16px" }}>
            <DataTable
              columns={["Studio", "Slug", "Lifecycle", "Page state", "Visibility", "Scheduled"]}
              emptyMessage="No events found."
              rows={data.events.map((event) => [
                <Link key={`s-${event.id}`} href={`/platform/studios/${event.studioId}`} style={{ color: "var(--primary)" }}>
                  {event.studioSlug ?? event.studioId}
                </Link>,
                <Link key={`e-${event.id}`} href={`/platform/events/${event.id}`} style={{ color: "var(--primary)", fontWeight: 600 }}>
                  {event.slug}
                </Link>,
                event.lifecycleStatus,
                event.pageState,
                event.eventVisibility,
                formatTimestamp(event.scheduledStartAt),
              ])}
            />
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "10px" }}>
              Showing {data.events.length} of {data.total}.
            </p>
          </div>
        )}
      </ResourceGate>
    </div>
  );
}
