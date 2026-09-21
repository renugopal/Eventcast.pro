"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Menu } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { fetchNotifications } from "@/lib/supportNotificationClient";
import type { AdminAuthContextValue } from "../_lib/useAdminAuth";

interface HeaderProps {
  studioSlug: string;
  platformRole: AdminAuthContextValue["platformRole"];
  onOpenMobileNav: () => void;
}

const ROLE_LABELS: Record<AdminAuthContextValue["platformRole"], string> = {
  super_admin: "Super Admin",
  live_streamer: "Studio Admin",
  reseller: "Reseller",
};

function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchNotifications(authFetch)
      .then((notifications) => {
        if (!cancelled) setUnreadCount(notifications.filter((n) => !n.read_at).length);
      })
      .catch(() => {
        if (!cancelled) setUnreadCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link href="/notifications" className="ec-icon-btn ec-notif-bell" aria-label="Notifications">
      <Bell size={18} />
      {!!unreadCount && <span className="ec-notif-bell-count">{unreadCount > 9 ? "9+" : unreadCount}</span>}
    </Link>
  );
}

function ProfileChip({ studioSlug, platformRole }: { studioSlug: string; platformRole: AdminAuthContextValue["platformRole"] }) {
  const initial = studioSlug ? studioSlug[0].toUpperCase() : "?";
  return (
    <div className="ec-profile-chip">
      <span className="ec-profile-chip-avatar">{initial}</span>
      <span className="ec-profile-chip-text">
        <span className="ec-profile-chip-studio">{studioSlug || "N/A"}</span>
        <span className="ec-profile-chip-role">{ROLE_LABELS[platformRole] ?? platformRole}</span>
      </span>
    </div>
  );
}

export function Header({ studioSlug, platformRole, onOpenMobileNav }: HeaderProps) {
  return (
    <>
      {/* Mobile Header — visible only ≤768px (see globals.css .ec-topbar-mobile) */}
      <header className="ec-topbar ec-topbar-mobile">
        <div className="ec-topbar-left">
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 900, fontSize: "16px", color: "var(--foreground)" }}>
            EVENTCAST<span style={{ color: "var(--primary)" }}>.PRO</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NotificationBell />
          <button
            type="button"
            className="ec-icon-btn ec-topbar-menu-btn"
            onClick={onOpenMobileNav}
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      {/* Desktop Header — visible only ≥769px */}
      <header className="ec-topbar ec-topbar-desktop">
        <div className="ec-topbar-left">
          <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--text-tertiary)" }}>
            Admin V2 &middot; {ROLE_LABELS[platformRole] ?? platformRole}
          </span>
        </div>
        <div className="ec-topbar-right">
          <NotificationBell />
          <ProfileChip studioSlug={studioSlug} platformRole={platformRole} />
        </div>
      </header>
    </>
  );
}
