"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, MapPin, PlusCircle } from "lucide-react";
import { useAdminAuth } from "../_lib/useAdminAuth";
import { categorizeEventLifecycle, eventDisplayTitle, useAdminEvents, type AdminEventRow, type EventLifecycle } from "../_lib/events";
import { EVENT_LIFECYCLE_BADGE_CLASSES, EVENT_LIFECYCLE_LABELS } from "@/lib/eventLifecycle";

/**
 * The authoritative Provider Events surface (V2.1 Milestone G), replacing
 * the parked preliminary list. Every tab is backed by the same lifecycle
 * dimensions the Event Workspace shell derives from (`page_state`,
 * `archived_at`, `scheduled_start_at`) — never date math alone claiming Live
 * or Completed (EVT-003). Each row opens the real, UUID-based Event
 * Workspace rather than local tab state.
 */
const LIFECYCLE_TABS: { id: EventLifecycle; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "upcoming", label: "Upcoming" },
  { id: "published", label: "Published" },
  { id: "archived", label: "Archived" },
];

function formatDisplayDate(row: Pick<AdminEventRow, "scheduled_start_at" | "event_date">): string {
  const source = row.scheduled_start_at ?? (row.event_date ? `${row.event_date}T00:00` : null);
  if (!source) return "Date not set";
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(
    date
  );
}

export default function AdminV2EventsPage() {
  const { studioId } = useAdminAuth();
  const { events, isLoading, error } = useAdminEvents(studioId);
  const [activeTab, setActiveTab] = useState<EventLifecycle>("upcoming");

  const grouped = useMemo(() => {
    const groups: Record<EventLifecycle, AdminEventRow[]> = { draft: [], upcoming: [], published: [], archived: [] };
    for (const event of events) {
      groups[categorizeEventLifecycle(event)].push(event);
    }
    return groups;
  }, [events]);

  const visibleEvents = grouped[activeTab];
  const totalNonArchived = events.length - grouped.archived.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title">Events</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            {totalNonArchived} active event{totalNonArchived === 1 ? "" : "s"}
          </p>
        </div>
        <Link href="/events/new" className="ec-btn ec-btn-primary">
          <PlusCircle size={16} />
          New Event
        </Link>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {LIFECYCLE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? "ec-btn ec-btn-primary ec-btn-sm" : "ec-btn ec-btn-secondary ec-btn-sm"}
          >
            {tab.label}
            <span className={`ec-badge ${EVENT_LIFECYCLE_BADGE_CLASSES[tab.id]}`} style={{ marginLeft: "6px", padding: "2px 8px" }}>
              {grouped[tab.id].length}
            </span>
          </button>
        ))}
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
      ) : visibleEvents.length === 0 ? (
        <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          No {LIFECYCLE_TABS.find((t) => t.id === activeTab)!.label.toLowerCase()} events yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleEvents.map((event) => (
            <div
              key={event.id}
              className="ec-card ec-card-sm"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, color: "var(--foreground)" }}>{eventDisplayTitle(event)}</span>
                  <span className={`ec-badge ${EVENT_LIFECYCLE_BADGE_CLASSES[categorizeEventLifecycle(event)]}`}>
                    {EVENT_LIFECYCLE_LABELS[categorizeEventLifecycle(event)]}
                  </span>
                </div>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <span>{event.event_type || "Event"}</span>
                  <span>{formatDisplayDate(event)}</span>
                  {event.venue_name && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <MapPin size={12} /> {event.venue_name}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Link href={`/events/${event.id}/overview`} className="ec-btn ec-btn-secondary ec-btn-sm">
                  Open
                </Link>
                {event.slug && event.page_state === "published" && (
                  <a
                    href={`https://eventcast.pro/events/${event.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ec-btn ec-btn-secondary ec-btn-sm"
                  >
                    <ExternalLink size={14} /> View live page
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
