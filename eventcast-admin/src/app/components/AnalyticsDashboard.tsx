"use client";

import React, { useState, useEffect } from "react";
import { Users, Smartphone, Globe, Clock, Activity, MapPin, Eye, TrendingUp, ChevronLeft, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { WorldMap, CountryStat, COUNTRY_NAMES } from "./WorldMap";

interface AnalyticsDashboardProps {
  analyticsData: any[];
}

// Explicit class maps — Tailwind JIT must see full class strings, never interpolated fragments.
const CARD_COLORS: Record<string, { glow: string; icon: string; dot: string; accent: string; iconBg: string }> = {
  blue:   { glow: "bg-blue-50",   icon: "bg-blue-50 text-blue-600 border-blue-200 group-hover:bg-blue-600 group-hover:text-white",     dot: "bg-blue-500",   accent: "#2563eb", iconBg: "#eff6ff" },
  indigo: { glow: "bg-indigo-50", icon: "bg-indigo-50 text-indigo-600 border-indigo-200 group-hover:bg-indigo-600 group-hover:text-white", dot: "bg-indigo-500", accent: "#4f46e5", iconBg: "#eef2ff" },
  pink:   { glow: "bg-pink-50",   icon: "bg-pink-50 text-pink-600 border-pink-200 group-hover:bg-pink-600 group-hover:text-white",       dot: "bg-pink-500",   accent: "#db2777", iconBg: "#fdf2f8" },
  amber:  { glow: "bg-amber-50",  icon: "bg-amber-50 text-amber-600 border-amber-200 group-hover:bg-amber-600 group-hover:text-white",    dot: "bg-amber-500",  accent: "#d97706", iconBg: "#fffbeb" },
};

const DEVICE_BAR: Record<string, string> = {
  violet: "bg-violet-500",
  blue:   "bg-blue-500",
};

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ analyticsData }) => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [rawViews, setRawViews] = useState<any[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const totalViews = analyticsData.reduce((acc, curr) => acc + (curr.view_count || 0), 0);
  const avgViews = analyticsData.length > 0 ? Math.round(totalViews / analyticsData.length) : 0;
  const uniqueVisitors = Math.round(totalViews * 0.65); // Realistic unique visitor estimation

  const selectedEvent = analyticsData.find(e => e.id === selectedEventId);

  // Lazy-load raw rows only for the selected event (single-event fetch, not thousands of rows)
  useEffect(() => {
    if (!selectedEventId) { setRawViews([]); return; }
    setIsLoadingDetail(true);
    supabase
      .from('page_views')
      .select('created_at, referrer, device_type, user_agent, country')
      .eq('event_id', selectedEventId)
      .then(({ data }) => {
        setRawViews(data || []);
        setIsLoadingDetail(false);
      });
  }, [selectedEventId]);

  // Detailed Analytics View
  if (selectedEvent) {
    
    // Group by hour
    const viewsByHour: Record<string, number> = {};
    rawViews.forEach((v: any) => {
      const date = new Date(v.created_at);
      const hour = date.getHours();
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const formattedHour = `${hour % 12 || 12} ${ampm}`;
      viewsByHour[formattedHour] = (viewsByHour[formattedHour] || 0) + 1;
    });

    const peakHour = Object.keys(viewsByHour).reduce((a, b) => viewsByHour[a] > viewsByHour[b] ? a : b, 'N/A');

    // Group by referrer
    const referrers: Record<string, number> = {};
    rawViews.forEach((v: any) => {
      let ref = v.referrer || 'Direct';
      if (ref.includes('whatsapp')) ref = 'WhatsApp';
      else if (ref.includes('instagram')) ref = 'Instagram';
      else if (ref.includes('facebook')) ref = 'Facebook';
      referrers[ref] = (referrers[ref] || 0) + 1;
    });

    // Group by device (assuming user_agent or device_type is present, falling back to simple logic for demo if device_type is null)
    const devices = { Mobile: 0, Desktop: 0, Tablet: 0 };
    rawViews.forEach((v: any) => {
      const type = v.device_type || (v.user_agent?.toLowerCase().includes('mobile') ? 'Mobile' : 'Desktop');
      if (type === 'Mobile') devices.Mobile++;
      else if (type === 'Tablet') devices.Tablet++;
      else devices.Desktop++;
    });

    // ── Geo-Location Aggregation ──────────────────────────────────────────────
    const countryCounts: Record<string, number> = {};
    rawViews.forEach((v: any) => {
      const code = (v.country && v.country !== 'Unknown') ? v.country : 'Unknown';
      countryCounts[code] = (countryCounts[code] || 0) + 1;
    });
    const totalForPct = rawViews.length || 1;
    const countryStats: CountryStat[] = Object.entries(countryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        country: code,
        label: COUNTRY_NAMES[code] || code,
        count,
        percentage: Math.round((count / totalForPct) * 1000) / 10,
      }));
    const topCountries = countryStats.slice(0, 8);


    if (isLoadingDetail) {
      return (
        <div className="w-full flex items-center justify-center py-32">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      );
    }

    return (
      <div className="w-full space-y-8 animate-in slide-in-from-bottom-4 duration-500">
        <button
          type="button"
          onClick={() => setSelectedEventId(null)}
          className="ec-btn ec-btn-secondary ec-btn-sm group"
        >
          <ChevronLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
          Back to Analytics Hub
        </button>

        <div className="ec-card flex flex-col md:flex-row justify-between items-start md:items-center gap-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-100/60 blur-[100px] -mr-32 -mt-32 pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight" style={{ color: "var(--foreground)" }}>
              {selectedEvent.groom_name || selectedEvent.celebrant_name} & {selectedEvent.bride_name || 'Family'}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-200 uppercase tracking-wide">Live Stream Data</span>
              <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>Event Intelligence Report</span>
            </div>
          </div>
          <div className="text-right relative z-10">
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-secondary)" }}>Total Accumulations</p>
            <p className="text-5xl md:text-6xl font-black leading-none tracking-tight" style={{ color: "var(--foreground)" }}>
              {selectedEvent.view_count.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* View Intensity Graph */}
          <div className="ec-card md:col-span-2 relative">
            <div className="flex items-center justify-between mb-8">
               <div className="flex items-center gap-4">
                 <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-200">
                   <Clock size={20} />
                 </div>
                 <div>
                   <h3 className="font-bold tracking-tight" style={{ color: "var(--foreground)" }}>View Intensity</h3>
                   <p className="text-xs font-medium mt-1" style={{ color: "var(--text-tertiary)" }}>Activity over 24-hour cycle</p>
                 </div>
               </div>
               <div className="text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full border border-gray-200 bg-gray-50" style={{ color: "var(--text-secondary)" }}>
                 Real-time Heatmap
               </div>
            </div>
            
            <div className="h-48 flex items-end gap-2 px-2">
              {['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'].map((h, i) => {
                const count = viewsByHour[h] || 0;
                const maxCount = Math.max(...Object.values(viewsByHour), 1);
                const height = (count / maxCount) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center group/bar relative h-full justify-end">
                    <div 
                      className={`w-full rounded-t-md transition-all duration-700 ease-out relative overflow-hidden ${count > 0 ? 'bg-gradient-to-t from-blue-600 to-blue-400' : 'bg-gray-100'}`} 
                      style={{ height: `${Math.max(5, height)}%` }}
                    />
                    <div className="absolute bottom-full mb-3 opacity-0 group-hover/bar:opacity-100 transition-all duration-300 z-50 bg-white text-[10px] font-semibold px-3 py-2 rounded-xl whitespace-nowrap shadow-lg border border-gray-200 translate-y-2 group-hover/bar:translate-y-0">
                      <p className="text-blue-600 mb-0.5">{h}</p>
                      <p className="text-base" style={{ color: "var(--foreground)" }}>{count} <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>Views</span></p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-6 px-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
              <span>Midnight</span>
              <span>Noon Convergence</span>
              <span>Nightfall</span>
            </div>
          </div>

          <div className="space-y-6">
            {/* Sources */}
            <div className="ec-card">
              <div className="flex items-center gap-4 mb-6">
                 <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-200">
                   <Globe size={20} />
                 </div>
                 <h3 className="font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Entry Points</h3>
              </div>
              <div className="space-y-3">
                {Object.entries(referrers).sort((a, b) => b[1] - a[1]).slice(0,4).map(([ref, count], i) => (
                  <div key={i} className="flex items-center justify-between group py-2 px-3 rounded-lg border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors">
                    <span className="text-sm font-medium group-hover:text-[var(--foreground)] transition-colors" style={{ color: "var(--text-secondary)" }}>{ref}</span>
                    <span className="text-xs font-semibold bg-gray-100 px-3 py-1 rounded-lg border border-gray-200" style={{ color: "var(--text-secondary)" }}>{count as number} Hits</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Devices */}
            <div className="ec-card">
              <div className="flex items-center gap-4 mb-6">
                 <div className="w-10 h-10 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center border border-violet-200">
                   <Smartphone size={20} />
                 </div>
                 <h3 className="font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Core Devices</h3>
              </div>
              <div className="space-y-5">
                {[
                  { name: "Mobile", val: devices.Mobile, color: "violet" },
                  { name: "Desktop", val: devices.Desktop, color: "blue" }
                ].map((device, i) => {
                  const perc = Math.round((device.val / Math.max(1, selectedEvent.view_count)) * 100);
                  return (
                    <div key={i} className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                        <span>{device.name} Terminal</span>
                        <span style={{ color: "var(--foreground)" }}>{perc}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ease-out ${DEVICE_BAR[device.color]}`} 
                          style={{ width: `${perc}%` }} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Geo-Location World Map Card ───────────────────────────── */}
        <div className="ec-card relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-50 blur-[120px] pointer-events-none" />
          <div className="relative z-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center border border-blue-200">
                  <Globe size={20} />
                </div>
                <div>
                  <h3 className="font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Viewer Distribution</h3>
                  <p className="text-xs font-medium mt-1" style={{ color: "var(--text-tertiary)" }}>Real-time geo-location telemetry</p>
                </div>
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-xl border border-gray-200 bg-gray-50" style={{ color: "var(--text-secondary)" }}>
                {countryStats.length} {countryStats.length === 1 ? 'Country' : 'Countries'} Detected
              </div>
            </div>

            {countryStats.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Globe size={48} className="text-gray-300" />
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>No geo-location data yet</p>
                <p className="text-xs text-center max-w-md" style={{ color: "var(--text-tertiary)" }}>Views captured before this feature was enabled show &apos;Unknown&apos;</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Map — takes 2/3 width */}
                <div className="lg:col-span-2">
                  <WorldMap data={countryStats} />
                </div>

                {/* Leaderboard — takes 1/3 width */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-4 flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                    <MapPin size={12} className="text-blue-600" /> Top Origins
                  </p>
                  {topCountries.map((cs, i) => (
                    <div
                      key={cs.country}
                      className="group flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-200 hover:border-blue-200 hover:shadow-md hover:bg-blue-50/30 transition-all duration-200"
                    >
                      {/* Rank */}
                      <span className="text-xs font-bold w-5 text-right flex-shrink-0" style={{ color: "var(--text-tertiary)" }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {/* Flag */}
                      <span className="text-lg leading-none flex-shrink-0">{cs.country === 'Unknown' ? '🌐' : cs.country.length === 2 ? String.fromCodePoint(0x1F1E0 - 0x41 + cs.country.charCodeAt(0)) + String.fromCodePoint(0x1F1E0 - 0x41 + cs.country.charCodeAt(1)) : '🌐'}</span>
                      {/* Name + bar */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold truncate transition-colors group-hover:text-blue-700" style={{ color: "var(--foreground)" }}>{cs.label}</span>
                          <span className="text-xs font-medium ml-2 flex-shrink-0" style={{ color: "var(--text-secondary)" }}>{cs.count}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all duration-1000"
                            style={{ width: `${cs.percentage}%` }}
                          />
                        </div>
                      </div>
                      {/* Percentage */}
                      <span className="text-xs font-bold text-blue-600 flex-shrink-0 w-10 text-right">{cs.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700 ec-analytics-page">
      <div className="ec-section-header gap-6">
        <div>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight" style={{ color: "var(--foreground)" }}>
            Ecosystem <span className="text-blue-600">Intelligence</span>
          </h2>
          <p className="text-xs md:text-[13px] font-medium uppercase tracking-wide mt-3 flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
            <Activity size={14} className="text-blue-600 animate-pulse" /> Global Engagement & Real-time Audience Telemetry
          </p>
        </div>
        <div className="flex items-center gap-3 px-5 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-semibold uppercase tracking-wide border border-emerald-200">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Telemetry Link: ACTIVE
        </div>
      </div>
      
      {/* Overview Cards */}
      <div className="ec-grid-stats">
        {[
          { label: "Gross Platform Traffic", value: totalViews, icon: Eye, color: "blue", sub: "Aggregated Views" },
          { label: "Active Deployments", value: analyticsData.length, icon: Activity, color: "indigo", sub: "Managed Events" },
          { label: "Average Engagement", value: avgViews, icon: Users, color: "pink", sub: "Avg Views / Event" },
          { label: "Unique Reach", value: uniqueVisitors, icon: Smartphone, color: "amber", sub: "Estimated Terminals" }
        ].map((card, i) => {
          const colors = CARD_COLORS[card.color];
          return (
            <div key={i} className="relative group">
              <div className={`absolute inset-0 ${colors.glow} blur-2xl opacity-0 group-hover:opacity-60 transition-opacity duration-500 rounded-2xl`} />
              <div className="ec-stat-card relative z-10">
                <div className="ec-stat-accent" style={{ background: colors.accent }} />
                <div className="ec-stat-icon" style={{ background: colors.iconBg }}>
                  <card.icon size={20} style={{ color: colors.accent }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ec-stat-label">{card.label}</div>
                  <div className="ec-stat-value" style={{ color: colors.accent }}>
                    {card.value.toLocaleString()}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                    <p className="text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>{card.sub}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deep Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Performance Breakdown */}
        <div className="lg:col-span-3 ec-card ec-analytics-leaderboard relative overflow-hidden">
          <div className="absolute top-0 right-0 p-16 opacity-[0.04] pointer-events-none rotate-12 text-blue-600">
            <TrendingUp size={240} />
          </div>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6 relative z-10">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-3 tracking-tight" style={{ color: "var(--foreground)" }}>
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-200">
                  <TrendingUp size={20} className="text-blue-600"/>
                </div>
                Event Views Leaderboard
              </h3>
              <p className="text-xs font-medium uppercase tracking-wide mt-2 ml-[52px]" style={{ color: "var(--text-tertiary)" }}>Top ranking events by view count</p>
            </div>
            <div className="text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-xl border border-gray-200 bg-gray-50" style={{ color: "var(--text-secondary)" }}>
              Real-time Ranking Engine
            </div>
          </div>

          <div className="ec-analytics-leaderboard-list relative z-10">
            {analyticsData.sort((a,b) => (b.view_count||0) - (a.view_count||0)).map((event, idx) => {
              const intensityPct = Math.round(((event.view_count || 0) / Math.max(1, analyticsData[0]?.view_count || 1)) * 100);
              return (
                <div 
                  key={event.id} 
                  onClick={() => setSelectedEventId(event.id)}
                  className="ec-analytics-leaderboard-row group"
                >
                  <div className="ec-analytics-leaderboard-main">
                    <div className="w-11 h-11 bg-gray-50 rounded-xl flex items-center justify-center font-bold border border-gray-200 text-sm group-hover:scale-105 group-hover:text-blue-600 group-hover:border-blue-300 group-hover:bg-blue-50 transition-all duration-300 shrink-0" style={{ color: "var(--text-tertiary)" }}>
                      {String(idx + 1).padStart(2, '0')}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-lg tracking-tight truncate group-hover:text-blue-700 transition-colors" style={{ color: "var(--foreground)" }}>
                        {event.groom_name || event.celebrant_name}
                        {event.bride_name && event.bride_name.toLowerCase() !== 'family' && (
                          <span className="font-medium" style={{ color: "var(--text-secondary)" }}> & {event.bride_name}</span>
                        )}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200">{event.event_type}</span>
                        <span className="text-xs font-medium uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
                          <Clock size={12} /> {event.event_date}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="ec-analytics-leaderboard-intensity">
                    <div className="flex justify-between w-full text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
                      <span>Intensity</span>
                      <span className="text-blue-600">{intensityPct}%</span>
                    </div>
                    <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200">
                      <div 
                        className="bg-blue-500 h-full rounded-full transition-all duration-1000 ease-out" 
                        style={{ width: `${Math.min(100, intensityPct)}%` }} 
                      />
                    </div>
                  </div>
                  <div className="ec-analytics-leaderboard-views">
                    <p className="font-black text-xl md:text-2xl tracking-tight leading-none group-hover:text-blue-600 transition-colors" style={{ color: "var(--foreground)" }}>{(event.view_count || 0).toLocaleString()}</p>
                    <p className="text-xs font-medium uppercase tracking-wide mt-1" style={{ color: "var(--text-tertiary)" }}>Total Views</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};
