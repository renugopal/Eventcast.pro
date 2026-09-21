"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Eye,
  FileText,
  PlusCircle,
  Radio,
  Sparkles,
  Users,
} from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { useAdminAuth } from "../_lib/useAdminAuth";
import { categorizeEventLifecycle, eventDisplayTitle, useAdminEvents, type AdminEventRow } from "../_lib/events";
import { useLivestreamEvents, type LivestreamRosterItem } from "../_lib/livestreams";
import { fetchStudioAnalytics, type StudioAnalyticsSummary } from "@/lib/analyticsClient";
import { fetchNotifications, type NotificationRecord } from "@/lib/supportNotificationClient";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  live_streamer: "Studio Admin",
  reseller: "Reseller",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function resolveEventDate(row: Pick<AdminEventRow, "scheduled_start_at" | "event_date">): Date | null {
  const source = row.scheduled_start_at ?? (row.event_date ? `${row.event_date}T00:00` : null);
  if (!source) return null;
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(
    date
  );
}

function DateChip({ date }: { date: Date | null }) {
  if (!date) {
    return (
      <div className="ec-date-chip">
        <span className="ec-date-chip-month">—</span>
        <span className="ec-date-chip-day">—</span>
      </div>
    );
  }
  return (
    <div className="ec-date-chip">
      <span className="ec-date-chip-month">{date.toLocaleDateString("en-US", { month: "short" })}</span>
      <span className="ec-date-chip-day">{date.getDate()}</span>
    </div>
  );
}

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

interface AttentionItem {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone: "warning" | "error";
}

