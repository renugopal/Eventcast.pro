"use client";

import { Menu } from "lucide-react";
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
        <button
          type="button"
          className="ec-icon-btn ec-topbar-menu-btn"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
        >
          <Menu size={20} />
        </button>
      </header>

      {/* Desktop Header — visible only ≥769px */}
      <header className="ec-topbar ec-topbar-desktop">
        <div className="ec-topbar-left">
          <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--text-tertiary)" }}>
            Admin V2 &middot; {ROLE_LABELS[platformRole] ?? platformRole}
          </span>
        </div>
        <div className="ec-topbar-right">
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
            Studio: <span style={{ color: "var(--foreground)" }}>{studioSlug || "N/A"}</span>
          </span>
        </div>
      </header>
    </>
  );
}
