"use client";

import React from "react";
import {
  LayoutDashboard, Monitor, PlusCircle, List, Settings, BarChart3,
  Image as ImageIcon, LogOut, Users, ChevronLeft, ChevronRight, X,
  Shield, Clapperboard, Wallet,
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
  { id: "billing",       label: "Billing & Wallet", icon: Wallet,          accent: "#10b981" },
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
          transition-all duration-500 ease-in-out
          border-r border-white/[0.08] backdrop-blur-3xl
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          ${isCollapsed ? "md:w-[88px]" : "w-[280px]"}
        `}
        style={{ background: "rgba(255,255,255,0.01)" }}
      >
        {/* Ambient glow in sidebar */}
        <div className="absolute top-0 left-0 w-full h-32 bg-blue-500/[0.03] blur-3xl pointer-events-none" />

        {/* ── Logo ── */}
        <div className={`relative flex items-center gap-4 px-6 py-8 ${isCollapsed && !isMobileOpen ? "md:justify-center" : ""}`}>
          <button
            className="md:hidden absolute top-4 right-4 text-white/20 hover:text-white transition-colors"
            onClick={() => setIsMobileOpen(false)}
          >
            <X size={20} />
          </button>

          <div
            className="w-10 h-10 rounded-[1.25rem] flex-shrink-0 flex items-center justify-center transition-transform hover:rotate-12 duration-500"
            style={{
              background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
              boxShadow: "0 8px 24px rgba(59,130,246,0.25)",
            }}
          >
            <Clapperboard size={20} className="text-white" />
          </div>

          {(!isCollapsed || isMobileOpen) && (
            <div className="animate-in fade-in slide-in-from-left-2 duration-500">
              <h1 className="text-lg font-black tracking-tighter text-white leading-none">
                EVENTCAST<span className="text-blue-500">.PRO</span>
              </h1>
              <p className="text-[9px] font-black tracking-[0.3em] uppercase mt-1 text-white/20">
                ADMIN CONSOLE
              </p>
            </div>
          )}
        </div>

        <div className="mx-6 h-px bg-white/[0.05] mb-6" />

        {/* ── Navigation ── */}
        <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setActiveTab(item.id); setIsMobileOpen(false); }}
                title={isCollapsed && !isMobileOpen ? item.label : ""}
                className={`
                  relative w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl
                  text-[13px] font-black uppercase tracking-widest transition-all duration-300
                  ${isActive ? "text-white" : "text-white/20 hover:text-white/60 hover:bg-white/[0.03]"}
                  ${isCollapsed && !isMobileOpen ? "md:justify-center md:px-0" : ""}
                `}
                style={
                  isActive
                    ? {
                        background: `${item.accent}10`,
                        border: `1px solid ${item.accent}20`,
                        boxShadow: `0 10px 20px -10px ${item.accent}30`,
                      }
                    : { border: "1px solid transparent" }
                }
              >
                {/* Active glow dot */}
                {isActive && (
                  <span
                    className="absolute left-[-4px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                    style={{
                      background: item.accent,
                      boxShadow: `0 0 15px ${item.accent}`,
                    }}
                  />
                )}

                <item.icon
                  size={20}
                  className={`flex-shrink-0 transition-transform duration-500 ${isActive ? "scale-110" : "group-hover:scale-110"}`}
                  style={isActive ? { color: item.accent } : undefined}
                />

                {(!isCollapsed || isMobileOpen) && (
                  <span className="truncate">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ── Footer ── */}
        <div className="px-4 pb-8 pt-4 space-y-3">
          <div className="mx-2 h-px bg-white/[0.05] mb-4" />

          {/* System Pulse — only when expanded */}
          {(!isCollapsed || isMobileOpen) && (
            <div className="mb-4 px-2">
              <SystemPulse />
            </div>
          )}

          <div className="flex gap-2">
            {/* Collapse toggle (desktop only) */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={`
                hidden md:flex flex-1 items-center gap-3 px-4 py-3 rounded-2xl
                text-[10px] font-black uppercase tracking-widest text-white/20 hover:text-white/60
                hover:bg-white/[0.03] transition-all border border-transparent
                hover:border-white/[0.08]
                ${isCollapsed && !isMobileOpen ? "md:justify-center" : ""}
              `}
            >
              {isCollapsed
                ? <ChevronRight size={18} className="mx-auto" />
                : <><ChevronLeft size={16} /><span className="truncate">Compact View</span></>
              }
            </button>

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              className={`
                flex items-center justify-center w-12 h-12 md:w-auto md:flex-1 md:px-4 md:py-3 rounded-2xl
                text-red-500/30 hover:text-red-500
                bg-red-500/[0.02] hover:bg-red-500/[0.1] transition-all duration-300 border border-transparent hover:border-red-500/20
                ${isCollapsed && !isMobileOpen ? "md:w-full" : ""}
              `}
              title="Sign Out"
            >
              <LogOut
                size={18}
                className="flex-shrink-0"
              />
              {(!isCollapsed || isMobileOpen) && <span className="ml-3 text-[10px] font-black uppercase tracking-widest">Exit</span>}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
