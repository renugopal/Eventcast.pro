"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Users } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { fetchStudioAnalytics, type StudioAnalyticsSummary } from "@/lib/analyticsClient";

/**
 * Provider Console Analytics surface (Baseline V2.1 DASH-002, Milestone J).
 * Account-level roster of real, per-event analytics summaries, each linking
 * into that event's own Event Workspace Analytics tab for the full
 * breakdown. Deliberately simple: no decorative charts or cross-event
 * metric that can't be derived truthfully from stored data (ANA-001).
 */
export default function AdminV2AnalyticsPage() {
  const [summary, setSummary] = useState<StudioAnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStudioAnalytics(authFetch)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title">Analytics</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            Real page-view and EventCast livestream audience analytics across your events.
          </p>
        </div>
      </div>

      {error && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {!summary && !error ? (
        <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading…</div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="ec-card">
              <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                <Eye size={14} /> Total page views (all events)
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{summary.totals.totalPageViews}</div>
            </div>
            <div className="ec-card">
              <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                <Users size={14} /> Unique visitors (all events)
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{summary.totals.totalUniqueVisitors}</div>
            </div>
            <div className="ec-card">
              <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                <Users size={14} /> Current livestream viewers (all events)
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{summary.totals.totalCurrentViewers}</div>
            </div>
          </div>

          <div className="ec-card" style={{ padding: 0, overflow: "hidden" }}>
            {summary.events.length === 0 ? (
              <div style={{ padding: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>No events yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-subtle)" }}>
                      <th style={{ padding: "10px 12px" }}>Event</th>
                      <th style={{ padding: "10px 12px" }}>Page views</th>
                      <th style={{ padding: "10px 12px" }}>Unique visitors</th>
                      <th style={{ padding: "10px 12px" }}>Wishes</th>
                      <th style={{ padding: "10px 12px" }}>Guest Memories</th>
                      <th style={{ padding: "10px 12px" }}>Current viewers</th>
                      <th style={{ padding: "10px 12px" }}>Total unique viewers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.events.map((row) => (
                      <tr key={row.eventId} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <Link href={`/events/${row.eventId}/analytics`} style={{ fontWeight: 600 }}>
                            {row.displayName}
                          </Link>
                        </td>
                        <td style={{ padding: "10px 12px" }}>{row.totalPageViews}</td>
                        <td style={{ padding: "10px 12px" }}>{row.uniqueVisitors}</td>
                        <td style={{ padding: "10px 12px" }}>{row.wishesCount}</td>
                        <td style={{ padding: "10px 12px" }}>{row.guestMemoriesCount}</td>
                        <td style={{ padding: "10px 12px" }}>{row.currentViewers}</td>
                        <td style={{ padding: "10px 12px" }}>{row.totalUniqueViewers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
