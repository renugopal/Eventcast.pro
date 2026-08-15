"use client";

import { useEffect, useState } from "react";
import { BarChart3, Eye, Users, Radio, Clock } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { fetchEventAnalytics, formatSeconds, type EventAnalytics } from "@/lib/analyticsClient";
import { useEventWorkspace } from "../../../_components/event-workspace/EventWorkspaceShell";

/**
 * Event Workspace Analytics tab (Analytics + Provider operational/support/
 * auth delivery package, Baseline V2.1 Milestone J). Replaces the prior
 * "not implemented yet" placeholder with real data from
 * `GET /api/events/[eventId]/analytics` — page-view analytics (ANA-002)
 * and EventCast-private-stream audience analytics (ANA-003). ANA-001
 * ("no heuristic or fabricated metric") still governs this page: no QR-scan
 * figure is shown (that instrumentation doesn't exist yet — its absence is
 * never presented as a measured zero), and no technical stream metric
 * (resolution/FPS/bitrate/codecs/reconnects/source-relay health) is shown
 * here — those remain on the Live tab as explicitly "not yet measured".
 */

function BreakdownList({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-2">
      <h4 style={{ fontSize: "13px", fontWeight: 600 }}>{title}</h4>
      {entries.length === 0 ? (
        <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No data yet.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map(([key, count]) => (
            <div key={key} className="flex items-center justify-between" style={{ fontSize: "13px" }}>
              <span style={{ color: "var(--text-secondary)" }}>{key}</span>
              <span style={{ fontWeight: 600 }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string | number }) {
  return (
    <div className="ec-card" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
        <Icon size={14} /> {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export default function EventWorkspaceAnalyticsPage() {
  const { state } = useEventWorkspace();
  const eventId = state.status === "ready" ? state.event.id : null;

  const [analytics, setAnalytics] = useState<EventAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetchEventAnalytics(authFetch, eventId)
      .then((data) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (state.status !== "ready") return null;

  if (error) {
    return (
      <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
        {error}
      </div>
    );
  }

  if (!analytics) {
    return <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading…</div>;
  }

  const { pageAnalytics, audienceAnalytics } = analytics;

  return (
    <div className="flex flex-col gap-4">
      <div className="ec-card space-y-2">
        <h3 className="ec-section-title flex items-center gap-2">
          <BarChart3 size={16} /> Event-page analytics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile icon={Eye} label="Total page views" value={pageAnalytics.totalPageViews} />
          <StatTile icon={Users} label="Unique visitors" value={pageAnalytics.uniqueVisitors} />
          <StatTile icon={BarChart3} label="Wishes" value={pageAnalytics.wishesCount} />
          <StatTile icon={BarChart3} label="Guest Memories" value={pageAnalytics.guestMemoriesCount} />
        </div>
        {pageAnalytics.uniqueVisitorsCoverageNote && (
          <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{pageAnalytics.uniqueVisitorsCoverageNote}</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ marginTop: "8px" }}>
          <BreakdownList title="Referral source" data={pageAnalytics.referralBreakdown} />
          <BreakdownList title="Device" data={pageAnalytics.deviceBreakdown} />
          <BreakdownList title="Approximate geography" data={pageAnalytics.countryBreakdown} />
        </div>
      </div>

      <div className="ec-card space-y-2">
        <h3 className="ec-section-title flex items-center gap-2">
          <Radio size={16} /> EventCast livestream audience
        </h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Measured from real player heartbeats sent only while the EventCast private-stream player is genuinely
          playing — never from page-open counts or SRS connection counts, and source-separated from YouTube.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile icon={Users} label="Current viewers" value={audienceAnalytics.currentViewers} />
          <StatTile icon={Users} label="Peak concurrent viewers" value={audienceAnalytics.peakConcurrentViewers} />
          <StatTile icon={Users} label="Total unique viewers" value={audienceAnalytics.totalUniqueViewers} />
          <StatTile icon={Clock} label="Total watch time" value={formatSeconds(audienceAnalytics.totalWatchTimeSeconds)} />
        </div>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Average watch time per viewer: {formatSeconds(audienceAnalytics.averageWatchTimeSeconds)}
        </p>
        {audienceAnalytics.coverageNote && (
          <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>{audienceAnalytics.coverageNote}</p>
        )}
      </div>

      <div className="ec-card space-y-1">
        <h3 className="ec-section-title">Technical stream metrics</h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Resolution, FPS, bitrate, codecs, reconnects, and source/relay health remain unmeasured — see the Live tab.
          No authoritative source exists yet.
        </p>
      </div>
    </div>
  );
}
