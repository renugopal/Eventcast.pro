"use client";

import Link from "next/link";
import { usePlatformResource } from "../_lib/platformClient";
import { PageHeading, ResourceGate, Section, StatCard, StatGrid, UnavailableNote } from "../_components/PlatformUI";

interface OverviewResponse {
  overview: {
    studioCount: number;
    eventsByLifecycle: Record<string, number>;
    enabledStreamAssignmentCount: number;
    activeStreamCount: number | null;
    activeStreamCountUnavailableReason: string;
    nodes: { total: number; byStatus: Record<string, number>; inMaintenance: number; neverReportedHeartbeat: number };
    recordings: {
      total: number;
      b2Finalized: number;
      failed: number;
      gapsPendingReview: number;
      retentionFrozen: number;
      retentionExpired: number;
      youtubeFallbackVerified: number;
      r2CleanupEligible: number;
    };
    support: { total: number; open: number; urgentLiveOpen: number };
    notifications: { total: number; unread: number; critical: number };
  };
}

export default function PlatformOverviewPage() {
  const { resource } = usePlatformResource<OverviewResponse>("/api/platform/overview");

  return (
    <div>
      <PageHeading
        title="Platform Overview"
        description="Cross-tenant operational health. Every figure below is a real count of persisted rows; anything this platform cannot measure is reported as explicitly unavailable rather than estimated."
      />

      <ResourceGate resource={resource}>
        {({ overview }) => (
          <>
            <StatGrid>
              <StatCard label="Studios" value={overview.studioCount} />
              <StatCard label="Draft events" value={overview.eventsByLifecycle.draft ?? 0} />
              <StatCard label="Upcoming events" value={overview.eventsByLifecycle.upcoming ?? 0} />
              <StatCard label="Published events" value={overview.eventsByLifecycle.published ?? 0} />
              <StatCard label="Archived events" value={overview.eventsByLifecycle.archived ?? 0} />
              <StatCard
                label="Enabled stream assignments"
                value={overview.enabledStreamAssignmentCount}
                hint="Enabled, not proven ingesting"
              />
            </StatGrid>

            <Section title="Live streams">
              <UnavailableNote
                label="Active stream count"
                fact={{ available: false, reason: overview.activeStreamCountUnavailableReason }}
              />
              <p style={{ fontSize: "12px", marginTop: "10px" }}>
                <Link href="/platform/streams" style={{ color: "var(--primary)", fontWeight: 600 }}>
                  Open the enabled assignment roster →
                </Link>
              </p>
            </Section>

            <Section title="SRS / Media nodes">
              <StatGrid>
                <StatCard label="Registered nodes" value={overview.nodes.total} />
                <StatCard label="In maintenance" value={overview.nodes.inMaintenance} />
                <StatCard label="Never reported heartbeat" value={overview.nodes.neverReportedHeartbeat} />
                {Object.entries(overview.nodes.byStatus).map(([status, count]) => (
                  <StatCard key={status} label={`Nodes: ${status}`} value={count} />
                ))}
              </StatGrid>
            </Section>

            <Section
              title="Recordings, retention and storage"
              note="Recording and retention state is read from event_recordings and its RPCs — the same authority the Media Agent reports into and the retention freeze/extension mechanisms own."
            >
              <StatGrid>
                <StatCard label="Recording records" value={overview.recordings.total} />
                <StatCard label="B2 finalized" value={overview.recordings.b2Finalized} />
                <StatCard label="Failed finalizations" value={overview.recordings.failed} />
                <StatCard label="Gaps pending review" value={overview.recordings.gapsPendingReview} />
                <StatCard label="Retention frozen" value={overview.recordings.retentionFrozen} />
                <StatCard label="Retention expired" value={overview.recordings.retentionExpired} />
                <StatCard label="Verified YouTube fallback" value={overview.recordings.youtubeFallbackVerified} />
                <StatCard
                  label="R2 cleanup eligible"
                  value={overview.recordings.r2CleanupEligible}
                  hint="Report only — no deletion path"
                />
              </StatGrid>
            </Section>

            <Section title="Support and notifications">
              <StatGrid>
                <StatCard label="Support tickets" value={overview.support.total} />
                <StatCard label="Open tickets" value={overview.support.open} />
                <StatCard label="Open urgent-live tickets" value={overview.support.urgentLiveOpen} />
                <StatCard label="Notifications" value={overview.notifications.total} />
                <StatCard label="Unread notifications" value={overview.notifications.unread} />
                <StatCard label="Critical notifications" value={overview.notifications.critical} />
              </StatGrid>
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}
