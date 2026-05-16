"use client";

import React from "react";
import {
  Calendar, Activity, Eye, Heart, Play, Clock, ChevronRight,
  ArrowUpRight, TrendingUp, Flame, Zap, Users,
} from "lucide-react";
import { authFetch } from "@/lib/client-auth";

interface DashboardHomeProps {
  events: any[];
  wishes: any[];
  analyticsData: any[];
  setActiveTab: (tab: string) => void;
}

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  accent: string;
  onClick?: () => void;
  badge?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, accent, onClick, badge }) => (
  <button
    onClick={onClick}
    className={`relative w-full text-left p-5 rounded-2xl border transition-all duration-200 group ${onClick ? "cursor-pointer hover:scale-[1.01]" : "cursor-default"}`}
    style={{
      background: `${accent}0a`,
      borderColor: `${accent}22`,
    }}
  >
    <div
      className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
      style={{ boxShadow: `inset 0 0 0 1px ${accent}35` }}
    />
    <div className="flex items-start justify-between mb-4">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: `${accent}18` }}
      >
        <Icon size={20} style={{ color: accent }} />
      </div>
      {badge && (
        <span
          className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider"
          style={{ background: `${accent}20`, color: accent }}
        >
          {badge}
        </span>
      )}
    </div>
    <p className="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-1">{label}</p>
    <h3 className="text-3xl font-black text-white leading-none">{value}</h3>
  </button>
);

