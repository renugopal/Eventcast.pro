"use client";

import { usePlatformResource, type PlatformNotificationsResponse } from "../_lib/platformClient";
import { DataTable, PageHeading, ResourceGate, Section, UnavailableNote, formatTimestamp } from "../_components/PlatformUI";

export default function PlatformNotificationsPage() {
  const { resource } = usePlatformResource<PlatformNotificationsResponse>("/api/platform/notifications");

  return (
    <div>
      <PageHeading
        title="Notifications"
        description="Cross-tenant view of the in-app Notification Center. Notification bodies are not read by this operational surface — type, severity, title, and read state are what platform operations needs."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <div className="ec-card" style={{ padding: "16px" }}>
              <DataTable
                columns={["Studio", "Severity", "Type", "Title", "Deduped", "Read", "Created"]}
                emptyMessage="No notifications."
                rows={data.notifications.map((notification) => [
                  notification.studioSlug ?? notification.studioId,
                  notification.severity,
                  notification.notificationType,
                  notification.title,
                  notification.deduplicated ? "yes" : "no",
                  notification.readAt ? "yes" : "no",
                  formatTimestamp(notification.createdAt),
                ])}
              />
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "10px" }}>
                Showing {data.notifications.length} of {data.total}.
              </p>
            </div>

            <Section title="Outbound delivery">
              <UnavailableNote label="WhatsApp / SMS / email delivery" fact={data.outboundDelivery} />
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}
