"use client";

import Link from "next/link";
import { usePlatformResource, type PlatformR2CleanupResponse } from "../_lib/platformClient";
import {
  DataTable,
  PageHeading,
  ResourceGate,
  Section,
  StatCard,
  StatGrid,
  formatTimestamp,
} from "../_components/PlatformUI";

export default function PlatformR2CleanupPage() {
  const { resource } = usePlatformResource<PlatformR2CleanupResponse>("/api/platform/r2-cleanup");

  return (
    <div>
      <PageHeading
        title="R2 Cleanup"
        description="Eligibility report and dry run for reclaiming the R2 live/DVR copy once B2 holds the authoritative archive. This page has no delete action: nothing here calls a storage API, enumerates an object, or schedules a deletion."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <StatGrid>
              <StatCard label="Recordings evaluated" value={data.summary.total} />
              <StatCard label="Eligible" value={data.summary.eligible} hint="Report only" />
              <StatCard label="Not eligible" value={data.summary.notEligible} />
            </StatGrid>

            <Section
              title="Why no cleanup can be executed"
              note="Each item below independently blocks execution. These are statements of fact about the current system, not preferences — until they are resolved, this surface stays a report."
            >
              <ul style={{ fontSize: "13px", color: "var(--text-secondary)", paddingLeft: "18px" }}>
                {data.executionBlockers.map((blocker) => (
                  <li key={blocker} style={{ marginBottom: "8px" }}>
                    {blocker}
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: "13px", marginTop: "10px", fontWeight: 600 }}>
                The authoritative B2 archive is never a cleanup target under any circumstances.
              </p>
            </Section>

            <Section title="Per-event report">
              <DataTable
                columns={["Event", "Recording state", "Retention expires", "Eligible", "Candidate R2 prefixes", "Blocking reasons"]}
                emptyMessage="No recording records to evaluate."
                rows={data.reports.map((report) => [
                  <Link
                    key={report.eventId}
                    href={`/platform/events/${report.eventId}`}
                    style={{ color: "var(--primary)", fontWeight: 600 }}
                  >
                    {report.eventSlug ?? report.eventId}
                  </Link>,
                  report.recordingState,
                  formatTimestamp(report.retentionExpiresAt),
                  report.eligible ? "yes" : "no",
                  report.candidateR2Prefixes.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: "16px" }}>
                      {report.candidateR2Prefixes.map((prefix) => (
                        <li key={prefix}>
                          <code style={{ fontSize: "12px" }}>{prefix}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  ),
                  report.ineligibilityReasons.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: "16px", color: "var(--text-secondary)", fontSize: "12px" }}>
                      {report.ineligibilityReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  ),
                ])}
              />
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}
