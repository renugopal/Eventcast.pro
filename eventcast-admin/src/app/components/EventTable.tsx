"use client";

import React, { useState, useRef, useEffect } from "react";
import { RefreshCw, ExternalLink, Edit, Trash2, AlertCircle, Play, Copy, Search, Download, QrCode, MessageCircle, Link as LinkIcon, CopyPlus, StickyNote, X } from "lucide-react";

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
  const [filterType, setFilterType] = useState("All");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [tableDensity, setTableDensity] = useState<"compact" | "standard" | "spacious">("standard");
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [openQrEventId, setOpenQrEventId] = useState<string | null>(null);
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
    <div className="w-full space-y-6">
      {selectedEventIds.size > 0 && (
        <div className="flex items-center justify-between bg-blue-600 p-4 rounded-2xl shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-4 text-white">
            <span className="text-sm font-black uppercase tracking-widest bg-blue-500/50 px-3 py-1 rounded-lg border border-blue-400/30">
              {selectedEventIds.size} Selected
            </span>
            <p className="text-sm font-bold opacity-90">Manage multiple events at once</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                if (confirm(`Are you sure you want to delete ${selectedEventIds.size} events?`)) {
                  deleteMultipleEvents(Array.from(selectedEventIds));
                  setSelectedEventIds(new Set());
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-white text-red-600 rounded-xl text-xs font-black hover:bg-red-50 transition-all shadow-sm"
            >
              <Trash2 size={14} /> Bulk Delete
            </button>
            <button 
              onClick={() => setSelectedEventIds(new Set())}
              className="px-4 py-2 bg-blue-500/50 text-white rounded-xl text-xs font-black hover:bg-blue-500 transition-all border border-blue-400/30"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl border border-slate-200 shadow-sm gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-tight">Active Events</h2>
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Total: {filteredEvents.length} Platforms</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search by name or venue..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 w-full md:w-80 shadow-inner"
            />
            <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
          </div>
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>All</option>
            <option>Wedding</option>
            <option>Reception</option>
            <option>Engagement</option>
            <option>Birthday</option>
            <option>Half Saree</option>
          </select>
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button 
              onClick={() => setTableDensity("compact")}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tableDensity === "compact" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
            >
              Compact
            </button>
            <button 
              onClick={() => setTableDensity("standard")}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tableDensity === "standard" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
            >
              Std
            </button>
            <button 
              onClick={() => setTableDensity("spacious")}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tableDensity === "spacious" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
            >
              Tall
            </button>
          </div>
          <button onClick={exportToCSV} className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-black hover:bg-green-700 transition-all shadow-lg shadow-green-100" title="Export to Excel">
            <Download size={16} /> Export
          </button>
          <button 
            onClick={fetchEvents}
            disabled={isLoadingEvents}
            className="p-2.5 bg-white text-slate-600 rounded-xl hover:bg-slate-50 transition-all border border-slate-200 shadow-sm"
          >
            <RefreshCw size={20} className={isLoadingEvents ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left border-collapse table-fixed">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-800">
                <th style={{ width: columnWidths.select }} className="p-4">
                  <input 
                    type="checkbox" 
                    checked={selectedEventIds.size === sortedEvents.length && sortedEvents.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-blue-500"
                  />
                </th>
                <th 
                  style={{ width: columnWidths.identity }}
                  className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group"
                >
                  <div onClick={() => requestSort('groom_name')} className="cursor-pointer hover:text-white transition-colors">
                    Event Identity {sortConfig?.key === 'groom_name' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'identity')} onDoubleClick={() => handleDoubleClick('identity')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th 
                  style={{ width: columnWidths.schedule }}
                  className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group"
                >
                  <div onClick={() => requestSort('date')} className="cursor-pointer hover:text-white transition-colors">
                    Schedule {sortConfig?.key === 'date' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'schedule')} onDoubleClick={() => handleDoubleClick('schedule')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.venue }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group">
                  Venue & Photographer
                  <div onMouseDown={(e) => handleMouseDown(e, 'venue')} onDoubleClick={() => handleDoubleClick('venue')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.youtube }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group">
                  YouTube / Stream
                  <div onMouseDown={(e) => handleMouseDown(e, 'youtube')} onDoubleClick={() => handleDoubleClick('youtube')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th 
                  style={{ width: columnWidths.views }}
                  className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center relative group"
                >
                  <div onClick={() => requestSort('view_count')} className="cursor-pointer hover:text-white transition-colors">
                    Views {sortConfig?.key === 'view_count' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'views')} onDoubleClick={() => handleDoubleClick('views')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.control }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group">
                  Live Control
                  <div onMouseDown={(e) => handleMouseDown(e, 'control')} onDoubleClick={() => handleDoubleClick('control')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.actions }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right relative group">
                  Actions
                  <div onMouseDown={(e) => handleMouseDown(e, 'actions')} onDoubleClick={() => handleDoubleClick('actions')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoadingEvents ? (
                <tr>
                  <td colSpan={8} className="p-20 text-center">
                    <RefreshCw className="animate-spin mx-auto text-blue-500 mb-4" size={40} />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs animate-pulse">Loading Platforms...</p>
                  </td>
                </tr>
              ) : (
                sortedEvents.map(event => {
                  const eventWishes = wishes.filter(w => w.event_id === event.id);
                  return (
                    <tr key={event.id} className={`hover:bg-blue-50/30 transition-colors group even:bg-slate-50/50 ${selectedEventIds.has(event.id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="p-4">
                        <input 
                          type="checkbox" 
                          checked={selectedEventIds.has(event.id)}
                          onChange={() => toggleSelection(event.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600"
                        />
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 flex-shrink-0">
                            {event.thumbnail_url ? (
                              <img src={event.thumbnail_url} className="w-full h-full object-cover" alt="Thumb" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-300"><AlertCircle size={20} /></div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[8px] font-black uppercase rounded border border-blue-100">
                                {event.event_type}
                              </span>
                              {eventWishes.length > 0 && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-50 text-green-600 text-[8px] font-black uppercase rounded border border-green-100">
                                  <MessageCircle size={8} /> {eventWishes.length}
                                </span>
                              )}
                              {event.notes && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-900 text-white text-[8px] font-black uppercase rounded border border-slate-800" title={event.notes}>
                                  <StickyNote size={8} /> Note
                                </span>
                              )}
                            </div>
                            <h3 className="text-[13px] font-black text-slate-800 leading-tight">
                              {event.groom_name || event.celebrant_name}
                              {event.bride_name && event.bride_name.toLowerCase() !== 'family' && (
                                <span className="text-slate-800"> & {event.bride_name}</span>
                              )}
                            </h3>
                            {(!event.bride_name || event.bride_name.toLowerCase() === 'family') && (
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                & Family
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="text-sm font-bold text-slate-700 mb-1">{formatDisplayDate(event.event_date)}</div>
                        <div className="flex items-center gap-2">
                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{event.event_time}</div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border ${getEventStatus(event.event_date).color}`}>
                            {getEventStatus(event.event_date).label}
                          </span>
                        </div>
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="text-xs text-slate-800 font-bold max-w-[200px] truncate mb-1">{event.venue_name}</div>
                        {event.photographers?.name ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            {event.photographers.logo_url ? (
                              <img src={event.photographers.logo_url} className="w-5 h-5 object-contain rounded" alt="" />
                            ) : (
                              <div className="w-5 h-5 bg-blue-100 text-blue-600 rounded text-[8px] font-black flex items-center justify-center">
                                {(event.photographers.name || '?')[0].toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="text-[9px] text-slate-600 font-black leading-tight">{event.photographers.name}</div>
                              {event.photographers.city && <div className="text-[8px] text-slate-400 font-bold">{event.photographers.city}</div>}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[9px] text-slate-300 font-bold uppercase">No Photographer Credit</div>
                        )}
                      </td>
                    <td className={`${getPadding()}`}>
                      {event.youtube_stream_key ? (
                        <div className="flex flex-col gap-1.5 items-start">
                          <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                            <code className="text-[10px] font-mono text-slate-700">{event.youtube_stream_key}</code>
                            <button onClick={() => { navigator.clipboard.writeText(event.youtube_stream_key); alert("Copied!"); }} className="text-slate-400 hover:text-blue-500"><Copy size={12}/></button>
                          </div>
                          {event.vod_link && (
                            <a href={event.vod_link} target="_blank" className="flex items-center gap-1 text-[10px] text-red-600 font-bold uppercase bg-red-50 px-2 py-0.5 rounded-full hover:bg-red-100 transition-colors border border-red-100">
                              <Play size={10} /> Live Link
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-2 py-1 rounded border border-slate-100">No Stream</span>
                      )}
                    </td>
                    <td className={`${getPadding()} text-center`}>
                       <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold">{event.view_count || 0}</span>
                    </td>
                    <td className={`${getPadding()}`}>
                       {event.youtube_broadcast_id ? (
                         <div className="flex gap-2">
                           <button 
                             onClick={async () => {
                               const heart = (event.event_type || '').toLowerCase().includes('wedding') ? '❤️' : '✨';
                               const baseTitle = `${event.groom_name || event.celebrant_name} ${heart} ${event.bride_name || 'Family'} ${event.event_type} Live | ${formatDisplayDate(event.event_date)}`;
                               const res = await fetch('/api/youtube/toggle-live', {
                                 method: 'POST',
                                 headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify({ 
                                   eventId: event.id,
                                   broadcastId: event.youtube_broadcast_id, 
                                   title: baseTitle, 
                                   isLive: true 
                                 })
                               });
                               if (res.ok) alert("🔴 Event is now LIVE!");
                             }}
                             className="px-2 py-1 bg-red-50 text-red-600 rounded text-[9px] font-black hover:bg-red-100 border border-red-100 uppercase"
                           >
                             Go Live
                           </button>
                           <button 
                             onClick={async () => {
                               const heart = (event.event_type || '').toLowerCase().includes('wedding') ? '❤️' : '✨';
                               const baseTitle = `${event.groom_name || event.celebrant_name} ${heart} ${event.bride_name || 'Family'} ${event.event_type} Live | ${formatDisplayDate(event.event_date)}`;
                               const res = await fetch('/api/youtube/toggle-live', {
                                 method: 'POST',
                                 headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify({ 
                                   eventId: event.id,
                                   broadcastId: event.youtube_broadcast_id, 
                                   title: baseTitle, 
                                   isLive: false 
                                 })
                               });
                               if (res.ok) alert("✅ Live Ended");
                             }}
                             className="px-2 py-1 bg-slate-50 text-slate-600 rounded text-[9px] font-black hover:bg-slate-100 border border-slate-100 uppercase"
                           >
                             End
                           </button>
                         </div>
                       ) : (
                         <span className="text-[9px] text-slate-300 font-bold uppercase tracking-tighter">No YouTube</span>
                       )}
                    </td>
                    <td className={`${getPadding()}`}>
                       <div className="flex items-center justify-end gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                         {/* QR Code Quick View — click-based popup */}
                         <div className="relative">
                           <button 
                             onClick={() => setOpenQrEventId(openQrEventId === event.id ? null : event.id)}
                             className={`p-2 rounded-lg transition-colors border ${openQrEventId === event.id ? 'bg-blue-100 text-blue-600 border-blue-200' : 'hover:bg-slate-100 text-slate-600 border-transparent hover:border-slate-200'}`}
                           >
                             <QrCode size={18} />
                           </button>
                           {openQrEventId === event.id && (
                             <div className="absolute right-0 bottom-full mb-2 z-50 bg-white p-3 rounded-2xl shadow-2xl border border-slate-200 w-44">
                               <div className="flex items-center justify-between mb-2">
                                 <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">QR Code</span>
                                 <button onClick={() => setOpenQrEventId(null)} className="text-slate-400 hover:text-red-500"><X size={12} /></button>
                               </div>
                               <img 
                                  src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://eventcast.pro/events/${event.slug}`}
                                  className="w-full h-auto rounded-lg border border-slate-100 mb-2"
                                  alt="QR"
                               />
                               <div className="flex gap-2">
                                 <a 
                                   href={`https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=https://eventcast.pro/events/${event.slug}`} 
                                   download={`qr-${event.slug}.png`}
                                   className="flex-1 text-center py-1.5 bg-slate-900 text-white text-[8px] font-black uppercase rounded-lg hover:bg-slate-700 transition-colors"
                                 >⬇ PNG</a>
                                 <a 
                                   href={`https://eventcast.pro/events/${event.slug}`} 
                                   target="_blank" 
                                   className="flex-1 text-center py-1.5 bg-blue-600 text-white text-[8px] font-black uppercase rounded-lg hover:bg-blue-700 transition-colors"
                                 >Visit</a>
                               </div>
                             </div>
                           )}
                         </div>

                        <a 
                          href={`https://eventcast.pro/events/${event.slug}`} 
                          target="_blank" 
                          className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors border border-transparent hover:border-blue-200" 
                          title="View Live Page"
                        >
                          <ExternalLink size={18} />
                        </a>
                        <button 
                          onClick={() => { navigator.clipboard.writeText(`https://admin.eventcast.pro/portal/${event.slug}`); alert("Client Portal Link Copied!"); }}
                          className="p-2 hover:bg-pink-50 text-pink-600 rounded-lg transition-colors border border-transparent hover:border-pink-200" 
                          title="Copy Client Portal Link"
                        >
                          <LinkIcon size={18} />
                        </button>
                        <button 
                          onClick={() => { navigator.clipboard.writeText(`https://eventcast.pro/events/${event.slug}`); alert("Live Page Link Copied!"); }}
                          className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors border border-transparent hover:border-slate-200" 
                          title="Copy Page URL"
                        >
                          <Copy size={18} />
                        </button>
                        <button 
                          onClick={() => handleDuplicateClick(event)}
                          className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors border border-transparent hover:border-emerald-200" 
                          title="Duplicate Event"
                        >
                          <CopyPlus size={18} />
                        </button>
                        <button 
                          onClick={() => handleEditClick(event)}
                          className="p-2 hover:bg-amber-50 text-amber-600 rounded-lg transition-colors border border-transparent hover:border-amber-200" 
                          title="Edit Event"
                        >
                          <Edit size={18} />
                        </button>
                        <button 
                          onClick={() => fullDeleteEvent(event.id)}
                          className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors border border-transparent hover:border-red-200" 
                          title="Delete Event"
                        >
                          <Trash2 size={18} />
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
  </div>
);
};
