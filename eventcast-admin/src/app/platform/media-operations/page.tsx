"use client";

import Link from "next/link";
import { usePlatformResource, type PlatformMediaOperationsResponse } from "../_lib/platformClient";
import { DataTable, PageHeading, ResourceGate, formatTimestamp } from "../_components/PlatformUI";

export default function PlatformMediaOperationsPage() {
  const { resource } = usePlatformResource<PlatformMediaOperationsResponse>("/api/platform/media-operations");

  return (
    <div>
      <PageHeading
        title="Media Operations"
        description="Every event that has a recording record, with its archive evidence, gap state, retention state, and R2 cleanup verdict. Guest Memories are counted only — no guest photo, uploader name, or caption is read by this console."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <div className="ec-card" style={{ padding: "16px" }}>
            <DataTable
              columns={[
                "Event",
                "Recording state",
                "Gaps",
                "B2 finalized",
                "Integrity verified",
                "Retention expires",
                "YouTube fallback",
                "R2 cleanup",
                "Guest Memories",
              ]}
              emptyMessage="No recording records exist yet."
              rows={data.recordings.map((recording) => [
                <Link
                  key={recording.eventId}
                  href={`/platform/events/${recording.eventId}`}
                  style={{ color: "var(--primary)", fontWeight: 600 }}
                >
                  {recording.eventSlug ?? recording.eventId}
                </Link>,
                recording.recordingState,
                `${recording.gapCount} (${recording.gapStatus})`,
                formatTimestamp(recording.b2FinalizedAt),
                formatTimestamp(recording.integrityVerifiedAt),
                recording.retentionExpiresAt
                  ? `${formatTimestamp(recording.retentionExpiresAt)}${recording.retentionExpired ? " (expired)" : ""}`
                  : "not frozen",
                recording.youtubeFallbackVerified ? "verified" : recording.youtubeFallbackUrl ? "unverified" : "none",
                recording.r2CleanupEligible ? "eligible (report only)" : "not eligible",
                `${recording.guestMemoryCount}${recording.guestMemoryPendingCount > 0 ? ` · ${recording.guestMemoryPendingCount} pending` : ""}`,
              ])}
            />
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "10px" }}>
              Showing {data.recordings.length} of {data.total}.
            </p>
          </div>
        )}
      </ResourceGate>
    </div>
  );
}
