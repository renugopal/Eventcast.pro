"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch, AuthError } from "@/lib/client-auth";

export interface LivestreamRosterItem {
  eventId: string;
  eventType: string | null;
  groomName: string | null;
  brideName: string | null;
  celebrantName: string | null;
  eventDate: string | null;
  eventTime: string | null;
  venueName: string | null;
  slug: string | null;
  pageState: string | null;
  livestreamEnabled: boolean;
  youtubeConfigured: boolean;
}

interface UseLivestreamEventsResult {
  events: LivestreamRosterItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Provider Console "Live Streams" roster (Livestream + YouTube + Live
 * Control Room delivery package). Now backed by the real
 * `GET /api/livestreams` aggregate route — replacing the earlier direct
 * browser-client `events` query this hook used before a studio-facing
 * assignment-status projection existed. `studioId` is accepted only to keep
 * the hook's existing call sites unchanged; the route itself derives the
 * studio from the authenticated session, never a client-supplied value.
 */
export function useLivestreamEvents(studioId: string | null): UseLivestreamEventsResult {
  const [events, setEvents] = useState<LivestreamRosterItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!studioId) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await authFetch("/api/livestreams");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Could not load livestream roster");
        }
        setError(null);
        setEvents((data.items as LivestreamRosterItem[]) ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof AuthError ? err.message : err instanceof Error ? err.message : String(err));
        setEvents([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [studioId, refreshToken]);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    setRefreshToken((t) => t + 1);
  }, []);

  return { events, isLoading, isRefreshing, error, refresh };
}

/**
 * Active-or-imminent filter for the roster: not already in the past.
 * Archived events are already excluded server-side. Mirrors the same
 * event_date-based rule the Events list uses for "Upcoming" (../_lib/events.ts).
 */
export function isRelevantForControlRoom(row: Pick<LivestreamRosterItem, "eventDate">): boolean {
  if (!row.eventDate) return true;
  const eventDate = new Date(`${row.eventDate}T00:00`);
  if (Number.isNaN(eventDate.getTime())) return true;
  const now = new Date();
  const eventDayMs = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return eventDayMs >= todayMs;
}
