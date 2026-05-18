"use client";

import React from "react";
import {
  Calendar, Activity, Eye, Heart, Play, Clock, ChevronRight,
  ArrowUpRight, TrendingUp, Flame, Zap, Users, MapPin,
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
    <div className="w-full space-y-10 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter leading-tight">
            Terminal <span className="text-blue-500">Overview</span>
          </h2>
          <p className="text-white/40 font-bold uppercase tracking-[0.2em] mt-2 text-[10px] flex items-center gap-2">
            <Activity size={14} className="text-blue-500" /> Infrastructure Synchronization: OPTIMAL
          </p>
        </div>

        {activeEventsCount > 0 && (
          <div
            className="flex items-center gap-3 px-5 py-2.5 rounded-[1.25rem] text-[10px] font-black uppercase tracking-[0.2em] bg-red-500/10 border border-red-500/20 text-red-500 shadow-lg shadow-red-500/5 backdrop-blur-md"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,1)]" />
            {activeEventsCount} Events Online
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((s, i) => (
          <button
            key={i}
            onClick={s.onClick}
            className={`relative w-full text-left p-7 rounded-[2rem] border transition-all duration-500 group overflow-hidden backdrop-blur-xl ${s.onClick ? "cursor-pointer hover:translate-y-[-4px] hover:border-white/20" : "cursor-default"}`}
            style={{
              background: "rgba(255,255,255,0.02)",
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-700 pointer-events-none">
              <s.icon size={100} />
            </div>
            <div className="flex items-start justify-between mb-6 relative z-10">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner border"
                style={{ background: `${s.accent}15`, borderColor: `${s.accent}30` }}
              >
                <s.icon size={22} style={{ color: s.accent }} />
              </div>
              {s.badge && (
                <span
                  className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg shadow-red-500/10"
                  style={{ background: `${s.accent}20`, color: s.accent, border: `1px solid ${s.accent}30` }}
                >
                  {s.badge}
                </span>
              )}
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 mb-2 relative z-10">{s.label}</p>
            <h3 className="text-4xl font-black text-white leading-none tracking-tighter relative z-10">{s.value}</h3>
          </button>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

        {/* Left Column */}
        <div className="lg:col-span-2 space-y-10">

          {/* Today's Events */}
          <div
            className="rounded-[2.5rem] border overflow-hidden backdrop-blur-md shadow-2xl"
            style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
          >
            <div className="px-8 py-6 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.01]">
              <h3 className="text-[10px] font-black text-white flex items-center gap-3 uppercase tracking-[0.3em]">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center border border-red-500/20">
                  <Flame size={16} className="text-red-400" />
                </div>
                Active Deployments Today
              </h3>
              <span
                className="px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border border-blue-500/20 bg-blue-500/5 text-blue-400"
              >
                {todayEvents.length} Events Today
              </span>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {todayEvents.length === 0 ? (
                <div className="py-20 text-center text-white/10 uppercase tracking-widest text-[10px] font-black">
                  <Calendar size={40} className="mx-auto mb-4 opacity-10" />
                  No events scheduled for current cycle.
                </div>
              ) : (
                todayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="px-8 py-6 flex items-center justify-between hover:bg-white/[0.03] transition-all duration-300 group"
                  >
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/10 flex-shrink-0 bg-white/5 shadow-2xl group-hover:scale-105 transition-transform duration-500">
                        {event.thumbnail_url ? (
                          <img
                            src={event.thumbnail_url}
                            className="w-full h-full object-cover"
                            alt=""
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/20">
                            <Calendar size={24} />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                           <span className="inline-block px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border border-blue-500/20 bg-blue-500/5 text-blue-400">
                             {event.event_type}
                           </span>
                           <span className="text-[9px] font-black text-white/10 uppercase tracking-widest">{event.event_time}</span>
                        </div>
                        <h4 className="text-xl font-black text-white tracking-tight group-hover:text-blue-400 transition-colors">
                          {event.groom_name || event.celebrant_name} &amp;{" "}
                          {event.bride_name || "Family"}
                        </h4>
                        <p className="text-[10px] font-black text-white/20 uppercase tracking-widest flex items-center gap-2 mt-2">
                          <MapPin size={11} className="text-blue-500/50" />
                          {event.venue_name || "Hybrid Venue"}
                        </p>
                      </div>
                    </div>

                    <a
                      href={`https://eventcast.pro/events/${event.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all border border-white/10 text-white/20 hover:text-white hover:border-blue-500/50 hover:bg-blue-500/10 shadow-xl group-hover:rotate-12"
                    >
                      <ArrowUpRight size={20} />
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Events */}
          <div
            className="rounded-[2.5rem] border overflow-hidden backdrop-blur-md"
            style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
          >
            <div className="px-8 py-6 flex items-center justify-between border-b border-white/[0.06]">
              <h3 className="text-[10px] font-black text-white flex items-center gap-3 uppercase tracking-[0.3em]">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <TrendingUp size={16} className="text-blue-400" />
                </div>
                Future Pipeline
              </h3>
              <button
                onClick={() => setActiveTab("list")}
                className="text-[9px] font-black uppercase tracking-widest text-blue-400/60 hover:text-blue-400 transition-all bg-blue-500/5 px-4 py-2 rounded-full border border-blue-500/10"
              >
                Launch Grid Control
              </button>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {upcomingEvents.length === 0 ? (
                <div className="py-20 text-center text-white/10 uppercase tracking-widest text-[10px] font-black">
                  <Play size={40} className="mx-auto mb-4 opacity-10" />
                  No upcoming deployments in pipeline.
                </div>
              ) : (
                upcomingEvents.map((event) => (
                  <a
                    key={event.id}
                    href={`https://eventcast.pro/events/${event.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-8 py-5 hover:bg-white/[0.03] transition-all duration-300 group"
                  >
                    <div>
                      <h4 className="text-base font-black text-white/70 group-hover:text-white transition-colors tracking-tight">
                        {event.groom_name || event.celebrant_name} &amp;{" "}
                        {event.bride_name || "Family"}
                      </h4>
                      <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mt-1.5 flex items-center gap-3">
                        <span className="text-blue-500/40">{event.event_date}</span>
                        <span className="w-1 h-1 rounded-full bg-white/10" />
                        <span>{event.event_type}</span>
                      </p>
                    </div>
                    <ChevronRight
                      size={18}
                      className="text-white/10 group-hover:text-blue-500 transition-all group-hover:translate-x-1"
                    />
                  </a>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column — Recent Wishes */}
        <div
          className="rounded-[2.5rem] border overflow-hidden flex flex-col backdrop-blur-md shadow-2xl h-fit"
          style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)", maxHeight: "800px" }}
        >
          <div
            className="px-6 py-6 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.01]"
          >
            <h3 className="text-[10px] font-black text-white flex items-center gap-3 uppercase tracking-[0.3em]">
              <div className="w-8 h-8 rounded-lg bg-pink-500/10 flex items-center justify-center border border-pink-500/20">
                <Heart size={16} className="text-pink-400" />
              </div>
              Social Interaction
            </h3>
            <span
              className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-pink-500/20 bg-pink-500/5 text-pink-400"
            >
              {totalWishes} Units
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            {recentWishes.length === 0 ? (
              <div className="py-20 text-center text-white/10 uppercase tracking-widest text-[10px] font-black">
                <Heart size={40} className="mx-auto mb-4 opacity-10" />
                Waiting for inbound interactions.
              </div>
            ) : (
              recentWishes.map((wish, idx) => (
                <div
                  key={idx}
                  className="p-5 rounded-2xl border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-300 group shadow-lg"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-black flex-shrink-0 shadow-lg border border-pink-500/20 bg-pink-500/10 text-pink-400 group-hover:scale-110 transition-transform"
                      >
                        {(wish.name || "?")[0].toUpperCase()}
                      </div>
                      <h4 className="text-[11px] font-black text-white/80 uppercase tracking-widest">{wish.name}</h4>
                    </div>
                    <span className="text-[9px] text-white/20 font-black uppercase tracking-tight">
                      {new Date(wish.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="text-[13px] text-white/40 font-medium italic leading-relaxed leading-relaxed">
                    &ldquo;{wish.message}&rdquo;
                  </p>
                  {wish.events && (
                    <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-end gap-2">
                       <span className="text-[8px] font-black text-white/10 uppercase tracking-widest">Routing:</span>
                       <span className="text-[9px] font-black text-blue-400/60 uppercase tracking-widest truncate max-w-[120px]">
                        {wish.events.groom_name || wish.events.celebrant_name}
                       </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {totalWishes > 0 && (
            <div className="p-6 border-t border-white/[0.06] bg-white/[0.01]">
              <button
                onClick={() => setActiveTab("moderation")}
                className="w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-white/40 hover:text-white transition-all border border-white/[0.08] hover:border-blue-500/40 hover:bg-blue-500/10 shadow-2xl"
              >
                Launch Moderation Panel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[
          { label: "Initialize System",       sub: "Generate new event site",       tab: "create",        accent: "#8b5cf6", icon: Zap },
          { label: "Live Monitor",    sub: "Stream health & active relays",    tab: "monitor",       accent: "#ef4444", icon: Activity },
          { label: "Analytics Dashboard",  sub: "Total traffic & reach",       tab: "analytics",     accent: "#6366f1", icon: TrendingUp },
        ].map((action, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(action.tab)}
            className="flex items-center gap-6 p-6 rounded-[2rem] border text-left transition-all duration-500 group hover:translate-y-[-4px] backdrop-blur-xl shadow-2xl"
            style={{
              background: "rgba(255,255,255,0.02)",
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-inner border transition-all duration-500 group-hover:scale-110"
              style={{ background: `${action.accent}15`, borderColor: `${action.accent}30` }}
            >
              <action.icon size={22} style={{ color: action.accent }} />
            </div>
            <div>
              <p className="text-base font-black text-white tracking-tight group-hover:text-blue-400 transition-colors">{action.label}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20 mt-1">{action.sub}</p>
            </div>
            <ChevronRight size={20} className="ml-auto text-white/10 group-hover:text-blue-500 group-hover:translate-x-2 transition-all" />
          </button>
        ))}
      </div>
    </div>
  );
};
