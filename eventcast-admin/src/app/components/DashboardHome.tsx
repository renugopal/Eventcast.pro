"use client";

import React, { useState, useEffect } from "react";
import {
  Calendar, Activity, Eye, Heart, Play, TrendingUp, Zap,
  ChevronRight, ArrowUpRight, MapPin, Plus, Wallet,
  Users, BarChart3, Image, Crown, Clock,
} from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { supabase } from "@/lib/supabase";

interface DashboardHomeProps {
  events: any[];
  wishes: any[];
  analyticsData: any[];
  setActiveTab: (tab: string) => void;
  studioId?: string | null;
  isSuperAdmin?: boolean;
  userPlan?: string;
}

// Animated counter hook
function useCountUp(target: number, duration = 800) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return count;
}

// Stat Card Component
const StatCard = ({
  label, value, icon: Icon, accentColor, bgColor, onClick, badge, delay = 0,
}: {
  label: string; value: number | string; icon: any;
  accentColor: string; bgColor: string; onClick?: () => void;
  badge?: string; delay?: number;
}) => {
  const numVal = typeof value === "number" ? value : 0;
  const displayVal = useCountUp(numVal);

  return (
    <button
      onClick={onClick}
      className="ec-stat-card ec-animate-in"
      style={{
        animationDelay: `${delay}ms`,
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
        width: "100%",
      }}
    >
      {/* Left accent bar */}
      <div className="ec-stat-accent" style={{ background: accentColor }} />

      {/* Icon */}
      <div
        className="ec-stat-icon"
        style={{ background: bgColor }}
      >
        <Icon size={20} style={{ color: accentColor }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1 }}>
        <div className="ec-stat-label">{label}</div>
        <div className="ec-stat-value" style={{ color: accentColor }}>
          {typeof value === "number" ? displayVal.toLocaleString() : value}
        </div>
        {badge && (
          <span
            className="ec-badge"
            style={{
              background: bgColor,
              color: accentColor,
              border: `1px solid ${accentColor}30`,
              marginTop: "6px",
            }}
          >
            <span
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: accentColor,
                animation: "pulse-dot 1.5s infinite",
                display: "inline-block",
              }}
            />
            {badge}
          </span>
        )}
        {!badge && (
          <div className="ec-stat-sub">
            {onClick ? "Click to view →" : ""}
          </div>
        )}
      </div>
    </button>
  );
};

