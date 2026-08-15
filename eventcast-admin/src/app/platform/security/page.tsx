"use client";

import Link from "next/link";
import { usePlatformResource, type PlatformSecurityResponse } from "../_lib/platformClient";
import {
  DataTable,
  PageHeading,
  ResourceGate,
  Section,
  StatCard,
  StatGrid,
  UnavailableNote,
  formatTimestamp,
} from "../_components/PlatformUI";

export default function PlatformSecurityPage() {
  const { resource } = usePlatformResource<PlatformSecurityResponse>("/api/platform/security");

  return (
    <div>
      <PageHeading
        title="Security"
        description="Who holds a platform role, and what audited platform activity has recently occurred. Phone numbers, passwords, OTP values, session tokens, and provisioning credentials are never read by this surface."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <Section title="Platform roles">
              <DataTable
                columns={["User id", "Platform role", "Mobile verified", "Since"]}
                emptyMessage="No platform users."
                rows={data.platformUsers.map((user) => [
                  <code key={user.userId}>{user.userId}</code>,
                  user.platformRole === "super_admin" ? (
                    <strong style={{ color: "var(--primary)" }}>super_admin</strong>
                  ) : (
                    user.platformRole
                  ),
                  user.mobileVerified ? "yes" : "no",
                  formatTimestamp(user.createdAt),
                ])}
              />
            </Section>

            <Section
              title="Recent audited activity"
              note={`Aggregated over the most recent ${data.auditActivity.sampleSize} audit entries — not an all-time total.`}
            >
              <StatGrid>
                <StatCard label="Entries sampled" value={data.auditActivity.sampleSize} />
                <StatCard label="Most recent" value={formatTimestamp(data.auditActivity.mostRecentAt)} />
                <StatCard label="Distinct actors" value={Object.keys(data.auditActivity.byActor).length} />
              </StatGrid>

              <div style={{ marginTop: "12px" }}>
                <DataTable
                  columns={["Action", "Count"]}
                  emptyMessage="No audited actions recorded yet."
                  rows={Object.entries(data.auditActivity.byAction)
                    .sort((a, b) => b[1] - a[1])
                    .map(([action, count]) => [action, count])}
                />
              </div>

              <p style={{ fontSize: "12px", marginTop: "10px" }}>
                <Link href="/platform/audit-log" style={{ color: "var(--primary)", fontWeight: 600 }}>
                  Open the full audit log →
                </Link>
              </p>
            </Section>

            <Section title="Session management">
              <UnavailableNote label="Session listing / revocation" fact={data.sessionControls} />
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}
