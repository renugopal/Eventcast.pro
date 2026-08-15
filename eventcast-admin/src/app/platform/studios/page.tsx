"use client";

import Link from "next/link";
import { usePlatformResource, type PlatformStudiosResponse } from "../_lib/platformClient";
import { DataTable, PageHeading, ResourceGate, Section, UnavailableNote, formatTimestamp } from "../_components/PlatformUI";

export default function PlatformStudiosPage() {
  const { resource } = usePlatformResource<PlatformStudiosResponse>("/api/platform/studios");

  return (
    <div>
      <PageHeading
        title="Users & Studios"
        description="Every tenant account on the platform. Membership is shown as user ids and roles only — no email addresses, phone numbers, or other contact details are read by this surface."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <div className="ec-card" style={{ padding: "16px" }}>
              <DataTable
                columns={["Studio", "Slug", "Plan", "Members", "Events", "Retention override", "Created"]}
                emptyMessage="No studios found."
                rows={data.studios.map((studio) => [
                  <Link
                    key={studio.id}
                    href={`/platform/studios/${studio.id}`}
                    style={{ color: "var(--primary)", fontWeight: 600 }}
                  >
                    {studio.displayName}
                  </Link>,
                  studio.slug,
                  studio.planTier,
                  studio.memberCount,
                  studio.eventCount,
                  studio.retentionOverrideDays != null ? `${studio.retentionOverrideDays} days` : "global default",
                  formatTimestamp(studio.createdAt),
                ])}
              />
            </div>

            <Section title="Account lifecycle controls">
              <UnavailableNote label="Suspend / restore / sessions / entitlements" fact={data.accountControls} />
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}
