"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Crown, LogOut, X } from "lucide-react";
import type { AdminNavItem } from "../_lib/nav";

interface SidebarProps {
  items: AdminNavItem[];
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
  isSuperAdmin: boolean;
  onSignOut: () => void;
}

export function Sidebar({ items, isMobileOpen, setIsMobileOpen, isSuperAdmin, onSignOut }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {isMobileOpen && (
        <div
          className="ec-sidebar-overlay fixed inset-0"
          style={{ background: "rgba(0,0,0,0.40)", backdropFilter: "blur(4px)" }}
          onClick={() => setIsMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside className={`ec-sidebar ${isMobileOpen ? "mobile-open" : ""}`}>
        <div className="ec-sidebar-logo">
          <div className="ec-sidebar-logo-icon">
            <Clapperboard size={20} color="#FFF" />
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "16px",
                fontWeight: 900,
                letterSpacing: "-0.02em",
                color: "var(--foreground)",
                lineHeight: 1,
              }}
            >
              EVENTCAST<span style={{ color: "var(--primary)" }}>.PRO</span>
            </div>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "var(--text-tertiary)",
                textTransform: "uppercase",
                marginTop: "3px",
              }}
            >
              Admin V2
            </div>
          </div>

          {isMobileOpen && (
            <button
              type="button"
              onClick={() => setIsMobileOpen(false)}
              aria-label="Close navigation menu"
              style={{
                marginLeft: "auto",
                padding: "4px",
                color: "var(--text-tertiary)",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {isSuperAdmin && (
          <div style={{ padding: "10px 12px 0" }}>
            <div className="ec-super-admin-badge">
              <Crown size={13} />
              <span>Super Admin</span>
            </div>
          </div>
        )}

        <nav className="ec-sidebar-nav" style={{ marginTop: isSuperAdmin ? "4px" : "8px" }}>
          {items.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`ec-nav-item ${isActive ? "active" : ""}`}
                onClick={() => setIsMobileOpen(false)}
              >
                <Icon size={18} className="ec-nav-icon" />
                <span style={{ fontSize: "13px", fontWeight: isActive ? 700 : 600 }}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ec-sidebar-footer">
          <button
            type="button"
            onClick={onSignOut}
            title="Sign Out"
            className="ec-btn ec-btn-ghost"
            style={{
              width: "100%",
              justifyContent: "flex-start",
              color: "var(--error)",
              borderColor: "#FECDD3",
            }}
          >
            <LogOut size={16} style={{ flexShrink: 0 }} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
