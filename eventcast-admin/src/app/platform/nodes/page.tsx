"use client";

import { usePlatformResource, type PlatformNodesResponse } from "../_lib/platformClient";
import {
  DataTable,
  PageHeading,
  ResourceGate,
  Section,
  UnavailableNote,
  formatBytes,
  formatTimestamp,
} from "../_components/PlatformUI";

export default function PlatformNodesPage() {
  const { resource } = usePlatformResource<PlatformNodesResponse>("/api/platform/nodes");

  return (
    <div>
      <PageHeading
        title="SRS / Media Nodes"
        description="Registered media nodes with their real persisted operational state. Node credentials are never read by this console, and no restart, disconnect, or raw SRS action is exposed here."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <div className="ec-card" style={{ padding: "16px" }}>
              <DataTable
                columns={[
                  "Node",
                  "Region",
                  "Status",
                  "Maintenance",
                  "Capacity",
                  "Enabled assignments",
                  "Disk free",
                  "R2 queue",
                  "Heartbeat",
                  "Version",
                ]}
                emptyMessage="No media nodes registered."
                rows={data.nodes.map((node) => [
                  <span key={node.id}>
                    <strong>{node.name}</strong>
                    <br />
                    <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{node.ingestHostname}</span>
                  </span>,
                  node.region,
                  node.status,
                  node.maintenanceMode ? "yes" : "no",
                  `${node.activeStreamCount} / ${node.hardStreamLimit}`,
                  node.enabledAssignmentCount,
                  formatBytes(node.diskFreeBytes),
                  formatBytes(node.r2QueueBytes),
                  node.lastHeartbeatAt
                    ? `${formatTimestamp(node.lastHeartbeatAt)} (${node.heartbeatAgeMinutes}m ago)`
                    : "never reported",
                  node.softwareVersion ?? "—",
                ])}
              />
            </div>

            {data.nodes.length > 0 && (
              <Section title="Resource telemetry">
                <UnavailableNote label="CPU / memory / network" fact={data.nodes[0].resourceTelemetry} />
              </Section>
            )}
          </>
        )}
      </ResourceGate>
    </div>
  );
}
