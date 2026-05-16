"use client";

import React from "react";
import {
  LayoutDashboard, Monitor, PlusCircle, List, Settings, BarChart3,
  Image as ImageIcon, LogOut, Users, ChevronLeft, ChevronRight, X,
  Shield, Clapperboard,
} from "lucide-react";
import { SystemPulse } from "./SystemPulse";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  handleSignOut: () => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

const menuItems = [
  { id: "home",          label: "Dashboard",       icon: LayoutDashboard, accent: "#3b82f6" },
  { id: "monitor",       label: "Live Monitor",    icon: Monitor,         accent: "#ef4444" },
  { id: "create",        label: "Create Event",    icon: PlusCircle,      accent: "#8b5cf6" },
  { id: "list",          label: "All Events",      icon: List,            accent: "#06b6d4" },
  { id: "photographers", label: "Photographers",   icon: Users,           accent: "#10b981" },
  { id: "moderation",    label: "Moderation",      icon: Shield,          accent: "#f59e0b" },
  { id: "analytics",     label: "Analytics",       icon: BarChart3,       accent: "#6366f1" },
  { id: "assets",        label: "Asset Library",   icon: ImageIcon,       accent: "#ec4899" },
  { id: "settings",      label: "Settings",        icon: Settings,        accent: "#64748b" },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab, setActiveTab, isCollapsed, setIsCollapsed, handleSignOut,
  isMobileOpen, setIsMobileOpen,
}) => {
  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={`
          flex flex-col h-screen fixed md:sticky top-0 z-50
          transition-all duration-300 ease-in-out
          border-r border-white/[0.06]
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          ${isCollapsed ? "md:w-[72px]" : "w-[272px]"}
        `}
        style={{ background: "linear-gradient(180deg, #0d0d17 0%, #07070d 100%)" }}
      >
        {/* ── Logo ── */}
        <div className={`relative flex items-center gap-3 px-4 py-5 ${isCollapsed && !isMobileOpen ? "md:justify-center" : ""}`}>
          <button
            className="md:hidden absolute top-4 right-4 text-white/30 hover:text-white transition-colors"
            onClick={() => setIsMobileOpen(false)}
          >
            <X size={20} />
          </button>

          <div
            className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
              boxShadow: "0 0 18px rgba(59,130,246,0.35)",
            }}
          >
            <Clapperboard size={17} className="text-white" />
          </div>

          {(!isCollapsed || isMobileOpen) && (
            <div>
              <h1 className="text-[15px] font-black tracking-wider text-white leading-none">
                EVENTCAST
              </h1>
              <p
                className="text-[9px] font-bold tracking-widest uppercase mt-0.5"
                style={{ color: "#3b82f6" }}
              >
                Admin Control
              </p>
            </div>
          )}
        </div>

        <div className="mx-4 h-px bg-white/[0.06] mb-3" />

        {/* ── Navigation ── */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setActiveTab(item.id); setIsMobileOpen(false); }}
                title={isCollapsed && !isMobileOpen ? item.label : ""}
                className={`
                  relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                  text-sm font-semibold transition-all duration-200
                  ${isActive ? "text-white" : "text-white/35 hover:text-white/75 hover:bg-white/[0.04]"}
                  ${isCollapsed && !isMobileOpen ? "md:justify-center md:px-0" : ""}
                `}
                style={
                  isActive
                    ? {
                        background: `${item.accent}14`,
                        boxShadow: `inset 0 0 0 1px ${item.accent}28`,
                      }
                    : undefined
                }
              >
                {/* Active left accent bar */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                    style={{
                      background: item.accent,
                      boxShadow: `0 0 8px ${item.accent}`,
                    }}
                  />
                )}

                <item.icon
                  size={18}
                  className="flex-shrink-0"
                  style={isActive ? { color: item.accent } : undefined}
                />

                {(!isCollapsed || isMobileOpen) && (
                  <span>{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ── Footer ── */}
        <div className="px-3 pb-4 pt-2 space-y-2">
          <div className="h-px bg-white/[0.06] mb-2" />

          {/* System Pulse — only when expanded */}
          {(!isCollapsed || isMobileOpen) && (
            <div className="mb-1">
              <SystemPulse />
            </div>
          )}

          {/* Collapse toggle (desktop only) */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`
              hidden md:flex w-full items-center gap-2 px-3 py-2 rounded-xl
              text-xs font-semibold text-white/25 hover:text-white/60
              hover:bg-white/[0.04] transition-all border border-transparent
              hover:border-white/[0.08]
              ${isCollapsed && !isMobileOpen ? "md:justify-center" : ""}
            `}
          >
            {isCollapsed
              ? <ChevronRight size={16} className="mx-auto" />
              : <><ChevronLeft size={16} /><span>Collapse</span></>
            }
          </button>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
              text-sm font-semibold text-red-500/50 hover:text-red-400
              hover:bg-red-500/[0.08] transition-all duration-200 group
              ${isCollapsed && !isMobileOpen ? "md:justify-center md:px-0" : ""}
            `}
          >
            <LogOut
              size={18}
              className="flex-shrink-0 group-hover:-translate-x-0.5 transition-transform"
            />
            {(!isCollapsed || isMobileOpen) && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    </>
  );
};
