"use client";

import React, { useEffect } from "react";
import {
  LayoutDashboard,
  Monitor,
  PlusCircle,
  List,
  BarChart3,
  Image as ImageIcon,
  LogOut,
  Users,
  ChevronLeft,
  ChevronRight,
  X,
  Shield,
  Clapperboard,
  Wallet,
  Camera,
  Settings,
  Crown,
  Menu,
} from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  handleSignOut: () => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
  isSuperAdmin?: boolean;
  userDisplayName?: string;
  userPlan?: string;
}

const menuItems = [
  { id: "home",          label: "Dashboard",        icon: LayoutDashboard, color: "#5B21B6" },
  { id: "monitor",       label: "Live Monitor",     icon: Monitor,         color: "#EF4444" },
  { id: "create",        label: "Create Event",     icon: PlusCircle,      color: "#8B5CF6" },
  { id: "list",          label: "All Events",       icon: List,            color: "#3B82F6" },
  { id: "photographers", label: "Photographers",    icon: Users,           color: "#10B981" },
  { id: "moderation",    label: "Moderation",       icon: Shield,          color: "#F59E0B" },
  { id: "guest-wall",    label: "Guest Wall",       icon: Camera,          color: "#F43F5E" },
  { id: "analytics",     label: "Analytics",        icon: BarChart3,       color: "#6366F1" },
  { id: "assets",        label: "Asset Library",    icon: ImageIcon,       color: "#EC4899" },
  { id: "billing",       label: "Billing & Wallet", icon: Wallet,          color: "#10B981" },
  { id: "settings",      label: "Settings",         icon: Settings,        color: "#64748B" },
];

// Plan badge styles
const planBadgeStyle: Record<string, React.CSSProperties> = {
  free:         { background: "#F3F4F6", color: "#6B7280", border: "1px solid #E5E7EB" },
  pay_per_use:  { background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0" },
  basic:        { background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" },
  professional: { background: "#F5F3FF", color: "#5B21B6", border: "1px solid #DDD6FE" },
  business:     { background: "#FFF7ED", color: "#92400E", border: "1px solid #FDE68A" },
  enterprise:   { background: "#FDF2F8", color: "#86198F", border: "1px solid #F0ABFC" },
};

const planDisplayNames: Record<string, string> = {
  free:         "Free Trial",
  pay_per_use:  "Pay Per Use",
  basic:        "Basic",
  professional: "Professional",
  business:     "Business",
  enterprise:   "Enterprise",
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isCollapsed,
  setIsCollapsed,
  handleSignOut,
  isMobileOpen,
  setIsMobileOpen,
  isSuperAdmin = false,
  userDisplayName,
  userPlan = "free",
}) => {
  const handleTabClick = (id: string) => {
    setActiveTab(id);
    setIsMobileOpen(false);
  };

  useEffect(() => {
    if (!isMobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobileOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="ec-sidebar-overlay fixed inset-0"
          style={{ background: "rgba(0,0,0,0.40)", backdropFilter: "blur(4px)" }}
          onClick={() => setIsMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={`ec-sidebar ec-scrollbar ${isCollapsed ? "collapsed" : ""} ${isMobileOpen ? "mobile-open" : ""}`}
      >
        {/* Logo Area */}
        <div className="ec-sidebar-logo">
          <div className="ec-sidebar-logo-icon">
            <Clapperboard size={20} color="#FFF" />
          </div>

          {(!isCollapsed || isMobileOpen) && (
            <div style={{ animation: "slide-in-left 0.3s ease" }}>
              <div style={{
                fontFamily: "var(--font-heading)",
                fontSize: "16px",
                fontWeight: 900,
                letterSpacing: "-0.02em",
                color: "var(--foreground)",
                lineHeight: 1,
              }}>
                EVENTCAST<span style={{ color: "var(--primary)" }}>.PRO</span>
              </div>
              <div style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "var(--text-tertiary)",
                textTransform: "uppercase",
                marginTop: "3px",
              }}>
                ADMIN CONSOLE
              </div>
            </div>
          )}

          {/* Mobile close */}
          {isMobileOpen && (
            <button
              onClick={() => setIsMobileOpen(false)}
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

        {/* Super Admin Badge */}
        {isSuperAdmin && (!isCollapsed || isMobileOpen) && (
          <div style={{ padding: "10px 12px 0" }}>
            <div className="ec-super-admin-badge">
              <Crown size={13} />
              <span>Super Admin</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="ec-sidebar-nav ec-scrollbar" style={{ marginTop: isSuperAdmin ? "4px" : "8px" }}>
          {menuItems.map((item, i) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`ec-nav-item ${isActive ? "active" : ""}`}
                style={{
                  animationDelay: `${i * 30}ms`,
                  justifyContent: isCollapsed && !isMobileOpen ? "center" : "flex-start",
                }}
                title={isCollapsed && !isMobileOpen ? item.label : ""}
              >
                <item.icon
                  size={18}
                  className="ec-nav-icon"
                  style={{
                    color: isActive ? item.color : undefined,
                    flexShrink: 0,
                  }}
                />
                {(!isCollapsed || isMobileOpen) && (
                  <span style={{ fontSize: "13px", fontWeight: isActive ? 700 : 600 }}>
                    {item.label}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="ec-sidebar-footer">
          {/* User plan badge */}
          {(!isCollapsed || isMobileOpen) && userPlan && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                borderRadius: "10px",
                marginBottom: "10px",
                ...(planBadgeStyle[userPlan] ?? planBadgeStyle.free),
              }}
            >
              <span style={{ fontSize: "11px", fontWeight: 700 }}>
                {planDisplayNames[userPlan] ?? "Free Trial"}
              </span>
              {userPlan === "free" && (
                <button
                  type="button"
                  onClick={() => setActiveTab("billing")}
                  className="ec-btn ec-btn-sm"
                  style={{
                    padding: "4px 10px",
                    minHeight: "auto",
                    fontSize: "12px",
                    background: "var(--primary-50)",
                    color: "var(--primary)",
                    borderColor: "var(--violet-200)",
                  }}
                >
                  Upgrade
                </button>
              )}
            </div>
          )}

          {/* Collapse + Sign Out */}
          <div style={{ display: "flex", gap: "8px" }}>
            {/* Desktop collapse toggle */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="ec-btn ec-btn-ghost ec-btn-sm"
              style={{
                flex: isCollapsed ? "none" : 1,
                display: "none",
                borderRadius: "10px",
                padding: "8px 10px",
              }}
              title={isCollapsed ? "Expand" : "Collapse"}
            >
              {isCollapsed
                ? <ChevronRight size={16} />
                : <><ChevronLeft size={16} /><span>Collapse</span></>
              }
            </button>

            {/* Sign out */}
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign Out"
              className="ec-btn ec-btn-ghost"
              style={{
                flex: 1,
                justifyContent: isCollapsed && !isMobileOpen ? "center" : "flex-start",
                color: "var(--error)",
                borderColor: "#FECDD3",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--error-50)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "";
              }}
            >
              <LogOut size={16} style={{ flexShrink: 0 }} />
              {(!isCollapsed || isMobileOpen) && <span>Sign out</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
