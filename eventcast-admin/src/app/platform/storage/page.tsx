"use client";

import Link from "next/link";
import { usePlatformResource, type PlatformStorageResponse } from "../_lib/platformClient";
import {
  PageHeading,
  ResourceGate,
  Section,
  StatCard,
  StatGrid,
  UnavailableNote,
  formatBytes,
} from "../_components/PlatformUI";

export default function PlatformStoragePage() {
  const { resource } = usePlatformResource<PlatformStorageResponse>("/api/platform/storage");

  return (
    <div>
      <PageHeading
        title="Storage"
        description="Storage is a Super Admin surface only — it is deliberately never shown to a normal provider in V1. Every figure here comes from a column this platform actually persists; anything unmeasured says so."
      />

      <ResourceGate resource={resource}>
        {({ storage }) => (
          <>
            <Section title="Guest Memories (measured)">
              <StatGrid>
                <StatCard label="Guest photos" value={storage.guestPhotoCount} />
                <StatCard label="Total size" value={formatBytes(storage.guestPhotoBytes)} />
                <StatCard
                  label="Rows without a recorded size"
                  value={storage.guestPhotoRowsWithoutSize}
                  hint="Excluded from the total above"
                />
              </StatGrid>
            </Section>

            <Section title="Media nodes (measured)">
              <StatGrid>
                <StatCard label="Reported disk free" value={formatBytes(storage.nodeDiskFreeBytes)} />
                <StatCard label="Reported R2 upload queue" value={formatBytes(storage.nodeR2QueueBytes)} />
              </StatGrid>
            </Section>

            <Section title="Recordings and retention (measured)">
              <StatGrid>
                <StatCard label="With a B2 archive" value={storage.recordingsWithB2Archive} />
                <StatCard label="Retention frozen" value={storage.recordingsRetentionFrozen} />
                <StatCard label="Retention expired" value={storage.recordingsRetentionExpired} />
                <StatCard label="R2 cleanup eligible" value={storage.r2CleanupEligibleCount} />
              </StatGrid>
              <p style={{ fontSize: "12px", marginTop: "10px" }}>
                <Link href="/platform/r2-cleanup" style={{ color: "var(--primary)", fontWeight: 600 }}>
                  Open the R2 cleanup report →
                </Link>
              </p>
            </Section>

            <Section title="Object storage totals">
              <UnavailableNote label="Media R2 object bytes" fact={storage.r2MediaObjectBytes} />
              <UnavailableNote label="B2 archive object bytes" fact={storage.b2ArchiveObjectBytes} />
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}
