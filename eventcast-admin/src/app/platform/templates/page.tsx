"use client";

import { usePlatformResource, type PlatformTemplatesResponse } from "../_lib/platformClient";
import { DataTable, PageHeading, ResourceGate, Section, UnavailableNote } from "../_components/PlatformUI";

export default function PlatformTemplatesPage() {
  const { resource } = usePlatformResource<PlatformTemplatesResponse>("/api/platform/templates");

  return (
    <div>
      <PageHeading
        title="Templates"
        description="The canonical template registry reconciled against the template ids events actually reference. A template id in use but not registered is shown as such rather than silently mapped onto a fallback template."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <div className="ec-card" style={{ padding: "16px" }}>
              <DataTable
                columns={["Template id", "Version", "Event types", "Registered", "Events using it"]}
                emptyMessage="No templates registered or in use."
                rows={data.templates.map((template) => [
                  <code key={template.templateId}>{template.templateId}</code>,
                  template.templateVersion ?? "unknown",
                  template.eventTypes.length > 0 ? template.eventTypes.join(", ") : "—",
                  template.registered ? (
                    "yes"
                  ) : (
                    <span style={{ color: "var(--error)", fontWeight: 600 }}>no — unregistered id in use</span>
                  ),
                  template.eventCount,
                ])}
              />
            </div>

            <Section title="Template management">
              <UnavailableNote label="Deployment / editing / version publishing" fact={data.mutation} />
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}
