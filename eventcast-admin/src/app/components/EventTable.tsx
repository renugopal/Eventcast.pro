"use client";

import React, { useState, useRef } from "react";
import { RefreshCw, ExternalLink, Edit, Trash2, AlertCircle, Play, Copy, Search, Download, QrCode, MessageCircle } from "lucide-react";

interface EventTableProps {
  events: any[];
  isLoadingEvents: boolean;
  fetchEvents: () => void;
  handleEditClick: (event: any) => void;
  generateWebsite: (event: any) => void;
  fullDeleteEvent: (id: string) => void;
}

export const EventTable: React.FC<EventTableProps> = ({
  events,
  isLoadingEvents,
  fetchEvents,
  handleEditClick,
  generateWebsite,
  fullDeleteEvent
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [tableDensity, setTableDensity] = useState<"compact" | "standard" | "spacious">("standard");
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: number }>({
    identity: 280,
    schedule: 160,
    venue: 200,
    youtube: 220,
    views: 80,
    control: 180,
    qr: 80,
    actions: 120
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

  const getPadding = () => {
    if (tableDensity === "compact") return "p-2";
    if (tableDensity === "spacious") return "p-6";
    return "p-4";
  };

  return (
    <div className="w-full space-y-6">
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
          <table className="w-full text-left border-collapse table-fixed">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-800">
                <th 
                  style={{ width: columnWidths.identity }}
                  className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group"
                >
                  <div onClick={() => requestSort('groom_name')} className="cursor-pointer hover:text-white transition-colors">
                    Event Identity {sortConfig?.key === 'groom_name' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'identity')}
                    onDoubleClick={() => handleDoubleClick('identity')}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  />
                </th>
                <th 
                  style={{ width: columnWidths.schedule }}
                  className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group"
                >
                  <div onClick={() => requestSort('date')} className="cursor-pointer hover:text-white transition-colors">
                    Schedule {sortConfig?.key === 'date' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'schedule')}
                    onDoubleClick={() => handleDoubleClick('schedule')}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  />
                </th>
                <th style={{ width: columnWidths.venue }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group">
                  Venue
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'venue')}
                    onDoubleClick={() => handleDoubleClick('venue')}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  />
                </th>
                <th style={{ width: columnWidths.youtube }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group">
                  YouTube / Stream
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'youtube')}
                    onDoubleClick={() => handleDoubleClick('youtube')}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  />
                </th>
                <th 
                  style={{ width: columnWidths.views }}
                  className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center relative group"
                >
                  <div onClick={() => requestSort('view_count')} className="cursor-pointer hover:text-white transition-colors">
                    Views {sortConfig?.key === 'view_count' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'views')}
                    onDoubleClick={() => handleDoubleClick('views')}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  />
                </th>
                <th style={{ width: columnWidths.control }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative group">
                  Live Control
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'control')}
                    onDoubleClick={() => handleDoubleClick('control')}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  />
                </th>
                <th style={{ width: columnWidths.qr }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center relative group">
                  QR
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'qr')}
                    onDoubleClick={() => handleDoubleClick('qr')}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  />
                </th>
                <th style={{ width: columnWidths.actions }} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right relative group">
                  Actions
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'actions')}
                    onDoubleClick={() => handleDoubleClick('actions')}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-20 text-center">
                    <div className="flex flex-col items-center gap-2 opacity-40">
                      <AlertCircle size={48} strokeWidth={1} />
                      <p className="font-bold text-slate-500">No events found matching your criteria.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedEvents.map(event => (
                  <tr key={event.id} className="hover:bg-blue-50/30 transition-colors group even:bg-slate-50/50">
                    <td className={`${getPadding()} overflow-hidden`}>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 flex-shrink-0">
                          {event.thumbnail_url ? (
                            <img src={event.thumbnail_url} className="w-full h-full object-cover" alt="Thumb" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                              <AlertCircle size={20} />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-black text-slate-800 tracking-tight leading-none mb-1 text-sm uppercase">
                            {event.groom_name || event.celebrant_name} & {event.bride_name || 'Family'}
                          </div>
                          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2">
                            {event.event_type}
                            {event.template_id && (
                              <span className="bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded text-[8px] border border-blue-100">
                                {event.template_id.replace('wedding-template-', 'v')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={`${getPadding()}`}>
                      <div className="text-sm font-bold text-slate-700 mb-1">{formatDisplayDate(event.event_date)}</div>
                      <div className="flex items-center gap-2">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{event.event_time}</div>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border ${getEventStatus(event.event_date).color}`}>
                          {getEventStatus(event.event_date).label}
                        </span>
                      </div>
                    </td>
                    <td className={`${getPadding()}`}>
                      <div className="text-xs text-slate-600 font-medium max-w-[200px] truncate mb-1">{event.venue_name}</div>
                      {event.photographers?.name && (
                        <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest bg-slate-50 inline-block px-1.5 py-0.5 rounded border border-slate-100">
                          📷 {event.photographers.name}
                        </div>
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
                    <td className={`${getPadding()} text-center`}>
                       <div className="flex flex-col items-center gap-1 group/qr">
                         <img 
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=https://eventcast.pro/events/${event.slug}`}
                            className="w-8 h-8 rounded border border-slate-200"
                            alt="QR"
                         />
                         <a href={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=https://eventcast.pro/events/${event.slug}`} download className="text-[8px] font-bold text-blue-500 opacity-0 group-hover/qr:opacity-100">PNG</a>
                       </div>
                    </td>
                    <td className={`${getPadding()}`}>
                      <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                        <a 
                          href={`https://eventcast.pro/events/${event.slug}`} 
                          target="_blank" 
                          className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors border border-transparent hover:border-blue-200" 
                          title="View Live Page"
                        >
                          <ExternalLink size={18} />
                        </a>
                        <button 
                          onClick={() => { navigator.clipboard.writeText(`https://eventcast.pro/events/${event.slug}`); alert("Link Copied!"); }}
                          className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors border border-transparent hover:border-slate-200" 
                          title="Copy Page URL"
                        >
                          <Copy size={18} />
                        </button>
                        <button 
                          onClick={() => generateWebsite(event)} 
                          className="p-2 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors border border-transparent hover:border-indigo-200" 
                          title="Force Regenerate Files"
                        >
                          <RefreshCw size={18} />
                        </button>
                        

                        <button 
                          onClick={() => {
                            const message = `Hello! We are excited to invite you to the ${event.event_type}. Join us live here: https://eventcast.pro/events/${event.slug}`;
                            window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
                          }} 
                          className="p-2 hover:bg-green-50 text-green-600 rounded-lg transition-colors border border-transparent hover:border-green-200" 
                          title="Share to Client/Guests via WhatsApp"
                        >
                          <MessageCircle size={18} />
                        </button>

                        <button 
                          onClick={() => handleEditClick(event)} 
                          className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                        >
                          <Edit size={18} />
                        </button>
                        <button 
                          onClick={() => {
                            if (window.confirm("WARNING: FULL DELETE!\nThis will permanently delete the website record, the YouTube Live event, and ALL photos/videos from Cloudinary.\nThis cannot be undone. Proceed?")) {
                              fullDeleteEvent(event.id);
                            }
                          }} 
                          className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors border border-red-100 hover:border-red-200 shadow-sm" 
                          title="FULL DELETE (Website + YT + Media)"
                        >
                          <AlertCircle size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
