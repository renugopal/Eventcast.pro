"use client";

import Link from "next/link";
import { ExternalLink, MapPin, RefreshCw } from "lucide-react";
import { useAdminAuth } from "../_lib/useAdminAuth";
import { isRelevantForControlRoom, useLivestreamEvents, type LivestreamRosterItem } from "../_lib/livestreams";

function rosterDisplayTitle(row: Pick<LivestreamRosterItem, "groomName" | "brideName" | "celebrantName">): string {
  if (row.groomName || row.brideName) {
    return [row.groomName, row.brideName].filter(Boolean).join(" & ");
  }
  return row.celebrantName || "Untitled event";
}

function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return "Date not set";
  const date = new Date(`${dateStr}T00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Provider Console "Live Streams" roster (Livestream + YouTube + Live
 * Control Room delivery package, Baseline V2.1 DASH-002). Now backed by the
 * real `GET /api/livestreams` aggregate route — every chip below reflects an
 * actual `media_event_assignments`/`events.youtube_url` value, not a
 * hardcoded "Not available" placeholder. Full enable/end controls and
 * masked credentials live on each event's own Live Control Room tab, which
 * every row links into, rather than being duplicated here.
 */
export default function AdminV2LivestreamsPage() {
  const { studioId } = useAdminAuth();
  const { events, isLoading, isRefreshing, error, refresh } = useLivestreamEvents(studioId);

  const relevantEvents = events.filter(isRelevantForControlRoom);

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title">Live Streams</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            {relevantEvents.length} active or upcoming event{relevantEvents.length === 1 ? "" : "s"}
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={isRefreshing} className="ec-btn ec-btn-secondary">
          <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
          Could not load events: {error}
        </div>
      )}

      {isLoading ? (
        <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          Loading events…
        </div>
      ) : relevantEvents.length === 0 ? (
        <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          No active or upcoming events.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {relevantEvents.map((event) => (
            <LivestreamCard key={event.eventId} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function LivestreamCard({ event }: { event: LivestreamRosterItem }) {
  return (
    <div className="ec-card ec-card-sm" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: "var(--foreground)" }}>{rosterDisplayTitle(event)}</span>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <span>{event.eventType || "Event"}</span>
            <span>
              {formatDisplayDate(event.eventDate)}
              {event.eventTime ? ` · ${event.eventTime}` : ""}
            </span>
            {event.venueName && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <MapPin size={12} /> {event.venueName}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/events/${event.eventId}/live`} className="ec-btn ec-btn-primary ec-btn-sm">
            Live Control Room
          </Link>
          {event.slug && (
            <a
              href={`https://eventcast.pro/events/${event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ec-btn ec-btn-secondary ec-btn-sm"
            >
              <ExternalLink size={14} /> View page
            </a>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <StatusChip
          label="Private stream"
          value={event.livestreamEnabled ? "Enabled" : "Disabled"}
          tone={event.livestreamEnabled ? "positive" : "neutral"}
        />
        <StatusChip
          label="YouTube"
          value={event.youtubeConfigured ? "Linked" : "Not linked"}
          tone={event.youtubeConfigured ? "positive" : "neutral"}
        />
      </div>
    </div>
  );
}

type ChipTone = "positive" | "neutral" | "unknown";

const CHIP_COLORS: Record<ChipTone, { bg: string; color: string; border: string }> = {
  positive: { bg: "var(--success-50)", color: "var(--success)", border: "#A7F3D0" },
  neutral: { bg: "#F3F4F6", color: "#6B7280", border: "#E5E7EB" },
  unknown: { bg: "var(--surface-hover)", color: "var(--text-tertiary)", border: "var(--border-subtle)" },
};

function StatusChip({ label, value, tone }: { label: string; value: string; tone: ChipTone }) {
  const colors = CHIP_COLORS[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
      <span style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>{label}:</span>
      <span
        style={{
          fontWeight: 700,
          padding: "2px 8px",
          borderRadius: "999px",
          background: colors.bg,
          color: colors.color,
          border: `1px solid ${colors.border}`,
        }}
      >
        {value}
      </span>
    </span>
  );
}