export const DashboardHome: React.FC<DashboardHomeProps> = ({
  events, wishes, analyticsData, setActiveTab,
  studioId, isSuperAdmin = false, userPlan = "free",
}) => {
  const [activeStreams, setActiveStreams] = useState(0);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [platformStats, setPlatformStats] = useState<{
    totalUsers: number; totalEvents: number; totalStorage: number;
  } | null>(null);

  const totalEvents = events.length;
  const totalViews  = analyticsData.reduce((s, e) => s + (e.view_count || 0), 0);
  const totalWishes = wishes.length;

  const today        = new Date().toISOString().split("T")[0];
  const nextWeekDate = new Date();
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const nextWeekStr  = nextWeekDate.toISOString().split("T")[0];

  const todayEvents    = events.filter(e => e.event_date === today);
  const upcomingEvents = events
    .filter(e => e.event_date > today && e.event_date <= nextWeekStr)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  // Fetch live stream count
  useEffect(() => {
    authFetch("/api/media/live-status")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.activeProcesses)
          setActiveStreams(d.activeProcesses.filter((p: any) => p.state === "running").length);
      })
      .catch(() => {});
    const t = setInterval(() => {
      authFetch("/api/media/live-status")
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.activeProcesses)
            setActiveStreams(d.activeProcesses.filter((p: any) => p.state === "running").length);
        });
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Fetch wallet balance
  useEffect(() => {
    if (!studioId) return;
    authFetch(`/api/billing/balance?studio_id=${studioId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setWalletBalance(d.balance_paise / 100); })
      .catch(() => {});
  }, [studioId]);

  // Fetch platform-wide stats for Super Admin
  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from("studio_members").select("user_id", { count: "exact", head: true })
      .then(({ count }) => {
        supabase.from("events").select("id", { count: "exact", head: true })
          .then(({ count: evCount }) => {
            setPlatformStats({
              totalUsers:   count   ?? 0,
              totalEvents:  evCount ?? 0,
              totalStorage: 0,
            });
          });
      });
  }, [isSuperAdmin]);

  const planLabel: Record<string, string> = {
    free: "Free Trial", pay_per_use: "Pay Per Use",
    basic: "Basic", professional: "Professional",
    business: "Business", enterprise: "Enterprise",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px", width: "100%" }}>

      {/* ── Page Header ── */}
      <div className="ec-section-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="ec-page-title">
            {isSuperAdmin ? "Platform Overview" : "Dashboard"}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginTop: "4px" }}>
            {isSuperAdmin
              ? "Platform-wide analytics and controls"
              : `Welcome back! Here's what's happening with your events.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {activeStreams > 0 && (
            <div className="ec-badge ec-badge-live" style={{ fontSize: "12px", padding: "6px 14px" }}>
              {activeStreams} Live Now
            </div>
          )}
          <button
            className="ec-btn ec-btn-primary"
            onClick={() => setActiveTab("create")}
          >
            <Plus size={16} />
            New Event
          </button>
        </div>
      </div>

      {/* ── Super Admin: Platform Stats Bar ── */}
      {isSuperAdmin && platformStats && (
        <div
          className="ec-super-admin-bar ec-animate-in"
          style={{
            background: "linear-gradient(135deg, var(--primary) 0%, var(--violet-500) 100%)",
            borderRadius: "var(--radius-lg)",
            padding: "16px 24px",
            color: "#FFF",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Crown size={18} style={{ color: "#FDE68A" }} />
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "13px" }}>
              Super Admin
            </span>
          </div>
          <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.2)" }} />
          {[
            { label: "Total Users",  value: platformStats.totalUsers },
            { label: "Total Events", value: platformStats.totalEvents },
          ].map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: "11px", opacity: 0.7, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "18px" }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Stats Cards Grid ── */}
      <div className="ec-grid-stats">
        <StatCard
          label="Total Events"
          value={totalEvents}
          icon={Calendar}
          accentColor="#5B21B6"
          bgColor="#F5F3FF"
          onClick={() => setActiveTab("list")}
          delay={0}
        />
        <StatCard
          label="Active Streams"
          value={activeStreams}
          icon={Activity}
          accentColor="#EF4444"
          bgColor="#FFF1F2"
          badge={activeStreams > 0 ? "LIVE" : undefined}
          onClick={() => setActiveTab("monitor")}
          delay={60}
        />
        <StatCard
          label="Total Views"
          value={totalViews}
          icon={Eye}
          accentColor="#6366F1"
          bgColor="#EEF2FF"
          onClick={() => setActiveTab("analytics")}
          delay={120}
        />
        <StatCard
          label="Wallet Balance"
          value={walletBalance !== null ? `₹${walletBalance.toFixed(0)}` : "—"}
          icon={Wallet}
          accentColor="#F59E0B"
          bgColor="#FFFBEB"
          onClick={() => setActiveTab("billing")}
          delay={180}
        />
      </div>

      {/* ── Plan Status Bar ── */}
      {!isSuperAdmin && (
        <div
          className="ec-animate-in ec-animate-in-delay-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            padding: "12px 20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>
              Current Plan:
            </span>
            <span
              className="ec-badge"
              style={{
                background: "var(--violet-50)",
                color: "var(--primary)",
                border: "1px solid var(--violet-200)",
              }}
            >
              {planLabel[userPlan] ?? "Free Trial"}
            </span>
          </div>
          {(userPlan === "free" || userPlan === "pay_per_use") && (
            <button
              type="button"
              className="ec-btn ec-btn-primary"
              onClick={() => setActiveTab("billing")}
            >
              Upgrade plan
            </button>
          )}
        </div>
      )}

      {/* ── Main Content Grid ── */}
      <div className="ec-grid-dash">

        {/* Today's Events */}
        <div className="ec-card ec-card-span-2" style={{ padding: 0, overflow: "hidden" }}>
          <div
            className="ec-section-header"
            style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", marginBottom: 0 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#FFF1F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Activity size={16} color="#EF4444" />
              </div>
              <span className="ec-section-title" style={{ fontSize: "14px" }}>
                Today's Events
                <span className="ec-badge ec-badge-scheduled" style={{ marginLeft: 8 }}>
                  {todayEvents.length}
                </span>
              </span>
            </div>
          </div>

          {todayEvents.length === 0 ? (
            <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-tertiary)" }}>
              <Calendar size={36} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
              <p style={{ fontSize: "13px", fontWeight: 600 }}>No events today</p>
            </div>
          ) : (
            todayEvents.map((event) => (
              <div
                key={event.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 12, overflow: "hidden",
                    background: "var(--surface-hover)", flexShrink: 0,
                    border: "1px solid var(--border-subtle)",
                  }}>
                    {event.thumbnail_url
                      ? <img src={event.thumbnail_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                      : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)" }}><Calendar size={20} /></div>
                    }
                  </div>
                  <div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                      <span className="ec-badge" style={{ background: "var(--violet-50)", color: "var(--primary)", border: "1px solid var(--violet-200)", fontSize: "10px" }}>
                        {event.event_type}
                      </span>
                      {event.event_time && (
                        <span style={{ fontSize: "11px", color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 3 }}>
                          <Clock size={10} /> {event.event_time}
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--foreground)", fontSize: "14px" }}>
                      {event.groom_name || event.celebrant_name} & {event.bride_name || "Family"}
                    </div>
                    {event.venue_name && (
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                        <MapPin size={10} /> {event.venue_name}
                      </div>
                    )}
                  </div>
                </div>
                <a
                  href={`https://eventcast.pro/events/${event.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ec-icon-btn"
                  title="Open event page"
                >
                  <ArrowUpRight size={16} />
                </a>
              </div>
            ))
          )}
        </div>

        {/* Upcoming Events — right column */}
        <div className="ec-card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            className="ec-section-header"
            style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", marginBottom: 0 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TrendingUp size={16} color="#3B82F6" />
              </div>
              <span className="ec-section-title" style={{ fontSize: "14px" }}>Upcoming</span>
            </div>
            <button
              type="button"
              className="ec-btn ec-btn-secondary"
              onClick={() => setActiveTab("list")}
            >
              View all
            </button>
          </div>

          <div style={{ overflow: "hidden" }}>
            {upcomingEvents.length === 0 ? (
              <div style={{ padding: "36px 20px", textAlign: "center", color: "var(--text-tertiary)" }}>
                <Play size={28} style={{ margin: "0 auto 10px", opacity: 0.3 }} />
                <p style={{ fontSize: "12px" }}>No upcoming events this week</p>
              </div>
            ) : (
              upcomingEvents.slice(0, 6).map(event => (
                <div
                  key={event.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)",
                    cursor: "pointer", transition: "background 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--foreground)" }}>
                      {event.groom_name || event.celebrant_name}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 2 }}>
                      {event.event_date} · {event.event_type}
                    </div>
                  </div>
                  <ChevronRight size={15} color="var(--text-tertiary)" />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="ec-grid-quick">
        {[
          { label: "Create Event",   sub: "Start a new event site",          tab: "create",    color: "#5B21B6", bg: "#F5F3FF", icon: Zap },
          { label: "Live Monitor",   sub: "Stream health & active relays",    tab: "monitor",   color: "#EF4444", bg: "#FFF1F2", icon: Activity },
          { label: "Analytics",      sub: "Views, reach & geo data",          tab: "analytics", color: "#6366F1", bg: "#EEF2FF", icon: BarChart3 },
        ].map((a, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(a.tab)}
            className="ec-card ec-animate-in"
            style={{
              display: "flex", alignItems: "center", gap: "14px",
              cursor: "pointer", textAlign: "left",
              animationDelay: `${i * 60}ms`,
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: a.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${a.color}20` }}>
              <a.icon size={20} style={{ color: a.color }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--foreground)" }}>{a.label}</div>
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 2 }}>{a.sub}</div>
            </div>
            <ChevronRight size={16} style={{ marginLeft: "auto", color: "var(--text-tertiary)" }} />
          </button>
        ))}
      </div>
    </div>
  );
};
