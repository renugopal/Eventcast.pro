"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-auth";

interface EnabledStreamAssignmentRow {
  eventId: string;
  eventSlug: string | null;
  studioId: string | null;
  enabled: boolean;
  ingestPresent: boolean;
  playbackPresent: boolean;
  publishWindowStartAt: string | null;
  publishWindowEndAt: string | null;
  youtubeEnabled: boolean;
  updatedAt: string;
  liveStatus: "unavailable";
}

export default function PlatformStreamsPage() {
  const [rows, setRows] = useState<EnabledStreamAssignmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/platform/streams");
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          setError(json.error ?? "Failed to load enabled stream assignments");
          return;
        }
        setRows(json.enabledStreamAssignments);
      } catch {
        if (!cancelled) setError("Failed to load enabled stream assignments");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p style={{ color: "var(--error)" }}>{error}</p>;
  if (!rows) return <p style={{ color: "var(--text-secondary)" }}>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: "20px", fontWeight: 800, marginBottom: "4px" }}>Enabled Stream Assignments</h1>
      <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
        Shows assignments enabled for streaming. Genuine live/active status is not shown here — no
        authoritative live-session or telemetry source exists yet, so it is never inferred from "enabled".
      </p>

      <div className="ec-card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "10px" }}>Studio</th>
              <th style={{ padding: "10px" }}>Event</th>
              <th style={{ padding: "10px" }}>Ingest present</th>
              <th style={{ padding: "10px" }}>Playback present</th>
              <th style={{ padding: "10px" }}>YouTube enabled</th>
              <th style={{ padding: "10px" }}>Live status</th>
              <th style={{ padding: "10px" }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.eventId} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px" }}>{row.studioId ?? "—"}</td>
                <td style={{ padding: "10px" }}>{row.eventSlug ?? row.eventId}</td>
                <td style={{ padding: "10px" }}>{row.ingestPresent ? "Yes" : "No"}</td>
                <td style={{ padding: "10px" }}>{row.playbackPresent ? "Yes" : "No"}</td>
                <td style={{ padding: "10px" }}>{row.youtubeEnabled ? "Yes" : "No"}</td>
                <td style={{ padding: "10px", color: "var(--text-secondary)" }}>Unavailable</td>
                <td style={{ padding: "10px" }}>{row.updatedAt}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "16px", color: "var(--text-secondary)" }}>
                  No enabled stream assignments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