export const DashboardHome: React.FC<DashboardHomeProps> = ({
  events, wishes, analyticsData, setActiveTab,
}) => {
  const [activeEventsCount, setActiveEventsCount] = React.useState(0);

  React.useEffect(() => {
    const fetchLive = async () => {
      try {
        const res = await authFetch("/api/media/live-status");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.activeProcesses) {
            setActiveEventsCount(
              data.activeProcesses.filter((p: any) => p.state === "running").length,
            );
          }
        }
      } catch {}
    };
    fetchLive();
    const timer = setInterval(fetchLive, 30_000);
    return () => clearInterval(timer);
  }, []);

  const totalEvents  = events.length;
  const totalViews   = analyticsData.reduce((sum, e) => sum + (e.view_count || 0), 0);
  const totalWishes  = wishes.length;

  const today       = new Date().toISOString().split("T")[0];
  const todayEvents = events.filter((e) => e.event_date === today);

  const nextWeek    = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr  = nextWeek.toISOString().split("T")[0];
  const upcomingEvents = events
    .filter((e) => e.event_date > today && e.event_date <= nextWeekStr)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  const recentWishes = wishes.slice(0, 10);

  const stats: StatCardProps[] = [
    {
      label: "Total Events",
      value: totalEvents,
      icon: Calendar,
      accent: "#3b82f6",
    },
    {
      label: "Active Livestreams",
      value: activeEventsCount,
      icon: Activity,
      accent: "#ef4444",
      badge: activeEventsCount > 0 ? "LIVE" : undefined,
    },
    {
      label: "Total Page Views",
      value: totalViews.toLocaleString(),
      icon: Eye,
      accent: "#6366f1",
    },
    {
      label: "Total Wishes",
      value: totalWishes,
      icon: Heart,
      accent: "#ec4899",
      onClick: () => setActiveTab("moderation"),
    },
  ];

  return (
    <div className="w-full space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight">
            Welcome back, Admin
          </h2>
          <p className="text-white/40 font-medium mt-1 text-sm">
            Here&apos;s what&apos;s happening with your events today.
          </p>
        </div>

        {activeEventsCount > 0 && (
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black"
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "#ef4444",
              boxShadow: "0 0 12px rgba(239,68,68,0.15)",
            }}
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {activeEventsCount} LIVE NOW
          </div>
        )}
      </div>

      {/* Stats Grid — data from Supabase via props (no hardcoded values) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">

          {/* Today's Events */}
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.07)" }}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/[0.06]">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Flame size={16} className="text-red-400" />
                Today&apos;s Events
              </h3>
              <span
                className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider"
                style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}
              >
                {todayEvents.length} Events
              </span>
            </div>

            <div>
              {todayEvents.length === 0 ? (
                <div className="py-12 text-center text-white/25">
                  <Calendar size={28} className="mx-auto mb-3 opacity-30" />
                  <p className="font-bold text-sm">No events scheduled for today.</p>
                </div>
              ) : (
                todayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="px-6 py-4 flex items-center justify-between border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl overflow-hidden border border-white/10 flex-shrink-0 bg-white/5">
                        {event.thumbnail_url ? (
                          <img
                            src={event.thumbnail_url}
                            className="w-full h-full object-cover"
                            alt=""
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/20">
                            <Calendar size={20} />
                          </div>
                        )}
                      </div>
                      <div>
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider mb-1"
                          style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}
                        >
                          {event.event_type}
                        </span>
                        <h4 className="text-sm font-black text-white">
                          {event.groom_name || event.celebrant_name} &amp;{" "}
                          {event.bride_name || "Family"}
                        </h4>
                        <p className="text-xs text-white/35 flex items-center gap-1 mt-0.5">
                          <Clock size={11} />
                          {event.event_time} &bull; {event.venue_name}
                        </p>
                      </div>
                    </div>

                    <a
                      href={`https://eventcast.pro/events/${event.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl flex items-center justify-center transition-all border border-white/10 text-white/30 hover:text-white hover:border-blue-500/50 hover:bg-blue-500/10"
                    >
                      <ArrowUpRight size={16} />
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Events */}
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.07)" }}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/[0.06]">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <TrendingUp size={16} className="text-blue-400" />
                Upcoming (Next 7 Days)
              </h3>
              <button
                onClick={() => setActiveTab("list")}
                className="text-[10px] font-black uppercase tracking-widest text-blue-400 hover:text-blue-300 transition-colors"
              >
                View All
              </button>
            </div>

            <div>
              {upcomingEvents.length === 0 ? (
                <div className="py-12 text-center text-white/25">
                  <Play size={28} className="mx-auto mb-3 opacity-30" />
                  <p className="font-bold text-sm">No upcoming events in the next 7 days.</p>
                </div>
              ) : (
                upcomingEvents.map((event) => (
                  <a
                    key={event.id}
                    href={`https://eventcast.pro/events/${event.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors group"
                  >
                    <div>
                      <h4 className="text-sm font-bold text-white/80 group-hover:text-white transition-colors">
                        {event.groom_name || event.celebrant_name} &amp;{" "}
                        {event.bride_name || "Family"}
                      </h4>
                      <p className="text-[11px] text-white/30 font-medium mt-0.5">
                        {event.event_date} &bull; {event.event_type}
                      </p>
                    </div>
                    <ChevronRight
                      size={15}
                      className="text-white/20 group-hover:text-blue-400 transition-colors"
                    />
                  </a>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column — Recent Wishes */}
        <div
          className="rounded-2xl border overflow-hidden flex flex-col"
          style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.07)", maxHeight: "680px" }}
        >
          <div
            className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]"
          >
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <Heart size={15} className="text-pink-400" />
              Recent Wishes
            </h3>
            <span
              className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider"
              style={{ background: "rgba(236,72,153,0.15)", color: "#f472b6" }}
            >
              {totalWishes} Total
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {recentWishes.length === 0 ? (
              <div className="py-12 text-center text-white/25">
                <Heart size={28} className="mx-auto mb-3 opacity-30" />
                <p className="font-bold text-sm">No wishes received yet.</p>
              </div>
            ) : (
              recentWishes.map((wish, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl border border-white/[0.06]"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                        style={{ background: "rgba(236,72,153,0.2)", color: "#f472b6" }}
                      >
                        {(wish.name || "?")[0].toUpperCase()}
                      </div>
                      <h4 className="text-xs font-black text-white/80">{wish.name}</h4>
                    </div>
                    <span className="text-[9px] text-white/25 font-medium flex-shrink-0">
                      {new Date(wish.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/45 italic leading-relaxed">
                    &ldquo;{wish.message}&rdquo;
                  </p>
                  {wish.events && (
                    <p className="text-[9px] font-bold uppercase tracking-widest mt-2" style={{ color: "#60a5fa" }}>
                      For: {wish.events.groom_name || wish.events.celebrant_name}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          {totalWishes > 0 && (
            <div className="p-4 border-t border-white/[0.06]">
              <button
                onClick={() => setActiveTab("moderation")}
                className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white/50 hover:text-white transition-colors border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]"
              >
                Moderate All Wishes
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "New Event",       sub: "Create a new event site",       tab: "create",        accent: "#8b5cf6", icon: Zap },
          { label: "Live Monitor",    sub: "Check stream health status",    tab: "monitor",       accent: "#ef4444", icon: Activity },
          { label: "View Analytics",  sub: "Page views & engagement",       tab: "analytics",     accent: "#6366f1", icon: TrendingUp },
        ].map((action) => (
          <button
            key={action.tab}
            onClick={() => setActiveTab(action.tab)}
            className="flex items-center gap-4 p-5 rounded-2xl border text-left transition-all duration-200 group hover:scale-[1.01]"
            style={{
              background: `${action.accent}0a`,
              borderColor: `${action.accent}20`,
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${action.accent}18` }}
            >
              <action.icon size={18} style={{ color: action.accent }} />
            </div>
            <div>
              <p className="text-sm font-black text-white/80 group-hover:text-white transition-colors">{action.label}</p>
              <p className="text-[11px] text-white/30 mt-0.5">{action.sub}</p>
            </div>
            <ChevronRight size={16} className="ml-auto text-white/15 group-hover:text-white/50 transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
};
