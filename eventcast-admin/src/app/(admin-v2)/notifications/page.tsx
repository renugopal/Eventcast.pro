"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { fetchNotifications, markNotificationRead, type NotificationRecord } from "@/lib/supportNotificationClient";

const SEVERITY_COLOR: Record<string, string> = {
  info: "var(--text-secondary)",
  warning: "#d97706",
  critical: "var(--error)",
};

/**
 * Provider Console Notification Center (Baseline V2.1 NOT-001). Real, in-app
 * notification history only — no outbound email/WhatsApp/SMS delivery is
 * implemented or claimed here. Rows are written server-side by
 * `src/lib/notifications.ts`; this page only reads and marks-read.
 */
export default function AdminV2NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setNotifications(await fetchNotifications(authFetch));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleMarkRead(id: string) {
    setNotifications((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) : prev));
    try {
      await markNotificationRead(authFetch, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      load();
    }
  }

  const unreadCount = (notifications ?? []).filter((n) => !n.read_at).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title flex items-center gap-2">
            <Bell size={20} /> Notifications
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"} — in-app history only.
          </p>
        </div>
      </div>

      {error && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
          {error}
        </div>
      )}

      <div className="ec-card" style={{ padding: 0 }}>
        {!notifications ? (
          <div style={{ padding: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>Loading…</div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>No notifications yet.</div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-subtle)",
                fontSize: "13px",
                background: n.read_at ? "transparent" : "var(--surface-hover)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div style={{ fontWeight: 600, color: SEVERITY_COLOR[n.severity] ?? undefined }}>{n.title}</div>
                {!n.read_at && (
                  <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => handleMarkRead(n.id)}>
                    Mark read
                  </button>
                )}
              </div>
              {n.body && <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>{n.body}</div>}
              <div style={{ marginTop: "4px", color: "var(--text-tertiary)", fontSize: "11px" }}>
                {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
