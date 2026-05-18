"use client";

import React, { useState, useEffect } from "react";
import { Users, Smartphone, Globe, Monitor, Clock, Activity, MapPin, Eye, TrendingUp, ChevronLeft, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface AnalyticsDashboardProps {
  analyticsData: any[];
}

// Explicit class maps — Tailwind JIT must see full class strings, never interpolated fragments.
const CARD_COLORS: Record<string, { glow: string; icon: string; dot: string }> = {
  blue:   { glow: "bg-blue-500/5",   icon: "bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-blue-500/5 group-hover:bg-blue-500 group-hover:text-white",   dot: "bg-blue-500" },
  indigo: { glow: "bg-indigo-500/5", icon: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-indigo-500/5 group-hover:bg-indigo-500 group-hover:text-white", dot: "bg-indigo-500" },
  pink:   { glow: "bg-pink-500/5",   icon: "bg-pink-500/10 text-pink-400 border-pink-500/20 shadow-pink-500/5 group-hover:bg-pink-500 group-hover:text-white",   dot: "bg-pink-500" },
  amber:  { glow: "bg-amber-500/5",  icon: "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-amber-500/5 group-hover:bg-amber-500 group-hover:text-white",  dot: "bg-amber-500" },
};

const DEVICE_BAR: Record<string, string> = {
  violet: "bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.3)]",
  blue:   "bg-blue-500   shadow-[0_0_8px_rgba(59,130,246,0.3)]",
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
      .select('created_at, referrer, device_type, user_agent')
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

    if (isLoadingDetail) {
      return (
        <div className="max-w-7xl mx-auto flex items-center justify-center py-32">
          <Loader2 className="animate-spin text-blue-500" size={40} />
        </div>
      );
    }

    return (
      <div className="max-w-7xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
        <button 
          onClick={() => setSelectedEventId(null)}
          className="flex items-center gap-3 text-[10px] font-black text-white/40 uppercase tracking-widest hover:text-white transition-all bg-white/5 px-6 py-3 rounded-2xl border border-white/5 hover:border-white/10 w-fit shadow-xl group"
        >
          <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back to Analytics Hub
        </button>

        <div 
          className="p-8 md:p-12 rounded-[2.5rem] border border-white/[0.08] backdrop-blur-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-8 relative overflow-hidden"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 blur-[100px] -mr-32 -mt-32 pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-4xl font-black text-white tracking-tighter leading-tight">
              {selectedEvent.groom_name || selectedEvent.celebrant_name} & {selectedEvent.bride_name || 'Family'}
            </h2>
            <div className="flex items-center gap-3 mt-4">
              <span className="text-[10px] font-black text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20 uppercase tracking-[0.2em]">Live Stream Data</span>
              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Event Intelligence Report</span>
            </div>
          </div>
          <div className="text-right relative z-10">
            <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] mb-3">Total Accumulations</p>
            <p className="text-6xl font-black text-white leading-none tracking-tighter drop-shadow-2xl">
              {selectedEvent.view_count.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* View Intensity Graph */}
          <div className="bg-white/[0.03] p-8 rounded-[2.5rem] border border-white/[0.08] md:col-span-2 backdrop-blur-md relative group">
            <div className="flex items-center justify-between mb-10">
               <div className="flex items-center gap-4">
                 <div className="w-10 h-10 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
                   <Clock size={20} />
                 </div>
                 <div>
                   <h3 className="font-black text-white tracking-tight">View Intensity</h3>
                   <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-1">Activity over 24-hour cycle</p>
                 </div>
               </div>
               <div className="text-[9px] font-black text-white/20 uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full border border-white/5">
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
                      className={`w-full rounded-t-lg transition-all duration-700 ease-out relative overflow-hidden ${count > 0 ? 'bg-gradient-to-t from-blue-600 to-indigo-400 shadow-[0_0_15px_rgba(37,99,235,0.2)]' : 'bg-white/[0.02]'}`} 
                      style={{ height: `${Math.max(5, height)}%` }}
                    >
                      {count > 0 && <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-50" />}
                    </div>
                    <div className="absolute bottom-full mb-3 opacity-0 group-hover/bar:opacity-100 transition-all duration-300 z-50 bg-slate-900/90 backdrop-blur-md text-white text-[10px] font-black px-3 py-2 rounded-xl whitespace-nowrap shadow-2xl border border-white/10 translate-y-2 group-hover/bar:translate-y-0">
                      <p className="text-blue-400 mb-0.5">{h}</p>
                      <p className="text-lg">{count} <span className="text-[8px] opacity-40 uppercase">Views</span></p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-6 px-2 text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">
              <span>Midnight</span>
              <span>Noon Convergence</span>
              <span>Nightfall</span>
            </div>
          </div>

          <div className="space-y-8">
            {/* Sources */}
            <div className="bg-white/[0.03] p-8 rounded-[2.5rem] border border-white/[0.08] backdrop-blur-md">
              <div className="flex items-center gap-4 mb-8">
                 <div className="w-10 h-10 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center border border-emerald-500/20 shadow-lg shadow-emerald-500/5">
                   <Globe size={20} />
                 </div>
                 <h3 className="font-black text-white tracking-tight">Entry Points</h3>
              </div>
              <div className="space-y-4">
                {Object.entries(referrers).sort((a, b) => b[1] - a[1]).slice(0,4).map(([ref, count], i) => (
                  <div key={i} className="flex items-center justify-between group">
                    <span className="text-xs font-bold text-white/50 group-hover:text-white/90 transition-colors">{ref}</span>
                    <span className="text-[10px] font-black bg-white/5 px-3 py-1.5 rounded-xl text-white/40 border border-white/5 group-hover:border-white/20 transition-all">{count as number} Hits</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Devices */}
            <div className="bg-white/[0.03] p-8 rounded-[2.5rem] border border-white/[0.08] backdrop-blur-md">
              <div className="flex items-center gap-4 mb-8">
                 <div className="w-10 h-10 bg-violet-500/10 text-violet-400 rounded-2xl flex items-center justify-center border border-violet-500/20 shadow-lg shadow-violet-500/5">
                   <Smartphone size={20} />
                 </div>
                 <h3 className="font-black text-white tracking-tight">Core Devices</h3>
              </div>
              <div className="space-y-6">
                {[
                  { name: "Mobile", val: devices.Mobile, color: "violet" },
                  { name: "Desktop", val: devices.Desktop, color: "blue" }
                ].map((device, i) => {
                  const perc = Math.round((device.val / Math.max(1, selectedEvent.view_count)) * 100);
                  return (
                    <div key={i} className="space-y-3">
                      <div className="flex items-center justify-between text-[10px] font-black text-white/30 uppercase tracking-widest">
                        <span>{device.name} Terminal</span>
                        <span className="text-white/60">{perc}%</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5 shadow-inner p-[1px]">
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
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8 mb-6">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter leading-tight">
            Ecosystem <span className="text-blue-500">Intelligence</span>
          </h2>
          <p className="text-[11px] text-white/30 font-black uppercase tracking-[0.4em] mt-3 flex items-center gap-3">
            <Activity size={14} className="text-blue-500 animate-pulse" /> Global Engagement & Real-time Audience Telemetry
          </p>
        </div>
        <div className="flex items-center gap-4 px-6 py-3 bg-emerald-500/[0.08] text-emerald-400 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] border border-emerald-500/20 shadow-2xl shadow-emerald-500/10 backdrop-blur-xl">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,1)]" /> 
          Telemetry Link: ACTIVE
        </div>
      </div>
      
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        {[
          { label: "Gross Platform Traffic", value: totalViews, icon: Eye, color: "blue", sub: "Aggregated Views" },
          { label: "Active Deployments", value: analyticsData.length, icon: Activity, color: "indigo", sub: "Managed Events" },
          { label: "Average Engagement", value: avgViews, icon: Users, color: "pink", sub: "Avg Views / Event" },
          { label: "Unique Reach", value: uniqueVisitors, icon: Smartphone, color: "amber", sub: "Estimated Terminals" }
        ].map((card, i) => (
          <div key={i} className="relative group">
            <div className={`absolute inset-0 ${CARD_COLORS[card.color].glow} blur-[40px] opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
            <div className="p-8 bg-white/[0.02] rounded-[2.5rem] border border-white/[0.08] relative z-10 backdrop-blur-3xl shadow-2xl transition-all duration-500 group-hover:translate-y-[-8px] group-hover:border-white/20 group-hover:bg-white/[0.04]">
              <div className="flex items-center justify-between mb-8">
                <p className="text-white/20 text-[10px] font-black uppercase tracking-[0.3em]">{card.label}</p>
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-lg transition-all duration-500 group-hover:scale-110 ${CARD_COLORS[card.color].icon}`}>
                  <card.icon size={22} />
                </div>
              </div>
              <p className="text-5xl font-black text-white tracking-tighter leading-none mb-4 group-hover:text-blue-400 transition-colors">
                {card.value.toLocaleString()}
              </p>
              <div className="flex items-center gap-2.5">
                <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.2)] ${CARD_COLORS[card.color].dot}`} />
                <p className="text-[9px] text-white/30 font-black uppercase tracking-[0.2em]">{card.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Deep Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        
        {/* Performance Breakdown */}
        <div className="lg:col-span-3 bg-white/[0.015] p-10 lg:p-14 rounded-[3.5rem] border border-white/[0.08] backdrop-blur-3xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-20 opacity-[0.02] pointer-events-none rotate-12">
            <TrendingUp size={300} />
          </div>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-14 gap-6 relative z-10">
            <div>
              <h3 className="text-xl font-black text-white flex items-center gap-4 tracking-tight">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
                  <TrendingUp size={20} className="text-blue-400"/>
                </div>
                Event Views Leaderboard
              </h3>
              <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.4em] mt-2 ml-14">Top ranking events by view count</p>
            </div>
            <div className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] bg-white/[0.03] px-6 py-3 rounded-2xl border border-white/[0.06]">
              Real-time Ranking Engine
            </div>
          </div>

          <div className="space-y-6 relative z-10">
            {analyticsData.sort((a,b) => (b.view_count||0) - (a.view_count||0)).map((event, idx) => (
              <div 
                key={event.id} 
                onClick={() => setSelectedEventId(event.id)}
                className="flex items-center justify-between p-6 lg:p-8 bg-white/[0.02] rounded-[2rem] hover:bg-white/[0.06] cursor-pointer hover:shadow-2xl transition-all duration-500 border border-white/[0.05] hover:border-blue-500/40 group relative overflow-hidden active:scale-[0.99]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex items-center gap-8 relative z-10">
                  <div className="w-14 h-14 bg-white/[0.03] rounded-2xl flex items-center justify-center font-black text-white/20 border border-white/[0.08] shadow-2xl group-hover:scale-110 group-hover:text-blue-400 group-hover:border-blue-500/40 transition-all duration-700 text-lg">
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  <div>
                    <p className="font-black text-white text-xl tracking-tight group-hover:text-blue-400 transition-all duration-500">
                      {event.groom_name || event.celebrant_name}
                      {event.bride_name && event.bride_name.toLowerCase() !== 'family' && (
                        <span className="text-white/40 font-medium"> & {event.bride_name}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-[9px] font-black text-blue-500/80 uppercase tracking-[0.2em] bg-blue-500/10 px-3 py-1 rounded-lg border border-blue-500/20">{event.event_type}</span>
                      <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em] flex items-center gap-2">
                        <Clock size={12} /> {event.event_date}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="text-right flex items-center gap-14 relative z-10">
                  <div className="hidden lg:flex flex-col items-end gap-3 w-56">
                    <div className="flex justify-between w-full text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">
                      <span>Intensity</span>
                      <span className="text-blue-400">{Math.round(((event.view_count || 0) / Math.max(1, analyticsData[0]?.view_count || 1)) * 100)}%</span>
                    </div>
                    <div className="w-full bg-white/[0.03] h-2 rounded-full overflow-hidden border border-white/[0.08] shadow-inner p-[1px]">
                      <div 
                        className="bg-gradient-to-r from-blue-600 to-indigo-500 h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(37,99,235,0.4)]" 
                        style={{ width: `${Math.min(100, ((event.view_count || 0) / Math.max(1, analyticsData[0]?.view_count || 1)) * 100)}%` }} 
                      />
                    </div>
                  </div>
                  <div className="min-w-[100px]">
                    <p className="font-black text-white text-3xl tracking-tighter leading-none group-hover:scale-110 transition-transform duration-500 group-hover:text-blue-400">{(event.view_count || 0).toLocaleString()}</p>
                    <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.3em] mt-2.5">Total Views</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
