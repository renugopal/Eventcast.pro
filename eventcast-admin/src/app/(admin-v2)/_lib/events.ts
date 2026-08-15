"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { deriveEventLifecycleStatus, type EventLifecycleStatus } from "@/lib/eventLifecycle";

export interface AdminEventRow {
  id: string;
  event_type: string | null;
  groom_name: string | null;
  bride_name: string | null;
  celebrant_name: string | null;
  event_date: string | null;
  event_time: string | null;
  venue_name: string | null;
  slug: string | null;
  archived_at: string | null;
  /** Draft/Published page-state dimension (migration 0029). */
  page_state: string | null;
  /** Authoritative schedule (migration 0029); falls back to event_date for legacy rows. */
  scheduled_start_at: string | null;
}

export type EventLifecycle = EventLifecycleStatus;

/**
 * Deterministic lifecycle derivation reused from the Event Workspace's
 * shared helper (`@/lib/eventLifecycle`) — the same rule the workspace shell
 * uses for a single event's badge, so the list and the workspace can never
 * disagree about what "Upcoming"/"Draft"/"Published"/"Archived" means. Does
 * not use date math alone to claim Live or Completed (V2.1 EVT-003).
 */
export function categorizeEventLifecycle(row: AdminEventRow): EventLifecycle {
  return deriveEventLifecycleStatus(row);
}

export function eventDisplayTitle(
  row: Pick<AdminEventRow, "groom_name" | "bride_name" | "celebrant_name">
): string {
  if (row.groom_name || row.bride_name) {
    return [row.groom_name, row.bride_name].filter(Boolean).join(" & ");
  }
  return row.celebrant_name || "Untitled event";
}

interface UseAdminEventsResult {
  events: AdminEventRow[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Mirrors the legacy admin's fetchEvents() data-access pattern — same
 * `events` table, same studio-scoped RLS-protected browser client — since
 * no dedicated /api/events list endpoint exists to call instead.
 */
export function useAdminEvents(studioId: string | null): UseAdminEventsResult {
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studioId) return;
    let cancelled = false;

    supabase
      .from("events")
      .select(
        "id, event_type, groom_name, bride_name, celebrant_name, event_date, event_time, venue_name, slug, archived_at, page_state, scheduled_start_at"
      )
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false })
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setError(queryError.message);
          setEvents([]);
        } else {
          setError(null);
          setEvents((data as AdminEventRow[]) ?? []);
        }
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [studioId]);

  return { events, isLoading, error };
}