function buildAttentionItems(events: AdminEventRow[], roster: LivestreamRosterItem[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  const rosterById = new Map(roster.map((r) => [r.eventId, r]));
  const now = Date.now();

  for (const event of events) {
    const lifecycle = categorizeEventLifecycle(event);
    if (lifecycle === "archived") continue;
    const title = eventDisplayTitle(event);

    if (lifecycle === "draft") {
      items.push({
        id: `${event.id}-draft`,
        label: title,
        detail: "Still a draft — not published yet",
        href: `/events/${event.id}/overview`,
        tone: "warning",
      });
      continue;
    }

    if (!event.venue_name) {
      items.push({
        id: `${event.id}-venue`,
        label: title,
        detail: "Missing venue details",
        href: `/events/${event.id}/overview`,
        tone: "warning",
      });
    }

    const date = resolveEventDate(event);
    const isNearTerm = date ? date.getTime() - now <= 14 * DAY_MS && date.getTime() - now >= -DAY_MS : false;
    if (isNearTerm) {
      const roster1 = rosterById.get(event.id);
      if (roster1 && !roster1.livestreamEnabled && !roster1.youtubeConfigured) {
        items.push({
          id: `${event.id}-live`,
          label: title,
          detail: "Livestream not configured",
          href: `/events/${event.id}/live`,
          tone: "error",
        });
      }
    }
  }

  return items;
}

export default function AdminV2DashboardPage() {
  const { studioId, studioSlug, platformRole } = useAdminAuth();
  const { events, isLoading: eventsLoading, error: eventsError } = useAdminEvents(studioId);
  const { events: roster, isLoading: rosterLoading } = useLivestreamEvents(studioId);

  const [analytics, setAnalytics] = useState<StudioAnalyticsSummary | null>(null);
  const [notifications, setNotifications] = useState<NotificationRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStudioAnalytics(authFetch)
      .then((data) => !cancelled && setAnalytics(data))
      .catch(() => !cancelled && setAnalytics(null));
    fetchNotifications(authFetch)
      .then((data) => !cancelled && setNotifications(data))
      .catch(() => !cancelled && setNotifications([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const groups: Record<"draft" | "upcoming" | "published" | "archived", AdminEventRow[]> = {
      draft: [],
      upcoming: [],
      published: [],
      archived: [],
    };
    for (const event of events) {
      groups[categorizeEventLifecycle(event)].push(event);
    }
    return groups;
  }, [events]);

  const liveEnabledCount = useMemo(() => roster.filter((r) => r.livestreamEnabled).length, [roster]);

  const attentionItems = useMemo(() => buildAttentionItems(events, roster), [events, roster]);

  const nextEvent = useMemo(() => {
    const now = Date.now();
    const candidates = [...grouped.upcoming, ...grouped.published]
      .map((event) => ({ event, date: resolveEventDate(event) }))
      .filter((c) => c.date && c.date.getTime() >= now - DAY_MS)
      .sort((a, b) => a.date!.getTime() - b.date!.getTime());
    return candidates[0] ?? null;
  }, [grouped]);

  const upcoming30 = useMemo(() => {
    const now = Date.now();
    return [...grouped.upcoming, ...grouped.published]
      .map((event) => ({ event, date: resolveEventDate(event) }))
      .filter((c) => c.date && c.date.getTime() >= now - DAY_MS && c.date.getTime() <= now + 30 * DAY_MS)
      .sort((a, b) => a.date!.getTime() - b.date!.getTime())
      .slice(0, 5);
  }, [grouped]);

  const recentPublished = useMemo(() => {
    const now = Date.now();
    return grouped.published
      .map((event) => ({ event, date: resolveEventDate(event) }))
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
      .filter((c) => !c.date || c.date.getTime() <= now)
      .slice(0, 4);
  }, [grouped]);

  const rosterPreview = useMemo(
    () =>
      roster
        .map((r) => ({ roster: r, date: r.eventDate ? new Date(`${r.eventDate}T00:00`) : null }))
        .sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity))
        .slice(0, 3),
    [roster]
  );

  const analyticsByEventId = useMemo(() => {
    const map = new Map<string, StudioAnalyticsSummary["events"][number]>();
    analytics?.events.forEach((e) => map.set(e.eventId, e));
    return map;
  }, [analytics]);

  const unreadCount = (notifications ?? []).filter((n) => !n.read_at).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-dashboard-hero">
        <div>
          <div className="ec-dashboard-hero-eyebrow">{ROLE_LABELS[platformRole] ?? platformRole}</div>
          <h1 className="ec-dashboard-hero-title">{greetingForNow()}</h1>
          <p className="ec-dashboard-hero-sub">
            Studio <strong style={{ color: "var(--foreground)" }}>{studioSlug || "—"}</strong> — here&apos;s what&apos;s
            happening with your events.
          </p>
        </div>
        <div className="ec-dashboard-hero-actions">
          <Link href="/events" className="ec-btn ec-btn-secondary">
            View Events
          </Link>
          <Link href="/events/new" className="ec-btn ec-btn-primary">
            <PlusCircle size={16} />
            Create Event
          </Link>
        </div>
      </div>

      {eventsError && <div className="ec-banner ec-banner-error">Could not load events: {eventsError}</div>}

      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatTile
          icon={<FileText size={20} />}
          label="Draft Events"
          value={eventsLoading ? null : grouped.draft.length}
          accent="var(--accent)"
        />
        <StatTile
          icon={<CalendarClock size={20} />}
          label="Upcoming (30d)"
          value={eventsLoading ? null : upcoming30.length}
          accent="var(--primary)"
        />
        <StatTile
          icon={<Sparkles size={20} />}
          label="Published Events"
          value={eventsLoading ? null : grouped.published.length}
          accent="var(--success)"
        />
        <StatTile
          icon={<Radio size={20} />}
          label="Livestreams Enabled"
          value={rosterLoading ? null : liveEnabledCount}
          accent="var(--info)"
        />
        <StatTile
          icon={<AlertTriangle size={20} />}
          label="Needs Attention"
          value={eventsLoading || rosterLoading ? null : attentionItems.length}
          accent="var(--error)"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Next event */}
        <div className="ec-card">
          <div className="ec-section-header" style={{ marginBottom: "16px" }}>
            <h2 className="ec-section-title">Your Next Event</h2>
            <Link href="/events" style={{ fontSize: "13px", color: "var(--primary)", fontWeight: 600 }}>
              View all events →
            </Link>
          </div>
          {eventsLoading ? (
            <div className="ec-skeleton" style={{ height: "72px" }} />
          ) : nextEvent ? (
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
              <DateChip date={nextEvent.date} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>{eventDisplayTitle(nextEvent.event)}</div>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
                  {nextEvent.date ? formatDisplayDate(nextEvent.date) : "Date not set"}
                  {nextEvent.event.event_time ? ` · ${nextEvent.event.event_time}` : ""}
                  {nextEvent.event.venue_name ? ` · ${nextEvent.event.venue_name}` : ""}
                </div>
              </div>
              <Link href={`/events/${nextEvent.event.id}/overview`} className="ec-btn ec-btn-primary ec-btn-sm">
                Open Event
              </Link>
            </div>
          ) : (
            <EmptyState
              icon={<CalendarClock size={22} />}
              title="No upcoming events yet"
              sub="Create an event to see it here once it's scheduled."
            />
          )}
        </div>

        {/* Needs attention */}
        <div className="ec-card">
          <div className="ec-section-header" style={{ marginBottom: "8px" }}>
            <h2 className="ec-section-title">Needs Attention</h2>
            {attentionItems.length > 0 && (
              <span className="ec-badge ec-badge-amber">{attentionItems.length}</span>
            )}
          </div>
          {eventsLoading || rosterLoading ? (
            <div className="flex flex-col gap-2">
              <div className="ec-skeleton" style={{ height: "20px" }} />
              <div className="ec-skeleton" style={{ height: "20px" }} />
            </div>
          ) : attentionItems.length === 0 ? (
            <EmptyState icon={<Sparkles size={22} />} title="You're all caught up" sub="Nothing needs your attention right now." />
          ) : (
            <div>
              {attentionItems.slice(0, 5).map((item) => (
                <div key={item.id} className="ec-attention-row">
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                    <span className={`ec-attention-dot ec-attention-dot-${item.tone}`} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "13px" }}>{item.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{item.detail}</div>
                    </div>
                  </div>
                  <Link href={item.href} className="ec-btn ec-btn-secondary ec-btn-sm">
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming events */}
        <div className="ec-card">
          <div className="ec-section-header" style={{ marginBottom: "16px" }}>
            <h2 className="ec-section-title">Upcoming Events (Next 30 Days)</h2>
          </div>
          {eventsLoading ? (
            <div className="ec-skeleton" style={{ height: "120px" }} />
          ) : upcoming30.length === 0 ? (
            <EmptyState icon={<CalendarClock size={22} />} title="Nothing in the next 30 days" sub="Upcoming events will show up here." />
          ) : (
            <div className="flex flex-col gap-3">
              {upcoming30.map(({ event, date }) => (
                <div key={event.id} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <DateChip date={date} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px" }}>{eventDisplayTitle(event)}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {event.venue_name || event.event_type || "Event"}
                    </div>
                  </div>
                  <Link href={`/events/${event.id}/overview`} className="ec-btn ec-btn-secondary ec-btn-sm">
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Livestream roster snapshot */}
        <div className="ec-card">
          <div className="ec-section-header" style={{ marginBottom: "16px" }}>
            <h2 className="ec-section-title">Livestream Readiness</h2>
            <Link href="/livestreams" style={{ fontSize: "13px", color: "var(--primary)", fontWeight: 600 }}>
              View all →
            </Link>
          </div>
          {rosterLoading ? (
            <div className="ec-skeleton" style={{ height: "120px" }} />
          ) : rosterPreview.length === 0 ? (
            <EmptyState icon={<Radio size={22} />} title="No active or upcoming streams" sub="Livestream status will appear here." />
          ) : (
            <div className="flex flex-col gap-3">
              {rosterPreview.map(({ roster: r }) => (
                <div key={r.eventId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px" }}>
                      {[r.groomName, r.brideName].filter(Boolean).join(" & ") || r.celebrantName || "Untitled event"}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                      {r.livestreamEnabled ? "Private stream enabled" : "Private stream disabled"}
                      {" · "}
                      {r.youtubeConfigured ? "YouTube linked" : "YouTube not linked"}
                    </div>
                  </div>
                  <Link href={`/events/${r.eventId}/live`} className="ec-btn ec-btn-secondary ec-btn-sm">
                    Manage
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent published events */}
        <div className="ec-card" style={{ gridColumn: "span 2 / span 2" }}>
          <div className="ec-section-header" style={{ marginBottom: "16px" }}>
            <h2 className="ec-section-title">Recent Published Events</h2>
            <Link href="/events" style={{ fontSize: "13px", color: "var(--primary)", fontWeight: 600 }}>
              View all →
            </Link>
          </div>
          {eventsLoading ? (
            <div className="ec-skeleton" style={{ height: "100px" }} />
          ) : recentPublished.length === 0 ? (
            <EmptyState icon={<Sparkles size={22} />} title="No published events yet" sub="Once you publish an event, it will show up here." />
          ) : (
            <div className="flex flex-col gap-3">
              {recentPublished.map(({ event, date }) => {
                const views = analyticsByEventId.get(event.id)?.totalPageViews;
                return (
                  <div key={event.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "14px" }}>{eventDisplayTitle(event)}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                        {date ? formatDisplayDate(date) : "Date not set"}
                        {typeof views === "number" ? ` · ${views} page view${views === 1 ? "" : "s"}` : ""}
                      </div>
                    </div>
                    <Link href={`/events/${event.id}/overview`} className="ec-btn ec-btn-secondary ec-btn-sm">
                      Open
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Support & notifications */}
        <div className="ec-card">
          <div className="ec-section-header" style={{ marginBottom: "16px" }}>
            <h2 className="ec-section-title flex items-center gap-2">
              <Bell size={16} /> Notifications
            </h2>
            <Link href="/notifications" style={{ fontSize: "13px", color: "var(--primary)", fontWeight: 600 }}>
              View all →
            </Link>
          </div>
          {notifications === null ? (
            <div className="ec-skeleton" style={{ height: "100px" }} />
          ) : notifications.length === 0 ? (
            <EmptyState icon={<Bell size={20} />} title="You're all caught up" sub="No notifications yet." />
          ) : (
            <div className="flex flex-col gap-3">
              <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                {unreadCount > 0 ? `${unreadCount} unread` : "All read"}
              </p>
              {notifications.slice(0, 3).map((n) => (
                <div key={n.id} style={{ fontSize: "13px" }}>
                  <div style={{ fontWeight: 600, color: n.read_at ? "var(--foreground)" : "var(--primary)" }}>{n.title}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Analytics snapshot */}
      <div className="ec-card">
        <div className="ec-section-header" style={{ marginBottom: "16px" }}>
          <h2 className="ec-section-title">Analytics Snapshot</h2>
          <Link href="/analytics" style={{ fontSize: "13px", color: "var(--primary)", fontWeight: 600 }}>
            Full analytics →
          </Link>
        </div>
        {analytics === null ? (
          <div className="ec-skeleton" style={{ height: "80px" }} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="ec-card ec-card-sm">
              <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                <Eye size={14} /> Total page views (all events)
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, marginTop: "4px" }}>{analytics.totals.totalPageViews}</div>
            </div>
            <div className="ec-card ec-card-sm">
              <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                <Users size={14} /> Unique visitors (all events)
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, marginTop: "4px" }}>{analytics.totals.totalUniqueVisitors}</div>
            </div>
            <div className="ec-card ec-card-sm">
              <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                <Radio size={14} /> Current livestream viewers
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, marginTop: "4px" }}>{analytics.totals.totalCurrentViewers}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  accent: string;
}) {
  return (
    <div className="ec-stat-card">
      <span className="ec-stat-accent" style={{ background: accent }} />
      <span className="ec-stat-icon" style={{ background: `${accent}1A`, color: accent }}>
        {icon}
      </span>
      <div>
        {value === null ? (
          <div className="ec-skeleton" style={{ width: "32px", height: "24px" }} />
        ) : (
          <div className="ec-stat-value">{value}</div>
        )}
        <div className="ec-stat-label">{label}</div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="ec-empty-state">
      <span className="ec-empty-state-icon">{icon}</span>
      <span className="ec-empty-state-title">{title}</span>
      <span className="ec-empty-state-sub">{sub}</span>
    </div>
  );
}
