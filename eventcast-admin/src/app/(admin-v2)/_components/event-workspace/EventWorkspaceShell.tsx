"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authFetch, AuthError } from "@/lib/client-auth";
import {
  deriveEventLifecycleStatus,
  EVENT_LIFECYCLE_BADGE_CLASSES,
  EVENT_LIFECYCLE_LABELS,
  type EventLifecycleStatus,
} from "@/lib/eventLifecycle";

/**
 * Shared Event Workspace shell (V2.1 Milestone G): loads one event by its
 * stable UUID once, derives its honest lifecycle bucket, and renders the
 * accepted tab navigation (Overview, Event Page, Live, Media, Engagement,
 * Analytics, Settings). Reuses the existing, already-completed
 * `GET /api/events/draft/[eventId]` route rather than introducing a second
 * event-loading endpoint — that route already proves tenant ownership via
 * `getOwnedEventById` and works for any page_state, not only Drafts.
 */

export interface EventWorkspaceEvent {
  id: string;
  event_type: string | null;
  groom_name: string | null;
  bride_name: string | null;
  venue_name: string | null;
  slug: string | null;
  template_id: string | null;
  template_version: string | null;
  scheduled_start_at: string | null;
  page_state: string | null;
  thumbnail_url: string | null;
  event_visibility: string | null;
  archived_at: string | null;
}

export type EventWorkspaceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; event: EventWorkspaceEvent };

interface EventWorkspaceContextValue {
  state: EventWorkspaceState;
  lifecycle: EventLifecycleStatus | null;
  reload: () => void;
}

const EventWorkspaceContext = createContext<EventWorkspaceContextValue | null>(null);

/** Consumed by every tab page nested under `events/[eventId]/layout.tsx`. */
export function useEventWorkspace(): EventWorkspaceContextValue {
  const ctx = useContext(EventWorkspaceContext);
  if (!ctx) {
    throw new Error("useEventWorkspace must be used within the Event Workspace layout");
  }
  return ctx;
}

const WORKSPACE_TABS: { segment: string; label: string }[] = [
  { segment: "overview", label: "Overview" },
  { segment: "event-page", label: "Event Page" },
  { segment: "live", label: "Live" },
  { segment: "media", label: "Media" },
  { segment: "engagement", label: "Engagement" },
  { segment: "analytics", label: "Analytics" },
  { segment: "settings", label: "Settings" },
];

interface EventWorkspaceShellProps {
  eventId: string;
  children: React.ReactNode;
}

export function EventWorkspaceShell({ eventId, children }: EventWorkspaceShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<EventWorkspaceState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await authFetch(`/api/events/draft/${eventId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Could not load this event");
        }
        setState({ status: "ready", event: data.event as EventWorkspaceEvent });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) {
          router.push("/login");
          return;
        }
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId, router, reloadToken]);

  const lifecycle = state.status === "ready" ? deriveEventLifecycleStatus(state.event) : null;

  if (state.status === "loading") {
    return (
      <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
        Loading event…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
        {state.message}
      </div>
    );
  }

  const { event } = state;
  const title =
    event.groom_name || event.bride_name
      ? [event.groom_name, event.bride_name].filter(Boolean).join(" & ")
      : "Untitled event";

  return (
    <EventWorkspaceContext.Provider value={{ state, lifecycle, reload: () => setReloadToken((n) => n + 1) }}>
      <div className="flex flex-col gap-4">
        <div className="ec-section-header">
          <div>
            <h1 className="ec-page-title">{title}</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginTop: "4px" }}>
              {event.event_type || "Event"}
            </p>
          </div>
          {lifecycle && (
            <span className={`ec-badge ${EVENT_LIFECYCLE_BADGE_CLASSES[lifecycle]}`}>
              {EVENT_LIFECYCLE_LABELS[lifecycle]}
            </span>
          )}
        </div>

        <nav
          style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            borderBottom: "1px solid var(--border-color, #e5e7eb)",
            paddingBottom: "10px",
          }}
        >
          {WORKSPACE_TABS.map((tab) => {
            const href = `/events/${eventId}/${tab.segment}`;
            const isActive = pathname === href;
            return (
              <Link
                key={tab.segment}
                href={href}
                className={isActive ? "ec-btn ec-btn-primary ec-btn-sm" : "ec-btn ec-btn-secondary ec-btn-sm"}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </EventWorkspaceContext.Provider>
  );
}
