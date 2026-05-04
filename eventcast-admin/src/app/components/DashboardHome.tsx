"use client";

import React from "react";
import { Activity, Calendar, Eye, Heart, Play, Clock, ChevronRight } from "lucide-react";

interface DashboardHomeProps {
  events: any[];
  wishes: any[];
  analyticsData: any[];
  setActiveTab: (tab: string) => void;
}

export const DashboardHome: React.FC<DashboardHomeProps> = ({ events, wishes, analyticsData, setActiveTab }) => {
  // Stats
  const totalEvents = events.length;
  const activeEvents = events.filter(e => e.youtube_status === 'live' || e.youtube_status === 'active').length;
  const totalViews = analyticsData.reduce((sum, e) => sum + (e.view_count || 0), 0);
  const totalWishes = wishes.length;

  // Today's Events
  const today = new Date().toISOString().split('T')[0];
  const todayEvents = events.filter(e => e.event_date === today);

  // Upcoming Events (Next 7 days, excluding today)
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];
  
  const upcomingEvents = events.filter(e => {
    return e.event_date > today && e.event_date <= nextWeekStr;
  }).sort((a, b) => a.event_date.localeCompare(b.event_date));

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Welcome back, Admin</h2>
        <p className="text-slate-500 font-medium mt-1">Here's what's happening with your events today.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
              <Calendar size={24} />
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Total Events</p>
              <h3 className="text-2xl font-black text-slate-800 leading-none mt-1">{totalEvents}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
              <Activity size={24} />
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Active Livestreams</p>
              <h3 className="text-2xl font-black text-slate-800 leading-none mt-1">{activeEvents}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
              <Eye size={24} />
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Total Page Views</p>
              <h3 className="text-2xl font-black text-slate-800 leading-none mt-1">{totalViews}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setActiveTab('moderation')}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-pink-50 text-pink-600 rounded-2xl flex items-center justify-center">
              <Heart size={24} />
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Total Wishes</p>
              <h3 className="text-2xl font-black text-slate-800 leading-none mt-1">{totalWishes}</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Events */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Today's Events */}
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Play className="text-red-500" size={20} /> Today's Events
              </h3>
              <span className="px-3 py-1 bg-blue-50 text-blue-600 text-[10px] font-black uppercase rounded-full border border-blue-100">
                {todayEvents.length} Events
              </span>
            </div>
            <div className="divide-y divide-slate-50">
              {todayEvents.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                  <p className="font-bold">No events scheduled for today.</p>
                </div>
              ) : (
                todayEvents.map(event => (
                  <div key={event.id} className="p-6 hover:bg-slate-50 transition-colors flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl overflow-hidden border border-slate-200 flex-shrink-0">
                        {event.thumbnail_url ? (
                          <img src={event.thumbnail_url} className="w-full h-full object-cover" alt="Thumb" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <Calendar size={24} />
                          </div>
                        )}
                      </div>
                      <div>
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[9px] font-black uppercase rounded border border-blue-100 mb-1 inline-block">
                          {event.event_type}
                        </span>
                        <h4 className="text-base font-black text-slate-800">{event.groom_name || event.celebrant_name} & {event.bride_name || 'Family'}</h4>
                        <p className="text-xs text-slate-500 font-medium flex items-center gap-1 mt-1">
                          <Clock size={12} /> {event.event_time} • {event.venue_name}
                        </p>
                      </div>
                    </div>
                    <a 
                      href={`https://eventcast.pro/events/${event.slug}`} 
                      target="_blank" 
                      className="w-10 h-10 bg-slate-100 text-slate-600 hover:bg-blue-600 hover:text-white rounded-xl flex items-center justify-center transition-all"
                    >
                      <ChevronRight size={20} />
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Events */}
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Calendar className="text-blue-500" size={20} /> Upcoming (Next 7 Days)
              </h3>
              <button onClick={() => setActiveTab('list')} className="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-widest">
                View All
              </button>
            </div>
            <div className="divide-y divide-slate-50">
              {upcomingEvents.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                  <p className="font-bold">No upcoming events in the next 7 days.</p>
                </div>
              ) : (
                upcomingEvents.map(event => (
                  <div key={event.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">{event.groom_name || event.celebrant_name} & {event.bride_name || 'Family'}</h4>
                      <p className="text-[11px] text-slate-500 font-medium">
                        {event.event_date} • {event.event_type}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Right Column: Recent Wishes */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[800px]">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
            <h3 className="text-lg font-black flex items-center gap-2">
              <Heart className="text-pink-500" size={20} /> Recent Wishes
            </h3>
          </div>
          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            {wishes.slice(0, 10).map((wish, idx) => (
              <div key={idx} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 relative">
                <div className="absolute top-4 right-4 text-[10px] font-bold text-slate-400">
                  {new Date(wish.created_at).toLocaleDateString()}
                </div>
                <h4 className="text-sm font-black text-slate-800 mb-1">{wish.name}</h4>
                <p className="text-xs text-slate-600 italic">"{wish.message}"</p>
                {wish.events && (
                  <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-2">
                    For: {wish.events.groom_name || wish.events.celebrant_name}
                  </p>
                )}
              </div>
            ))}
            {wishes.length === 0 && (
              <div className="text-center text-slate-400 py-10">
                <Heart className="mx-auto text-slate-300 mb-2" size={32} />
                <p className="font-bold text-sm">No wishes received yet.</p>
              </div>
            )}
          </div>
          {wishes.length > 0 && (
            <div className="p-4 border-t border-slate-100 bg-slate-50">
              <button 
                onClick={() => setActiveTab('moderation')}
                className="w-full py-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 uppercase tracking-widest hover:bg-slate-100 transition-colors"
              >
                Moderate All Wishes
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
