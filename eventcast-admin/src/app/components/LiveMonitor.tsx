"use client";

import React, { useState, useEffect } from "react";
import { Monitor, Clock, Play, Heart, AlertTriangle, Radio } from "lucide-react";

interface LiveMonitorProps {
  events: any[];
  wishes: any[];
}

export const LiveMonitor: React.FC<LiveMonitorProps> = ({ events, wishes }) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const today = new Date().toISOString().split('T')[0];
  const liveEvents = events.filter(e => e.youtube_status === 'live' || e.youtube_status === 'active');
  const upcomingToday = events.filter(e => e.event_date === today && e.youtube_status !== 'live' && e.youtube_status !== 'completed');

  const todayWishes = wishes.filter(w => new Date(w.created_at).toISOString().split('T')[0] === today);

  return (
    <div className="min-h-[800px] bg-slate-900 text-slate-100 rounded-3xl p-8 shadow-2xl relative overflow-hidden flex flex-col animate-in fade-in duration-500">
      
      {/* Top Bar: Clock & Status */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-6 mb-8">
        <div className="flex items-center gap-4">
          <Monitor size={32} className="text-blue-500" />
          <div>
            <h2 className="text-2xl font-black tracking-tight">Live Event Monitor</h2>
            <p className="text-slate-400 text-sm font-bold uppercase tracking-widest flex items-center gap-2">
               <Radio size={12} className="text-green-500 animate-pulse" /> System Active
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-5xl font-black font-mono tracking-tighter text-white">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-1">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">
        
        {/* Left Column: Live Status */}
        <div className="lg:col-span-2 flex flex-col gap-8">
          
          {/* Active Live Streams */}
          <div className="bg-slate-800/50 p-6 rounded-3xl border border-slate-700/50 flex-1">
            <h3 className="text-lg font-black text-white mb-6 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" /> Active Broadcasts
            </h3>
            <div className="space-y-4">
              {liveEvents.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-slate-500 flex-col gap-2">
                  <Play size={32} className="opacity-50" />
                  <p className="font-bold">No active livestreams currently.</p>
                </div>
              ) : (
                liveEvents.map(event => (
                  <div key={event.id} className="bg-slate-800 p-6 rounded-2xl border border-red-500/30 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-black uppercase rounded border border-red-500/30 mb-2 inline-block tracking-widest">
                          🔴 LIVE NOW
                        </div>
                        <h4 className="text-2xl font-black text-white tracking-tight">{event.groom_name || event.celebrant_name} & {event.bride_name || 'Family'}</h4>
                        <p className="text-sm font-bold text-slate-400 mt-1">{event.venue_name} • {event.event_type}</p>
                      </div>
                      <div className="text-right">
                         <div className="font-mono text-xl font-black text-white">{event.view_count || 0}</div>
                         <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Current Views</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Today */}
          <div className="bg-slate-800/50 p-6 rounded-3xl border border-slate-700/50">
            <h3 className="text-lg font-black text-white mb-6 flex items-center gap-2">
              <Clock size={20} className="text-blue-500" /> Upcoming Today
            </h3>
            <div className="space-y-3">
              {upcomingToday.length === 0 ? (
                <p className="text-sm text-slate-500 font-bold">No more events scheduled for today.</p>
              ) : (
                upcomingToday.map(event => (
                  <div key={event.id} className="flex items-center justify-between p-4 bg-slate-800 rounded-xl border border-slate-700">
                    <div>
                      <h4 className="font-bold text-white">{event.groom_name || event.celebrant_name}</h4>
                      <p className="text-xs text-slate-400">{event.event_type}</p>
                    </div>
                    <div className="text-right">
                       <span className="font-mono text-blue-400 font-bold bg-blue-500/10 px-3 py-1 rounded-lg">
                         {event.timer_target_time || event.event_time || 'TBD'}
                       </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Real-time Feed */}
        <div className="bg-slate-800/50 rounded-3xl border border-slate-700/50 flex flex-col h-full overflow-hidden">
          <div className="p-6 border-b border-slate-700/50">
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <Heart size={20} className="text-pink-500" /> Live Wishes Feed
            </h3>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Today's Messages ({todayWishes.length})</p>
          </div>
          <div className="flex-1 p-6 overflow-y-auto space-y-4">
             {todayWishes.length === 0 ? (
               <div className="h-full flex items-center justify-center text-slate-500">
                 <p className="font-bold text-center">Waiting for wishes...</p>
               </div>
             ) : (
               todayWishes.map((wish, idx) => (
                 <div key={idx} className="p-4 bg-slate-800 rounded-2xl border border-slate-700 animate-in slide-in-from-right-4 duration-500 fade-in">
                   <h4 className="font-black text-white text-sm mb-1">{wish.name}</h4>
                   <p className="text-slate-300 text-sm leading-relaxed">"{wish.message}"</p>
                   {wish.events && (
                     <div className="mt-3 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">
                       For {wish.events.groom_name || wish.events.celebrant_name}
                     </div>
                   )}
                 </div>
               ))
             )}
          </div>
        </div>
        
      </div>
    </div>
  );
};
