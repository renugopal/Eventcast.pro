"use client";

import React, { useState, useRef, useEffect } from "react";
import { RefreshCw, ExternalLink, Edit, Trash2, AlertCircle, Play, Copy, Search, Download, QrCode, MessageCircle, Link as LinkIcon, CopyPlus, StickyNote, X, Eye, ChevronRight, List, MapPin, Clock, ZapOff, Activity } from "lucide-react";
import { authFetch } from "@/lib/client-auth";

interface EventTableProps {
  events: any[];
  wishes: any[];
  isLoadingEvents: boolean;
  fetchEvents: () => void;
  handleEditClick: (event: any) => void;
  handleDuplicateClick: (event: any) => void;
  fullDeleteEvent: (id: string) => void;
  deleteMultipleEvents: (ids: string[]) => void;
}

const adminOptimize = (url: string, width = 150) => {
  if (!url || !url.includes('cloudinary.com')) return url;
  if (url.includes('f_auto,q_auto')) {
    return url.replace('f_auto,q_auto', `f_auto,q_auto,w_${width},c_fill`);
  }
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width},c_fill/`);
};

export const EventTable: React.FC<EventTableProps> = ({
  events,
  wishes,
  isLoadingEvents,
  fetchEvents,
  handleEditClick,
  handleDuplicateClick,
  fullDeleteEvent,
  deleteMultipleEvents
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingYoutube, setTogglingYoutube] = useState<Record<string, boolean>>({});
  const [restartingServer, setRestartingServer] = useState<Record<string, boolean>>({});

  const handleRestartServer = async (slug: string, eventId: string) => {
    setRestartingServer(prev => ({ ...prev, [eventId]: true }));
    try {
      const res = await authFetch('/api/media/restart-channel', {
        method: 'POST',
        body: JSON.stringify({ slug }),
      });
      if (res.ok) alert("Server process restarted successfully!");
      else alert("Failed to restart server.");
    } finally {
      setRestartingServer(prev => {
        const next = { ...prev };
        delete next[eventId];
        return next;
      });
    }
  };

  const toggleYoutubeRelay = async (event: any, enabled: boolean) => {
    setTogglingYoutube(prev => ({ ...prev, [event.id]: true }));
    try {
      const response = await authFetch('/api/media/toggle-youtube', {
        method: 'POST',
        body: JSON.stringify({ slug: event.slug, enabled, eventId: event.id }),
      });
      if (response.ok) {
        alert(`YouTube Relay ${enabled ? 'Started' : 'Stopped'} Successfully!`);
        fetchEvents();
      }
    } finally {
      setTogglingYoutube(prev => {
        const next = { ...prev };
        delete next[event.id];
        return next;
      });
    }
  };

  const [filterType, setFilterType] = useState("All");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [tableDensity, setTableDensity] = useState<"compact" | "standard" | "spacious">("standard");
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [openQrEventId, setOpenQrEventId] = useState<string | null>(null);
  const [previewStream, setPreviewStream] = useState<any | null>(null);
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: number }>({
    select: 40,
    identity: 280,
    schedule: 160,
    venue: 250,
    youtube: 220,
    views: 80,
    control: 180,
    actions: 140
  });

  const resizingColumn = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  const handleMouseDown = (e: React.MouseEvent, column: string) => {
    e.preventDefault();
    resizingColumn.current = column;
    startX.current = e.pageX;
    startWidth.current = columnWidths[column];
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!resizingColumn.current) return;
    const diff = e.pageX - startX.current;
    const newWidth = Math.max(50, startWidth.current + diff);
    setColumnWidths(prev => ({ ...prev, [resizingColumn.current!]: newWidth }));
  };

  const handleMouseUp = () => {
    resizingColumn.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'default';
  };

  const handleDoubleClick = (column: string) => {
    // Reset to a default "auto-fit" like value
    const defaults: { [key: string]: number } = {
      identity: 280, schedule: 160, venue: 200, youtube: 220, views: 80, control: 180, qr: 80, actions: 120
    };
    setColumnWidths(prev => ({ ...prev, [column]: defaults[column] }));
  };

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const exportToCSV = () => {
    const headers = ["Event Type", "Groom Name", "Bride Name", "Celebrant Name", "Date", "Venue", "Views", "Status", "YouTube Link", "Stream Key"];
    const rows = events.map(e => [
      e.event_type || '',
      e.groom_name || '',
      e.bride_name || '',
      e.celebrant_name || '',
      e.event_date || '',
      e.venue_name || '',
      e.view_count || 0,
      e.status || 'Active',
      e.vod_link || '',
      e.youtube_stream_key || ''
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(r => r.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `eventcast_events_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredEvents = events.filter(e => {
    const name = `${e.groom_name || ''} ${e.bride_name || ''} ${e.celebrant_name || ''}`.toLowerCase();
    const matchesSearch = name.includes(searchQuery.toLowerCase()) || (e.venue_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === "All" || e.event_type === filterType;
    return matchesSearch && matchesFilter;
  });

  const sortedEvents = [...filteredEvents].sort((a, b) => {
    if (sortConfig !== null) {
      const { key, direction } = sortConfig;
      let valA = a[key];
      let valB = b[key];

      if (key === 'view_count') { valA = a.view_count || 0; valB = b.view_count || 0; }
      if (key === 'date') { valA = new Date(a.event_date).getTime(); valB = new Date(b.event_date).getTime(); }
      if (key === 'groom_name') { valA = (a.groom_name || a.celebrant_name || '').toLowerCase(); valB = (b.groom_name || b.celebrant_name || '').toLowerCase(); }

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    }

    const timeA = new Date(`${a.event_date}T00:00`).getTime() || 0;
    const timeB = new Date(`${b.event_date}T00:00`).getTime() || 0;
    const today = new Date().setHours(0,0,0,0);
    
    const isAPast = timeA < today;
    const isBPast = timeB < today;
    
    if (!isAPast && !isBPast) return timeA - timeB; 
    if (isAPast && isBPast) return timeB - timeA;   
    return isAPast ? 1 : -1; 
  });

  const formatDisplayDate = (dateString: string) => {
    if (!dateString) return "Date";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = date.getDate();
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();
    const suffix = ["th", "st", "nd", "rd"][(day % 10 > 3 ? 0 : day % 10) - (day % 100 - day % 10 === 10 ? day % 10 : 0)] || "th";
    return `${day}${suffix} ${month} ${year}`;
  };

  const getEventStatus = (dateStr: string) => {
    if (!dateStr) return { label: 'Unknown', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    const eventDate = new Date(`${dateStr}T00:00`);
    const now = new Date();
    
    const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    if (eventDay === today) return { label: 'Today', color: 'bg-green-100 text-green-700 border-green-200' };
    if (eventDay > today) return { label: 'Upcoming', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
    return { label: 'Completed', color: 'bg-slate-100 text-slate-600 border-slate-200' };
  };

  const toggleSelection = (id: string) => {
    setSelectedEventIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedEventIds.size === sortedEvents.length) {
      setSelectedEventIds(new Set());
    } else {
      setSelectedEventIds(new Set(sortedEvents.map(e => e.id)));
    }
  };

  const getPadding = () => {
    if (tableDensity === "compact") return "p-2";
    if (tableDensity === "spacious") return "p-6";
    return "p-4";
  };

  return (
    <div className="w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {selectedEventIds.size > 0 && (
        <div 
          className="flex items-center justify-between p-6 rounded-[2rem] shadow-2xl animate-in slide-in-from-top-6 duration-500 relative overflow-hidden"
          style={{ 
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.2)",
            backdropFilter: "blur(24px)"
          }}
        >
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/10 to-purple-500/10 pointer-events-none" />
          <div className="flex items-center gap-6 relative z-10">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center font-black text-xl shadow-lg shadow-blue-600/20">
              {selectedEventIds.size}
            </div>
            <div>
              <p className="text-white font-black text-lg tracking-tight">Active Selection Batch</p>
              <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mt-1">Multi-Stream Relays Enabled</p>
            </div>
          </div>
          <div className="flex items-center gap-4 relative z-10">
            <button 
              onClick={() => {
                if (confirm(`CRITICAL: Are you sure you want to WIPE ${selectedEventIds.size} events from the core database?`)) {
                  deleteMultipleEvents(Array.from(selectedEventIds));
                  setSelectedEventIds(new Set());
                }
              }}
              className="flex items-center gap-3 px-6 py-3 bg-red-500/20 text-red-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all border border-red-500/20 active:scale-95"
            >
              <Trash2 size={16} /> Force Batch Wipe
            </button>
            <button 
              onClick={() => setSelectedEventIds(new Set())}
              className="px-6 py-3 bg-white/5 text-white/40 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all border border-white/10 active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Control Bar */}
      <div 
        className="flex flex-col lg:flex-row justify-between items-start lg:items-center p-8 rounded-[2.5rem] border backdrop-blur-2xl gap-6 relative overflow-hidden"
        style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/[0.03] blur-[100px] -z-10" />
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight leading-tight flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
              <List size={24} className="text-blue-400" />
            </div>
            <div>
              <span className="block">Events Database</span>
              <span className="block text-[10px] text-white/20 font-black uppercase tracking-[0.4em] mt-1.5">
                DATABASE: {filteredEvents.length} ACTIVE EVENTS
              </span>
            </div>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-4 w-full lg:w-auto">
          <div className="relative flex-1 lg:flex-none">
            <input 
              type="text" 
              placeholder="Search events..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-14 pr-6 py-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl text-sm font-black text-white outline-none focus:ring-2 focus:ring-blue-500/50 w-full lg:w-72 transition-all placeholder:text-white/10"
            />
            <Search size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20" />
          </div>
          <div className="relative group">
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="pl-6 pr-12 py-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl text-[10px] font-black uppercase tracking-widest text-white/60 outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer appearance-none group-hover:border-white/20 transition-all"
            >
              <option className="bg-[#0d0d17]">All Events</option>
              <option className="bg-[#0d0d17]">Wedding</option>
              <option className="bg-[#0d0d17]">Reception</option>
              <option className="bg-[#0d0d17]">Engagement</option>
              <option className="bg-[#0d0d17]">Birthday</option>
              <option className="bg-[#0d0d17]">Half Saree</option>
              <option className="bg-[#0d0d17]">Dhoti Ceremony</option>
            </select>
            <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-white/20 pointer-events-none" size={16} />
          </div>
          
          <div className="flex items-center bg-white/[0.03] p-1.5 rounded-2xl border border-white/[0.08]">
            <button 
              onClick={() => setTableDensity("compact")}
              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all ${tableDensity === "compact" ? "bg-white/10 text-white shadow-lg" : "text-white/20 hover:text-white/40"}`}
            >
              Compact
            </button>
            <button 
              onClick={() => setTableDensity("standard")}
              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all ${tableDensity === "standard" ? "bg-white/10 text-white shadow-lg" : "text-white/20 hover:text-white/40"}`}
            >
              Standard
            </button>
          </div>
          
          <button onClick={exportToCSV} className="flex items-center gap-3 px-6 py-4 bg-green-500/10 text-green-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-green-500/20 transition-all border border-green-500/20 active:scale-95">
            <Download size={18} /> Export
          </button>
          <button 
            onClick={fetchEvents}
            disabled={isLoadingEvents}
            className="p-4 bg-white/[0.03] text-white/40 rounded-2xl hover:bg-white/10 hover:text-white transition-all border border-white/[0.08] active:scale-95"
          >
            <RefreshCw size={22} className={isLoadingEvents ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div 
        className="rounded-[3rem] border backdrop-blur-2xl overflow-hidden shadow-2xl relative"
        style={{ background: "rgba(255,255,255,0.01)", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[1300px] text-left border-collapse table-fixed">
            <thead>
              <tr className="bg-white/[0.04] border-b border-white/[0.08]">
                <th style={{ width: columnWidths.select }} className="p-6">
                  <div className="flex items-center justify-center">
                    <input 
                      type="checkbox" 
                      checked={selectedEventIds.size === sortedEvents.length && sortedEvents.length > 0}
                      onChange={toggleSelectAll}
                      className="w-5 h-5 rounded-lg border-white/10 bg-white/5 text-blue-500 focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer"
                    />
                  </div>
                </th>
                <th 
                  style={{ width: columnWidths.identity }}
                  className="p-6 text-[10px] font-black text-white/30 uppercase tracking-[0.3em] relative group"
                >
                  <div onClick={() => requestSort('groom_name')} className="cursor-pointer hover:text-white transition-colors flex items-center gap-2">
                    Event Details {sortConfig?.key === 'groom_name' ? (sortConfig.direction === 'asc' ? <ChevronRight size={14} className="-rotate-90" /> : <ChevronRight size={14} className="rotate-90" />) : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'identity')} onDoubleClick={() => handleDoubleClick('identity')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th 
                  style={{ width: columnWidths.schedule }}
                  className="p-6 text-[10px] font-black text-white/30 uppercase tracking-[0.3em] relative group"
                >
                  <div onClick={() => requestSort('date')} className="cursor-pointer hover:text-white transition-colors flex items-center gap-2">
                    Date & Time {sortConfig?.key === 'date' ? (sortConfig.direction === 'asc' ? <ChevronRight size={14} className="-rotate-90" /> : <ChevronRight size={14} className="rotate-90" />) : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'schedule')} onDoubleClick={() => handleDoubleClick('schedule')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.venue }} className="p-6 text-[10px] font-black text-white/30 uppercase tracking-[0.3em] relative group">
                  Venue & Photographer
                  <div onMouseDown={(e) => handleMouseDown(e, 'venue')} onDoubleClick={() => handleDoubleClick('venue')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.youtube }} className="p-6 text-[10px] font-black text-white/30 uppercase tracking-[0.3em] relative group">
                  Stream & Relay
                  <div onMouseDown={(e) => handleMouseDown(e, 'youtube')} onDoubleClick={() => handleDoubleClick('youtube')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th 
                  style={{ width: columnWidths.views }}
                  className="p-6 text-[10px] font-black text-white/30 uppercase tracking-[0.3em] text-center relative group"
                >
                  <div onClick={() => requestSort('view_count')} className="cursor-pointer hover:text-white transition-colors">
                    Views {sortConfig?.key === 'view_count' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'views')} onDoubleClick={() => handleDoubleClick('views')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.control }} className="p-6 text-[10px] font-black text-white/30 uppercase tracking-[0.3em] relative group">
                  YouTube Control
                  <div onMouseDown={(e) => handleMouseDown(e, 'control')} onDoubleClick={() => handleDoubleClick('identity')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.actions }} className="p-6 text-[10px] font-black text-white/30 uppercase tracking-[0.3em] text-right relative group">
                  Quick Actions
                  <div onMouseDown={(e) => handleMouseDown(e, 'actions')} onDoubleClick={() => handleDoubleClick('actions')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {isLoadingEvents ? (
                <tr>
                  <td colSpan={8} className="p-32 text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-blue-600/[0.02] animate-pulse" />
                    <RefreshCw className="animate-spin mx-auto text-blue-500 mb-8" size={64} strokeWidth={1.5} />
                    <p className="text-white font-black text-lg tracking-tight">Loading Events...</p>
                    <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.5em] mt-3">Fetching database records...</p>
                  </td>
                </tr>
              ) : (
                sortedEvents.map((event, idx) => {
                  const eventWishes = wishes.filter(w => w.event_id === event.id);
                  const status = getEventStatus(event.event_date);
                  return (
                    <tr key={event.id} className={`hover:bg-white/[0.03] transition-all group animate-in fade-in slide-in-from-left-2 duration-500 ${selectedEventIds.has(event.id) ? 'bg-blue-500/[0.08]' : ''}`} style={{ animationDelay: `${idx * 40}ms` }}>
                      <td className="p-6">
                        <div className="flex items-center justify-center">
                          <input 
                            type="checkbox" 
                            checked={selectedEventIds.has(event.id)}
                            onChange={() => toggleSelection(event.id)}
                            className="w-5 h-5 rounded-lg border-white/10 bg-white/5 text-blue-600 focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer"
                          />
                        </div>
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="flex items-center gap-6">
                          <div className="w-16 h-16 bg-white/[0.03] rounded-2xl overflow-hidden border border-white/10 flex-shrink-0 shadow-2xl relative group-hover:scale-105 transition-transform duration-700">
                            {event.thumbnail_url ? (
                              <img src={adminOptimize(event.thumbnail_url, 150)} className="w-full h-full object-cover" alt="Thumb" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white/5"><AlertCircle size={32} strokeWidth={1} /></div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-3 mb-2.5">
                              <span className="px-2.5 py-1 bg-blue-500/10 text-blue-400 text-[9px] font-black uppercase tracking-widest rounded-lg border border-blue-400/20">
                                {event.event_type}
                              </span>
                              {eventWishes.length > 0 && (
                                <span className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-400 text-[9px] font-black uppercase tracking-widest rounded-lg border border-green-400/20">
                                  <MessageCircle size={10} /> {eventWishes.length}
                                </span>
                              )}
                              {event.notes && (
                                <div className="w-2 h-2 rounded-full bg-white animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.5)]" title={event.notes} />
                              )}
                            </div>
                            <h3 className="text-base font-black text-white leading-tight truncate tracking-tight group-hover:text-blue-400 transition-colors">
                              {event.groom_name || event.celebrant_name}
                              {event.bride_name && event.bride_name.toLowerCase() !== 'family' && (
                                <span className="text-white/40 font-medium"> & {event.bride_name}</span>
                              )}
                            </h3>
                            {(!event.bride_name || event.bride_name.toLowerCase() === 'family') && (
                                <p className="text-[10px] text-white/10 font-black uppercase tracking-[0.2em] mt-1.5">
                                  Family Event
                                </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="text-sm font-black text-white mb-2 tracking-tight">{formatDisplayDate(event.event_date)}</div>
                        <div className="flex items-center gap-3">
                          <div className="text-[10px] text-white/30 font-black uppercase tracking-widest flex items-center gap-1.5">
                            <Clock size={10} /> {event.event_time}
                          </div>
                          <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                            status.label === 'Today' 
                              ? 'bg-green-500/10 text-green-400 border-green-400/30 shadow-[0_0_15px_rgba(34,197,94,0.2)]' 
                              : status.label === 'Upcoming'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-400/20'
                              : 'bg-white/5 text-white/20 border-white/10'
                          }`}>
                            {status.label}
                          </span>
                        </div>
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="text-[11px] text-white/60 font-black max-w-[200px] truncate mb-3 flex items-center gap-2">
                           <MapPin size={12} className="text-white/20" /> {event.venue_name}
                        </div>
                        {event.photographers?.name ? (
                          <div className="flex items-center gap-3 p-2 pr-4 bg-white/[0.03] rounded-2xl border border-white/[0.05] w-fit hover:border-blue-500/20 transition-all group/pg">
                            <div className="w-10 h-10 rounded-xl overflow-hidden bg-white shadow-2xl p-2 border border-white/10 group-hover/pg:scale-105 transition-transform">
                               {event.photographers.logo_url ? (
                                <img src={adminOptimize(event.photographers.logo_url, 100)} className="w-full h-full object-contain" alt="" />
                              ) : (
                                <div className="w-full h-full bg-blue-600 text-white flex items-center justify-center font-black text-xs">
                                  {(event.photographers.name || '?')[0].toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-[10px] text-white font-black leading-tight tracking-tight">{event.photographers.name}</div>
                              {event.photographers.city && <div className="text-[8px] text-white/20 font-black uppercase tracking-widest mt-0.5">{event.photographers.city}</div>}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-white/5 font-black uppercase tracking-[0.3em] pl-1">Uncredited Partner</div>
                        )}
                      </td>
                    <td className={`${getPadding()}`}>
                      <div className="flex flex-col gap-4 items-start min-w-[220px]">
                        <div className="w-full space-y-2">
                          <div className="flex items-center justify-between px-1">
                            <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] opacity-40">Ingest Point</span>
                            <div className="flex items-center gap-2">
                              {event.restreamer_url && (
                                <button 
                                  onClick={() => setPreviewStream(event)}
                                  className="text-[9px] font-black text-blue-400 hover:text-white hover:bg-blue-600 rounded-lg px-2 py-1 border border-blue-500/20 transition-all uppercase tracking-widest active:scale-95"
                                >
                                  Preview
                                </button>
                              )}
                              <button 
                                onClick={() => handleRestartServer(event.slug, event.id)}
                                disabled={restartingServer[event.id]}
                                className={`text-[9px] font-black px-2 py-1 rounded-lg transition-all border uppercase tracking-widest active:scale-95 ${
                                  restartingServer[event.id] 
                                    ? 'bg-white/5 text-white/10 border-white/5' 
                                    : 'bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500 hover:text-white'
                                }`}
                              >
                                {restartingServer[event.id] ? 'Busy' : 'Restart'}
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5 bg-white/[0.03] p-3 rounded-2xl border border-white/[0.08] shadow-inner group/node">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[10px] font-mono text-white/30 truncate max-w-[140px] tracking-tight">{event.restreamer_ingest_url || `rtmp://34.100.142.25/${event.slug}`}</span>
                              <button onClick={() => { navigator.clipboard.writeText(event.restreamer_ingest_url || `rtmp://34.100.142.25/${event.slug}`); alert("Ingest URL Copied"); }} className="text-white/10 hover:text-blue-400 transition-colors"><CopyPlus size={14}/></button>
                            </div>
                            <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] pt-2 mt-1">
                              <span className="text-[11px] font-mono font-black text-blue-400 uppercase tracking-tighter">● {event.restreamer_stream_key || 'live'}</span>
                              <button onClick={() => { navigator.clipboard.writeText(event.restreamer_stream_key || 'live'); alert("Stream Key Copied"); }} className="text-white/10 hover:text-blue-400 transition-colors"><Copy size={14}/></button>
                            </div>
                          </div>
                        </div>
                        
                        <div className="w-full space-y-2">
                          <div className="flex items-center justify-between px-1">
                            <span className="text-[9px] font-black text-red-500 uppercase tracking-[0.2em] opacity-40">Global Relay</span>
                            {event.youtube_stream_key && (
                              <div className="flex items-center gap-3">
                                <span className={`text-[8px] font-black tracking-widest ${togglingYoutube[event.id] ? 'text-blue-400 animate-pulse' : 'text-white/20'}`}>
                                  {togglingYoutube[event.id] ? 'SIGNAL SYNC...' : 'STATUS'}
                                </span>
                                <div className="flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
                                  <button
                                    onClick={() => toggleYoutubeRelay(event, true)}
                                    className={`px-2 py-0.5 rounded-md text-[8px] font-black transition-all ${togglingYoutube[event.id] ? 'opacity-30' : 'hover:bg-red-600 hover:text-white text-white/40'}`}
                                    title="Start Relay"
                                  >START</button>
                                  <button
                                    onClick={() => toggleYoutubeRelay(event, false)}
                                    className={`px-2 py-0.5 rounded-md text-[8px] font-black transition-all ${togglingYoutube[event.id] ? 'opacity-30' : 'hover:bg-white hover:text-black text-white/40'}`}
                                    title="Kill Relay"
                                  >STOP</button>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 bg-white/[0.03] p-3 rounded-2xl border border-white/[0.08] shadow-inner">
                            {event.youtube_stream_key && (
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] font-mono text-red-500/60 truncate max-w-[140px]">{event.youtube_stream_key}</span>
                                <button onClick={() => { navigator.clipboard.writeText(event.youtube_stream_key); alert("YouTube Key Copied"); }} className="text-white/10 hover:text-red-500 transition-colors"><Copy size={14}/></button>
                              </div>
                            )}
                            {event.vod_link && (
                              <a href={event.vod_link} target="_blank" className="flex items-center justify-center gap-2 text-[9px] text-white font-black uppercase tracking-[0.2em] bg-red-600/10 py-2.5 rounded-xl border border-red-600/20 hover:bg-red-600 hover:text-white transition-all mt-1 shadow-lg shadow-red-600/5 active:scale-95">
                                <Play size={12} fill="currentColor" /> MONITOR RELAY
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={`${getPadding()} text-center`}>
                       <div className="inline-flex flex-col items-center gap-1">
                         <span className="font-mono text-lg text-white font-black leading-none">{event.view_count || 0}</span>
                         <span className="text-[8px] text-white/20 font-black uppercase tracking-widest">Visitors</span>
                       </div>
                    </td>
                    <td className={`${getPadding()}`}>
                       {event.youtube_broadcast_id ? (
                         <div className="flex flex-col gap-3">
                           <button 
                             onClick={async () => {
                               const heart = (event.event_type || '').toLowerCase().includes('wedding') ? '❤️' : '✨';
                               const baseTitle = `${event.groom_name || event.celebrant_name} ${heart} ${event.bride_name || 'Family'} ${event.event_type} Live | ${formatDisplayDate(event.event_date)}`;
                               const res = await authFetch('/api/youtube/toggle-live', {
                                 method: 'POST',
                                 body: JSON.stringify({ eventId: event.id, broadcastId: event.youtube_broadcast_id, title: baseTitle, isLive: true }),
                               });
                               if (res.ok) alert("CRITICAL: BROADCAST IS NOW LIVE");
                             }}
                             className="px-4 py-2 bg-red-600 text-white rounded-xl text-[9px] font-black hover:bg-red-500 border border-red-500/20 uppercase tracking-[0.2em] transition-all shadow-lg shadow-red-600/20 active:scale-95"
                           >
                             GO LIVE
                           </button>
                           <button 
                             onClick={async () => {
                               const heart = (event.event_type || '').toLowerCase().includes('wedding') ? '❤️' : '✨';
                               const baseTitle = `${event.groom_name || event.celebrant_name} ${heart} ${event.bride_name || 'Family'} ${event.event_type} Live | ${formatDisplayDate(event.event_date)}`;
                               const res = await authFetch('/api/youtube/toggle-live', {
                                 method: 'POST',
                                 body: JSON.stringify({ eventId: event.id, broadcastId: event.youtube_broadcast_id, title: baseTitle, isLive: false }),
                               });
                               if (res.ok) alert("MISSION COMPLETE: BROADCAST TERMINATED");
                             }}
                             className="px-4 py-2 bg-white/5 text-white/30 rounded-xl text-[9px] font-black hover:bg-white/10 hover:text-white border border-white/10 uppercase tracking-[0.2em] transition-all active:scale-95"
                           >
                             TERMINATE
                           </button>
                         </div>
                       ) : (
                        <div className="flex flex-col items-center gap-1 opacity-10">
                            <ZapOff size={20} className="text-white" />
                            <span className="text-[8px] font-black uppercase tracking-widest">No Relay</span>
                         </div>
                       )}
                    </td>
                    <td className={`${getPadding()}`}>
                       <div className="flex items-center justify-end gap-2 flex-wrap max-w-[280px]">
                         <div className="relative">
                           <button 
                             onClick={() => setOpenQrEventId(openQrEventId === event.id ? null : event.id)}
                             className={`p-3 rounded-2xl transition-all border shadow-lg ${openQrEventId === event.id ? 'bg-blue-600 text-white border-blue-400 shadow-blue-500/30 active:scale-95' : 'bg-white/[0.03] text-white/30 border-white/5 hover:border-white/20 hover:text-white hover:bg-white/5'}`}
                             title="Show QR Code"
                           >
                             <QrCode size={20} />
                           </button>
                           {openQrEventId === event.id && (
                             <div className="absolute right-0 bottom-full mb-4 z-50 bg-[#0d0d17]/95 p-6 rounded-[2rem] shadow-2xl border border-white/10 w-56 animate-in zoom-in-95 slide-in-from-bottom-2 duration-300 backdrop-blur-3xl">
                               <div className="flex items-center justify-between mb-4">
                                 <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Event QR Code</span>
                                 <button onClick={() => setOpenQrEventId(null)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-red-500 rounded-lg text-white/20 hover:text-white transition-all"><X size={12} /></button>
                               </div>
                               <div className="bg-white p-3 rounded-2xl mb-4 shadow-inner">
                                 <img 
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://eventcast.pro/events/${event.slug}`}
                                    className="w-full h-auto rounded-lg"
                                    alt="QR"
                                 />
                               </div>
                               <div className="flex gap-2">
                                 <a 
                                    href={`https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=https://eventcast.pro/events/${event.slug}`} 
                                    download={`qr-${event.slug}.png`}
                                    className="flex-1 text-center py-2.5 bg-white/5 text-white/60 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-white/10 border border-white/10 transition-all"
                                 >PNG</a>
                                 <a 
                                    href={`https://eventcast.pro/events/${event.slug}`} 
                                    target="_blank" 
                                    className="flex-1 text-center py-2.5 bg-blue-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
                                 >Open</a>
                                </div>
                             </div>
                           )}
                         </div>

                        <button 
                          onClick={() => { 
                            navigator.clipboard.writeText(`https://eventcast.pro/events/${event.slug}`); 
                            alert("Live Page Link Copied!"); 
                          }}
                          className="p-3 bg-white/[0.03] text-blue-400 rounded-2xl transition-all border border-white/5 hover:border-blue-500/40 hover:bg-blue-500/10 hover:shadow-lg hover:shadow-blue-500/5 active:scale-95" 
                          title="Copy Live Page Link"
                        >
                          <Copy size={20} />
                        </button>

                        <button 
                          onClick={() => { 
                            const portalUrl = `${window.location.origin}/portal/${event.slug}`;
                            navigator.clipboard.writeText(portalUrl); 
                            alert("Client Portal Link Copied!"); 
                          }}
                          className="p-3 bg-white/[0.03] text-pink-500 rounded-2xl transition-all border border-white/5 hover:border-pink-500/40 hover:bg-pink-500/10 hover:shadow-lg hover:shadow-pink-500/5 active:scale-95" 
                          title="Copy Client Portal Link"
                        >
                          <LinkIcon size={20} />
                        </button>

                        <button 
                          onClick={() => handleDuplicateClick(event)}
                          className="p-3 bg-white/[0.03] text-emerald-500 rounded-2xl transition-all border border-white/5 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:shadow-lg hover:shadow-emerald-500/5 active:scale-95" 
                          title="Duplicate Event"
                        >
                          <CopyPlus size={20} />
                        </button>

                        <button 
                          onClick={() => {
                            const message = `Hello! We are excited to invite you to the ${event.event_type || 'event'}. Join us live here: https://eventcast.pro/events/${event.slug}`;
                            window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
                          }}
                          className="p-3 bg-white/[0.03] text-green-500 rounded-2xl transition-all border border-white/5 hover:border-green-500/40 hover:bg-green-500/10 hover:shadow-lg hover:shadow-green-500/5 active:scale-95" 
                          title="Share to WhatsApp"
                        >
                          <MessageCircle size={20} />
                        </button>

                        <button 
                          onClick={() => handleEditClick(event)}
                          className="p-3 bg-white/[0.03] text-amber-500 rounded-2xl transition-all border border-white/5 hover:border-amber-500/40 hover:bg-amber-500/10 hover:shadow-lg hover:shadow-amber-500/5 active:scale-95" 
                          title="Edit Event"
                        >
                          <Edit size={20} />
                        </button>

                        <button 
                          onClick={() => {
                            if (window.confirm("WARNING: Are you sure you want to permanently delete this event? This will also remove the YouTube broadcast and associated data.")) {
                              fullDeleteEvent(event.id);
                            }
                          }}
                          className="p-3 bg-white/[0.03] text-red-500 rounded-2xl transition-all border border-white/5 hover:border-red-500/40 hover:bg-red-500/10 hover:shadow-lg hover:shadow-red-500/5 active:scale-95" 
                          title="Delete Event"
                        >
                          <Trash2 size={20} />
                        </button>
                       </div>
                     </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
      {/* Stream Preview Modal */}
      {previewStream && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div 
            className="w-full max-w-3xl rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 border border-white/10"
            style={{ background: "#0d0d17" }}
          >
            <div className="flex items-center justify-between p-8 border-b border-white/[0.06]">
              <div>
                <h3 className="text-xl font-black text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Live Stream Monitor
                </h3>
                <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mt-1">
                  {previewStream.groom_name || previewStream.celebrant_name} & {previewStream.bride_name || 'Family'}
                </p>
              </div>
              <button 
                onClick={() => setPreviewStream(null)}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors text-white/40 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="aspect-video bg-black relative">
              <video 
                id="admin-preview-video"
                controls 
                autoPlay 
                className="w-full h-full"
                playsInline
              />
              <div id="admin-preview-loader" className="absolute inset-0 flex flex-col items-center justify-center bg-[#07070d]/90 text-white z-10 backdrop-blur-sm">
                <RefreshCw size={40} className="animate-spin text-blue-500 mb-6" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] animate-pulse text-white/40">Handshaking Media Server...</p>
              </div>
              
              {/* HLS Loading Script */}
              <script dangerouslySetInnerHTML={{ __html: `
                (function() {
                  const video = document.getElementById('admin-preview-video');
                  const loader = document.getElementById('admin-preview-loader');
                  const url = "${previewStream.restreamer_url}";
                  
                  if (!window.Hls) {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
                    script.onload = initHls;
                    document.head.appendChild(script);
                  } else {
                    initHls();
                  }
                  
                  function initHls() {
                    if (Hls.isSupported()) {
                      const hls = new Hls({
                        manifestLoadingMaxRetry: 10,
                        manifestLoadingRetryDelay: 1000,
                      });
                      hls.loadSource(url);
                      hls.attachMedia(video);
                      hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        loader.style.display = 'none';
                        video.play();
                      });
                      hls.on(Hls.Events.ERROR, (event, data) => {
                        if (data.fatal) {
                          console.log("HLS Error:", data);
                        }
                      });
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                      video.src = url;
                      video.addEventListener('loadedmetadata', () => {
                        loader.style.display = 'none';
                        video.play();
                      });
                    }
                  }
                })();
              `}} />
            </div>
            
            <div className="p-8 bg-white/[0.02] flex flex-col md:flex-row gap-6 items-center justify-between border-t border-white/[0.06]">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 text-green-400 text-[9px] font-black rounded-full border border-green-500/20 uppercase tracking-widest">
                  <Activity size={10} /> Active Pipeline
                </div>
                <div className="text-[10px] font-mono text-white/40 bg-white/5 px-3 py-1 rounded-lg border border-white/5">
                  SID: {previewStream.slug}
                </div>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(previewStream.restreamer_ingest_url || `rtmp://34.100.142.25/${previewStream.slug}`);
                    alert("RTMP Ingest URL Copied!");
                  }}
                  className="px-5 py-2.5 bg-white/5 text-white/60 text-[10px] font-black rounded-xl border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2"
                >
                  <Copy size={14} /> INGEST URL
                </button>
                <a 
                  href={`https://eventcast.pro/events/${previewStream.slug}`}
                  target="_blank"
                  className="px-8 py-2.5 bg-blue-600 text-white text-[10px] font-black rounded-xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 flex items-center gap-2"
                >
                  <ExternalLink size={14} /> VIEW LIVE PAGE
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
