"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-auth";

interface AuditLogEntry {
  id: string;
  actorUserId: string;
  actorPlatformRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  beforeState: unknown;
  afterState: unknown;
  createdAt: string;
}

export default function PlatformAuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/platform/audit-log");
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          setError(json.error ?? "Failed to load the audit log");
          return;
        }
        setEntries(json.entries);
      } catch {
        if (!cancelled) setError("Failed to load the audit log");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p style={{ color: "var(--error)" }}>{error}</p>;
  if (!entries) return <p style={{ color: "var(--text-secondary)" }}>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: "20px", fontWeight: 800, marginBottom: "16px" }}>Audit Log</h1>

      <div className="ec-card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "10px" }}>When</th>
              <th style={{ padding: "10px" }}>Action</th>
              <th style={{ padding: "10px" }}>Target</th>
              <th style={{ padding: "10px" }}>Reason</th>
              <th style={{ padding: "10px" }}>Before → After</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px" }}>{entry.createdAt}</td>
                <td style={{ padding: "10px" }}>{entry.action}</td>
                <td style={{ padding: "10px" }}>
                  {entry.targetType}: {entry.targetId ?? "—"}
                </td>
                <td style={{ padding: "10px" }}>{entry.reason ?? "—"}</td>
                <td style={{ padding: "10px", fontFamily: "monospace", fontSize: "11px" }}>
                  {JSON.stringify(entry.beforeState)} → {JSON.stringify(entry.afterState)}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "16px", color: "var(--text-secondary)" }}>
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
