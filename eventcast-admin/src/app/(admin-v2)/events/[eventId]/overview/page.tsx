"use client";

import Link from "next/link";
import { Calendar, LayoutGrid, MapPin } from "lucide-react";
import { useEventWorkspace } from "../../../_components/event-workspace/EventWorkspaceShell";

/**
 * Event Workspace Overview tab (V2.1 Milestone G): the workspace landing
 * surface. It shows identity/schedule/venue facts already loaded by the
 * shared shell and links into the other tabs — it does not duplicate the
 * Draft edit/Publish/SEO/Partner Credit controls, which remain the Event
 * Page tab's already-completed, tested responsibility.
 */
export default function EventWorkspaceOverviewPage() {
  const { state } = useEventWorkspace();
  if (state.status !== "ready") return null;
  const { event } = state;

  return (
    <div className="flex flex-col gap-4">
      <div className="ec-card space-y-3">
        <h3 className="ec-section-title flex items-center gap-2">
          <Calendar size={16} /> Schedule
        </h3>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
          {event.scheduled_start_at
            ? new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                dateStyle: "full",
                timeStyle: "short",
              }).format(new Date(event.scheduled_start_at))
            : "Not set"}
        </div>
      </div>

      <div className="ec-card space-y-3">
        <h3 className="ec-section-title flex items-center gap-2">
          <MapPin size={16} /> Venue &amp; Template
        </h3>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{event.venue_name || "Not set"}</div>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
          Template: {event.template_id} {event.template_version ? `(v${event.template_version})` : ""}
        </div>
      </div>

      <div className="ec-card space-y-3">
        <h3 className="ec-section-title flex items-center gap-2">
          <LayoutGrid size={16} /> Workspace
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Manage this event from its dedicated tabs. Some tabs are not implemented yet and say so honestly rather
          than showing placeholder data.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <Link href={`/events/${event.id}/event-page`} className="ec-btn ec-btn-secondary ec-btn-sm">
            Event Page
          </Link>
          <Link href={`/events/${event.id}/live`} className="ec-btn ec-btn-secondary ec-btn-sm">
            Live
          </Link>
          <Link href={`/events/${event.id}/media`} className="ec-btn ec-btn-secondary ec-btn-sm">
            Media
          </Link>
          <Link href={`/events/${event.id}/engagement`} className="ec-btn ec-btn-secondary ec-btn-sm">
            Engagement
          </Link>
          <Link href={`/events/${event.id}/analytics`} className="ec-btn ec-btn-secondary ec-btn-sm">
            Analytics
          </Link>
          <Link href={`/events/${event.id}/settings`} className="ec-btn ec-btn-secondary ec-btn-sm">
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
