"use client";

import React, { useState, useRef, useEffect } from "react";
import { RefreshCw, ExternalLink, Edit, Trash2, AlertCircle, Play, Copy, Search, Download, QrCode, MessageCircle, Link as LinkIcon, CopyPlus, StickyNote, X, Eye, ChevronRight, List, MapPin, Clock, ZapOff, Activity, CheckCircle2 } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { useToast, AlertDialog } from "./Toast";
import { supabase } from "@/lib/supabase";
import { EventTableMobileCards } from "./EventTableMobileCards";

interface EventTableProps {
  events: any[];
  wishes: any[];
  isLoadingEvents: boolean;
  fetchEvents: () => void;
  handleEditClick: (event: any) => void;
  handleDuplicateClick: (event: any) => void;
  fullDeleteEvent: (id: string, permanent?: boolean) => void;
  deleteMultipleEvents: (ids: string[]) => void;
  isArchiveView?: boolean;
  restoreEvent?: (id: string) => void;
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
  deleteMultipleEvents,
  isArchiveView = false,
  restoreEvent
}) => {
  const { success, error: toastError, info } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingYoutube, setTogglingYoutube] = useState<Record<string, boolean>>({});
  const [restartingServer, setRestartingServer] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [alertDialog, setAlertDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  function copyToClipboard(text: string, key: string, label: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    info(`${label} copied`, 'Pasted to clipboard');
  }

  function openConfirm(title: string, message: string, onConfirm: () => void) {
    setAlertDialog({ open: true, title, message, onConfirm });
  }

  function closeConfirm() {
    setAlertDialog(prev => ({ ...prev, open: false }));
  }

  const handleRestartServer = async (slug: string, eventId: string) => {
    setRestartingServer(prev => ({ ...prev, [eventId]: true }));
    try {
      const res = await authFetch('/api/media/restart-channel', {
        method: 'POST',
        body: JSON.stringify({ slug }),
      });
      if (res.ok) success('Server restarted!', 'Stream channel process restarted successfully.');
      else toastError('Restart failed', 'Could not restart the server. Try again.');
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
        success(
          `YouTube Relay ${enabled ? 'Started' : 'Stopped'}`,
          enabled ? 'Stream is now relaying to YouTube.' : 'YouTube relay has been terminated.'
        );
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

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const applyMobileDensity = () => {
      if (mq.matches) setTableDensity("compact");
    };
    applyMobileDensity();
    mq.addEventListener("change", applyMobileDensity);
    return () => mq.removeEventListener("change", applyMobileDensity);
  }, []);

  // ── Realtime: auto-patch deployment_status when it changes in Supabase ──────
  useEffect(() => {
    const channel = supabase
      .channel('eventcast-deployment-status')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        (payload) => {
          const updated = payload.new as any;
          if (!updated?.id) return;
          // Only patch if deployment_status changed — avoids full re-renders
          const prev = events.find((e) => e.id === updated.id);
          if (
            prev &&
            (prev.deployment_status !== updated.deployment_status ||
              prev.deployment_error !== updated.deployment_error)
          ) {
            fetchEvents(); // lightweight: updates the whole list in-place
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ─────────────────────────────────────────────────────────────────────────────


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

  const buildYoutubeTitle = (event: any) => {
    const heart = (event.event_type || "").toLowerCase().includes("wedding") ? "❤️" : "✨";
    return `${event.groom_name || event.celebrant_name} ${heart} ${event.bride_name || "Family"} ${event.event_type} Live | ${formatDisplayDate(event.event_date)}`;
  };

  const handleGoLive = async (event: any) => {
    const res = await authFetch("/api/youtube/toggle-live", {
      method: "POST",
      body: JSON.stringify({ eventId: event.id, broadcastId: event.youtube_broadcast_id, title: buildYoutubeTitle(event), isLive: true }),
    });
    if (res.ok) success("🔴 BROADCAST LIVE", "Stream is now live on YouTube.");
    else toastError("Failed to go live", "Check broadcast settings.");
  };

  const handleTerminate = async (event: any) => {
    const res = await authFetch("/api/youtube/toggle-live", {
      method: "POST",
      body: JSON.stringify({ eventId: event.id, broadcastId: event.youtube_broadcast_id, title: buildYoutubeTitle(event), isLive: false }),
    });
    if (res.ok) success("Broadcast terminated", "Stream has ended successfully.");
    else toastError("Termination failed", "Could not end the broadcast.");
  };

  const handleShareWhatsApp = (event: any) => {
    const message = `Hello! We are excited to invite you to the ${event.event_type || "event"}. Join us live here: https://eventcast.pro/events/${event.slug}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  const getPadding = () => {
    if (tableDensity === "compact") return "p-2";
    if (tableDensity === "spacious") return "p-6";
    return "p-4";
  };

  return (
    <div className="w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <AlertDialog
        open={alertDialog.open}
        title={alertDialog.title}
        message={alertDialog.message}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { alertDialog.onConfirm(); closeConfirm(); }}
        onCancel={closeConfirm}
      />
      {selectedEventIds.size > 0 && (
        <div
          className="ec-panel flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in slide-in-from-top-6 duration-500"
          style={{ background: "var(--info-50)", borderColor: "#BFDBFE" }}
        >
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg text-white flex-shrink-0"
              style={{ background: "var(--info)", boxShadow: "var(--shadow-violet)" }}
            >
              {selectedEventIds.size}
            </div>
            <div>
              <p className="font-bold text-base tracking-tight" style={{ color: "var(--foreground)" }}>Active selection</p>
              <p className="text-xs font-semibold uppercase tracking-wider mt-0.5" style={{ color: "var(--info)" }}>
                {selectedEventIds.size} event{selectedEventIds.size === 1 ? "" : "s"} selected
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => openConfirm(
                `Wipe ${selectedEventIds.size} events?`,
                `CRITICAL: This will permanently delete ${selectedEventIds.size} events and all associated data from the database. This cannot be undone.`,
                () => { deleteMultipleEvents(Array.from(selectedEventIds)); setSelectedEventIds(new Set()); }
              )}
              className="ec-btn ec-btn-danger ec-btn-sm"
            >
              <Trash2 size={16} /> Force batch wipe
            </button>
            <button
              type="button"
              onClick={() => setSelectedEventIds(new Set())}
              className="ec-btn ec-btn-secondary ec-btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Control Bar */}
      <div className="ec-section-header gap-6" style={{ marginBottom: 0 }}>
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--info-50)", color: "var(--info)", border: "2px solid #BFDBFE" }}
          >
            <List size={22} />
          </div>
          <div>
            <h2 className="ec-page-title" style={{ fontSize: "24px" }}>Events database</h2>
            <p className="ec-section-sub">{filteredEvents.length} active events</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 ml-auto shrink-0">
          <div className="relative flex-1 sm:flex-none min-w-[200px] max-w-[320px]">
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ec-input ec-input-has-icon w-full sm:w-72"
            />
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-tertiary)" }} />
          </div>
          <div className="relative">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="ec-input ec-input-has-chevron pr-10 cursor-pointer appearance-none min-w-[140px]"
              style={{ fontSize: "13px", fontWeight: 600 }}
            >
              <option>All Events</option>
              <option>Wedding</option>
              <option>Reception</option>
              <option>Engagement</option>
              <option>Birthday</option>
              <option>Half Saree</option>
              <option>Dhoti Ceremony</option>
            </select>
            <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" size={16} style={{ color: "var(--text-tertiary)" }} />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl border ec-hide-xs" style={{ borderColor: "var(--border)", background: "var(--surface-hover)" }}>
            <button
              type="button"
              onClick={() => setTableDensity("compact")}
              className={`ec-btn ec-btn-sm !min-h-[32px] !py-1.5 !px-3 ${tableDensity === "compact" ? "ec-btn-primary" : "ec-btn-ghost !border-transparent !bg-transparent"}`}
            >
              Compact
            </button>
            <button
              type="button"
              onClick={() => setTableDensity("standard")}
              className={`ec-btn ec-btn-sm !min-h-[32px] !py-1.5 !px-3 ${tableDensity === "standard" ? "ec-btn-primary" : "ec-btn-ghost !border-transparent !bg-transparent"}`}
            >
              Standard
            </button>
          </div>

          <button
            type="button"
            onClick={exportToCSV}
            className="ec-btn ec-btn-sm bg-emerald-500 hover:bg-emerald-600 text-white border-transparent"
          >
            <Download size={16} /> Export
          </button>
          <button
            type="button"
            onClick={fetchEvents}
            disabled={isLoadingEvents}
            className="ec-icon-btn"
            title="Refresh events"
            aria-label="Refresh events"
          >
            <RefreshCw size={20} className={isLoadingEvents ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Mobile card list */}
      <div className="ec-mobile-only">
        <EventTableMobileCards
          events={sortedEvents}
          wishes={wishes}
          isLoading={isLoadingEvents}
          isArchiveView={isArchiveView}
          selectedIds={selectedEventIds}
          onToggleSelect={toggleSelection}
          onEdit={handleEditClick}
          onDuplicate={handleDuplicateClick}
          onArchive={(id) => openConfirm(
            "Archive this event?",
            "This will move the event to the archive. It will no longer be visible on the public site.",
            () => fullDeleteEvent(id, false)
          )}
          onPermanentDelete={(id) => openConfirm(
            "Permanently delete this event?",
            "WARNING: This will permanently wipe the event, remove the YouTube broadcast, and erase all associated media files. This cannot be undone.",
            () => fullDeleteEvent(id, true)
          )}
          onRestore={restoreEvent}
          onShareWhatsApp={handleShareWhatsApp}
          onCopy={copyToClipboard}
          copiedKey={copiedKey}
          onRestart={handleRestartServer}
          restarting={restartingServer}
          onToggleYoutube={toggleYoutubeRelay}
          togglingYoutube={togglingYoutube}
          onPreview={setPreviewStream}
          onGoLive={handleGoLive}
          onTerminate={handleTerminate}
          openQrId={openQrEventId}
          setOpenQrId={setOpenQrEventId}
          formatDisplayDate={formatDisplayDate}
          getEventStatus={getEventStatus}
          adminOptimize={adminOptimize}
        />
      </div>

      {/* Desktop table */}
      <div className="ec-card ec-desktop-only" style={{ padding: 0, overflow: "hidden" }}>
        <div className="ec-table-scroll-hint">
          Swipe horizontally to see all columns →
        </div>
        <div className="ec-table-scroll custom-scrollbar">
          <table className="ec-table min-w-[1300px] table-fixed text-left" data-density={tableDensity}>
            <thead>
              <tr>
                <th style={{ width: columnWidths.select }} className="!text-center">
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selectedEventIds.size === sortedEvents.length && sortedEvents.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded cursor-pointer accent-[var(--primary)]"
                    />
                  </div>
                </th>
                <th style={{ width: columnWidths.identity }} className="relative group">
                  <div onClick={() => requestSort('groom_name')} className="cursor-pointer hover:text-[var(--foreground)] transition-colors flex items-center gap-2">
                    Event details {sortConfig?.key === 'groom_name' ? (sortConfig.direction === 'asc' ? <ChevronRight size={14} className="-rotate-90" /> : <ChevronRight size={14} className="rotate-90" />) : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'identity')} onDoubleClick={() => handleDoubleClick('identity')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.schedule }} className="relative group">
                  <div onClick={() => requestSort('date')} className="cursor-pointer hover:text-[var(--foreground)] transition-colors flex items-center gap-2">
                    Date & time {sortConfig?.key === 'date' ? (sortConfig.direction === 'asc' ? <ChevronRight size={14} className="-rotate-90" /> : <ChevronRight size={14} className="rotate-90" />) : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'schedule')} onDoubleClick={() => handleDoubleClick('schedule')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.venue }} className="relative group">
                  Venue & photographer
                  <div onMouseDown={(e) => handleMouseDown(e, 'venue')} onDoubleClick={() => handleDoubleClick('venue')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.youtube }} className="relative group">
                  Stream & relay
                  <div onMouseDown={(e) => handleMouseDown(e, 'youtube')} onDoubleClick={() => handleDoubleClick('youtube')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.views }} className="!text-center relative group">
                  <div onClick={() => requestSort('view_count')} className="cursor-pointer hover:text-[var(--foreground)] transition-colors inline-flex items-center justify-center gap-1">
                    Views {sortConfig?.key === 'view_count' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div onMouseDown={(e) => handleMouseDown(e, 'views')} onDoubleClick={() => handleDoubleClick('views')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.control }} className="relative group">
                  YouTube control
                  <div onMouseDown={(e) => handleMouseDown(e, 'control')} onDoubleClick={() => handleDoubleClick('control')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
                <th style={{ width: columnWidths.actions }} className="!text-right relative group">
                  Quick actions
                  <div onMouseDown={(e) => handleMouseDown(e, 'actions')} onDoubleClick={() => handleDoubleClick('actions')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoadingEvents ? (
                <tr>
                  <td colSpan={8} className="!py-24 text-center">
                    <RefreshCw className="animate-spin mx-auto mb-6" size={48} strokeWidth={1.5} style={{ color: "var(--primary)" }} />
                    <p className="font-bold text-lg tracking-tight" style={{ color: "var(--foreground)" }}>Loading events…</p>
                    <p className="text-xs font-semibold uppercase tracking-wider mt-2" style={{ color: "var(--text-tertiary)" }}>Fetching database records</p>
                  </td>
                </tr>
              ) : (
                sortedEvents.map((event, idx) => {
                  const eventWishes = wishes.filter(w => w.event_id === event.id);
                  const status = getEventStatus(event.event_date);
                  return (
                    <tr
                      key={event.id}
                      className="group animate-in fade-in slide-in-from-left-2 duration-500"
                      style={{
                        animationDelay: `${idx * 40}ms`,
                        ...(selectedEventIds.has(event.id) ? { background: "var(--primary-50)" } : {}),
                      }}
                    >
                      <td>
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={selectedEventIds.has(event.id)}
                            onChange={() => toggleSelection(event.id)}
                            className="w-4 h-4 rounded cursor-pointer accent-[var(--primary)]"
                          />
                        </div>
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="flex items-center gap-4">
                          <div
                            className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 relative group-hover:scale-105 transition-transform duration-300 border"
                            style={{ borderColor: "var(--border)", background: "var(--surface-hover)" }}
                          >
                            {event.thumbnail_url ? (
                              <img src={adminOptimize(event.thumbnail_url, 150)} className="w-full h-full object-cover" alt="Thumb" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-tertiary)" }}><AlertCircle size={28} strokeWidth={1} /></div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span
                                className="ec-badge"
                                style={{ background: "var(--info-50)", color: "var(--info)", border: "1px solid #BFDBFE", fontSize: "11px", padding: "4px 10px" }}
                              >
                                {event.event_type}
                              </span>

                              {/* Deployment Status Badge */}
                              {event.deployment_status === 'deploying' && (
                                <span className="ec-badge ec-badge-amber animate-pulse" style={{ fontSize: "11px", padding: "4px 10px" }}>
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                                  Deploying
                                </span>
                              )}
                              {event.deployment_status === 'live' && (
                                <span className="ec-badge ec-badge-live" style={{ fontSize: "11px", padding: "4px 10px" }}>Live</span>
                              )}
                              {event.deployment_status === 'failed' && (
                                <span
                                  className="ec-badge cursor-help"
                                  style={{ background: "var(--error-50)", color: "var(--error)", border: "1px solid #FECDD3", fontSize: "11px", padding: "4px 10px" }}
                                  title={event.deployment_error || 'Deployment failed'}
                                >
                                  Failed
                                </span>
                              )}

                              {eventWishes.length > 0 && (
                                <span className="ec-badge" style={{ background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0", fontSize: "11px", padding: "4px 10px" }}>
                                  <MessageCircle size={10} /> {eventWishes.length}
                                </span>
                              )}
                              {event.notes && (
                                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--accent)" }} title={event.notes} />
                              )}
                            </div>
                            <h3 className="text-base font-bold leading-tight truncate tracking-tight group-hover:text-[var(--primary)] transition-colors" style={{ color: "var(--foreground)" }}>
                              {event.groom_name || event.celebrant_name}
                              {event.bride_name && event.bride_name.toLowerCase() !== 'family' && (
                                <span className="font-medium" style={{ color: "var(--text-secondary)" }}> & {event.bride_name}</span>
                              )}
                            </h3>
                            {(!event.bride_name || event.bride_name.toLowerCase() === 'family') && (
                                <p className="text-xs font-semibold uppercase tracking-wider mt-1" style={{ color: "var(--text-tertiary)" }}>
                                  Family event
                                </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="text-sm font-bold mb-1.5 tracking-tight" style={{ color: "var(--foreground)" }}>{formatDisplayDate(event.event_date)}</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
                            <Clock size={10} /> {event.event_time}
                          </div>
                          <span className={`ec-badge ${status.label === 'Today' ? 'ec-badge-live' : status.label === 'Upcoming' ? 'ec-badge-amber' : 'ec-badge-completed'}`} style={{ fontSize: "11px", padding: "4px 10px" }}>
                            {status.label}
                          </span>
                        </div>
                      </td>
                      <td className={`${getPadding()} overflow-hidden`}>
                        <div className="text-sm font-medium max-w-[200px] truncate mb-2 flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                           <MapPin size={12} style={{ color: "var(--text-tertiary)" }} /> {event.venue_name}
                        </div>
                        {event.photographers?.name ? (
                          <div className="flex items-center gap-2 p-2 pr-3 rounded-xl border w-fit transition-all group/pg" style={{ borderColor: "var(--border-subtle)", background: "var(--surface-hover)" }}>
                            <div className="w-9 h-9 rounded-lg overflow-hidden bg-white p-1.5 border group-hover/pg:scale-105 transition-transform" style={{ borderColor: "var(--border)" }}>
                               {event.photographers.logo_url ? (
                                <img src={adminOptimize(event.photographers.logo_url, 100)} className="w-full h-full object-contain" alt="" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center font-bold text-xs text-white rounded" style={{ background: "var(--primary)" }}>
                                  {(event.photographers.name || '?')[0].toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-xs font-bold leading-tight" style={{ color: "var(--foreground)" }}>{event.photographers.name}</div>
                              {event.photographers.city && <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--text-tertiary)" }}>{event.photographers.city}</div>}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>Uncredited partner</div>
                        )}
                      </td>
                    <td className={`${getPadding()}`}>
                      <div className="flex flex-col gap-3 items-start min-w-[220px]">
                        <div className="w-full space-y-2">
                          <div className="flex items-center justify-between px-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--info)" }}>Ingest point</span>
                            <div className="flex items-center gap-1.5">
                              {event.restreamer_url && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewStream(event)}
                                  className="ec-btn ec-btn-sm ec-btn-primary !min-h-[28px] !py-1 !px-2.5"
                                >
                                  Preview
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRestartServer(event.slug, event.id)}
                                disabled={restartingServer[event.id]}
                                className="ec-btn ec-btn-sm ec-btn-amber !min-h-[28px] !py-1 !px-2.5 text-white disabled:opacity-50"
                              >
                                {restartingServer[event.id] ? 'Busy' : 'Restart'}
                              </button>
                            </div>
                          </div>
                          <div className="ec-panel !p-3 !rounded-xl flex flex-col gap-2 group/node" style={{ padding: "12px" }}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-mono truncate max-w-[140px]" style={{ color: "var(--text-secondary)" }}>{event.restreamer_ingest_url || `rtmp://34.100.142.25/${event.slug}`}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(event.restreamer_ingest_url || `rtmp://34.100.142.25/${event.slug}`, `ingest-${event.id}`, 'Ingest URL')}
                                className="ec-icon-btn !min-w-[32px] !min-h-[32px] !p-1.5"
                                style={{ color: copiedKey === `ingest-${event.id}` ? "var(--success)" : undefined }}
                              >
                                {copiedKey === `ingest-${event.id}` ? <CheckCircle2 size={14}/> : <CopyPlus size={14}/>}
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-2 border-t pt-2" style={{ borderColor: "var(--border-subtle)" }}>
                              <span className="text-[11px] font-mono font-bold uppercase" style={{ color: "var(--info)" }}>● {event.restreamer_stream_key || 'live'}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(event.restreamer_stream_key || 'live', `key-${event.id}`, 'Stream Key')}
                                className="ec-icon-btn !min-w-[32px] !min-h-[32px] !p-1.5"
                                style={{ color: copiedKey === `key-${event.id}` ? "var(--success)" : undefined }}
                              >
                                {copiedKey === `key-${event.id}` ? <CheckCircle2 size={14}/> : <Copy size={14}/>}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="w-full space-y-2">
                          <div className="flex items-center justify-between px-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-red-600">Global relay</span>
                            {event.youtube_stream_key && (
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-semibold uppercase ${togglingYoutube[event.id] ? 'animate-pulse' : ''}`} style={{ color: togglingYoutube[event.id] ? "var(--info)" : "var(--text-tertiary)" }}>
                                  {togglingYoutube[event.id] ? 'Syncing…' : 'Status'}
                                </span>
                                <div className="flex items-center rounded-lg border p-0.5 bg-red-600">
                                  <button
                                    type="button"
                                    onClick={() => toggleYoutubeRelay(event, true)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all text-white/90 ${togglingYoutube[event.id] ? 'opacity-30' : 'hover:bg-red-700'}`}
                                    title="Start Relay"
                                  >START</button>
                                  <button
                                    type="button"
                                    onClick={() => toggleYoutubeRelay(event, false)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all text-white/90 ${togglingYoutube[event.id] ? 'opacity-30' : 'hover:bg-red-800'}`}
                                    title="Kill Relay"
                                  >STOP</button>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="ec-panel !p-3 !rounded-xl flex flex-col gap-2">
                            {event.youtube_stream_key && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-mono text-red-600 truncate max-w-[140px]">{event.youtube_stream_key}</span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(event.youtube_stream_key, `yt-${event.id}`, 'YouTube Key')}
                                  className="ec-icon-btn !min-w-[32px] !min-h-[32px] !p-1.5"
                                  style={{ color: copiedKey === `yt-${event.id}` ? "var(--success)" : undefined }}
                                >
                                  {copiedKey === `yt-${event.id}` ? <CheckCircle2 size={14}/> : <Copy size={14}/>}
                                </button>
                              </div>
                            )}
                            {event.vod_link && (
                              <a href={event.vod_link} target="_blank" rel="noopener noreferrer" className="ec-btn ec-btn-sm bg-red-600 hover:bg-red-700 text-white border-transparent w-full !min-h-[32px]">
                                <Play size={12} fill="currentColor" /> Monitor relay
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={`${getPadding()} text-center`}>
                       <div className="inline-flex flex-col items-center gap-0.5">
                         <span className="font-mono text-lg font-bold leading-none" style={{ color: "var(--foreground)" }}>{event.view_count || 0}</span>
                         <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>Visitors</span>
                       </div>
                    </td>
                    <td className={`${getPadding()}`}>
                       {event.youtube_broadcast_id ? (
                         <div className="flex flex-col gap-2">
                           <button
                             type="button"
                             onClick={async () => {
                               const heart = (event.event_type || '').toLowerCase().includes('wedding') ? '❤️' : '✨';
                               const baseTitle = `${event.groom_name || event.celebrant_name} ${heart} ${event.bride_name || 'Family'} ${event.event_type} Live | ${formatDisplayDate(event.event_date)}`;
                               const res = await authFetch('/api/youtube/toggle-live', {
                                 method: 'POST',
                                 body: JSON.stringify({ eventId: event.id, broadcastId: event.youtube_broadcast_id, title: baseTitle, isLive: true }),
                               });
                               if (res.ok) success('🔴 BROADCAST LIVE', 'Stream is now live on YouTube.');
                               else toastError('Failed to go live', 'Check broadcast settings.');
                             }}
                             className="ec-btn ec-btn-sm bg-red-600 hover:bg-red-500 text-white border-transparent w-full"
                           >
                             Go live
                           </button>
                           <button
                             type="button"
                             onClick={async () => {
                               const heart = (event.event_type || '').toLowerCase().includes('wedding') ? '❤️' : '✨';
                               const baseTitle = `${event.groom_name || event.celebrant_name} ${heart} ${event.bride_name || 'Family'} ${event.event_type} Live | ${formatDisplayDate(event.event_date)}`;
                               const res = await authFetch('/api/youtube/toggle-live', {
                                 method: 'POST',
                                 body: JSON.stringify({ eventId: event.id, broadcastId: event.youtube_broadcast_id, title: baseTitle, isLive: false }),
                               });
                               if (res.ok) success('Broadcast terminated', 'Stream has ended successfully.');
                               else toastError('Termination failed', 'Could not end the broadcast.');
                             }}
                             className="ec-btn ec-btn-secondary ec-btn-sm w-full"
                           >
                             Terminate
                           </button>
                         </div>
                       ) : (
                        <div className="flex flex-col items-center gap-1 opacity-40">
                            <ZapOff size={20} style={{ color: "var(--text-tertiary)" }} />
                            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>No relay</span>
                         </div>
                       )}
                    </td>
                    <td className={`${getPadding()}`}>
                       <div className="flex items-center justify-end gap-1.5 flex-wrap max-w-[280px]">
                         <div className="relative">
                           <button
                             type="button"
                             onClick={() => setOpenQrEventId(openQrEventId === event.id ? null : event.id)}
                             className={openQrEventId === event.id ? "ec-icon-btn ec-btn-primary !text-white" : "ec-icon-btn"}
                             title="Show QR code"
                             aria-label="Show QR code"
                           >
                             <QrCode size={18} />
                           </button>
                           {openQrEventId === event.id && (
                             <div className="ec-card absolute right-0 bottom-full mb-3 z-50 w-56 !p-4 animate-in zoom-in-95 slide-in-from-bottom-2 duration-300" style={{ boxShadow: "var(--shadow-dropdown)" }}>
                               <div className="flex items-center justify-between mb-3">
                                 <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--info)" }}>Event QR</span>
                                 <button type="button" onClick={() => setOpenQrEventId(null)} className="ec-icon-btn ec-icon-btn-danger !min-w-[28px] !min-h-[28px] !p-1"><X size={12} /></button>
                               </div>
                               <div className="bg-white p-2 rounded-xl mb-3 border" style={{ borderColor: "var(--border-subtle)" }}>
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
                                    className="ec-btn ec-btn-secondary ec-btn-sm flex-1"
                                 >PNG</a>
                                 <a
                                    href={`https://eventcast.pro/events/${event.slug}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ec-btn ec-btn-primary ec-btn-sm flex-1 text-white"
                                 >Open</a>
                                </div>
                             </div>
                           )}
                         </div>

                        <button
                          type="button"
                          onClick={() => copyToClipboard(`https://eventcast.pro/events/${event.slug}`, `live-${event.id}`, 'Live Page Link')}
                          className="ec-icon-btn"
                          title="Copy live page link"
                          aria-label="Copy live page link"
                          style={{ color: copiedKey === `live-${event.id}` ? "var(--success)" : "var(--info)" }}
                        >
                          {copiedKey === `live-${event.id}` ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                        </button>

                        <button
                          type="button"
                          onClick={() => copyToClipboard(`${window.location.origin}/portal/${event.slug}`, `portal-${event.id}`, 'Client Portal Link')}
                          className="ec-icon-btn"
                          title="Copy client portal link"
                          aria-label="Copy client portal link"
                          style={{ color: copiedKey === `portal-${event.id}` ? "var(--success)" : "#DB2777" }}
                        >
                          {copiedKey === `portal-${event.id}` ? <CheckCircle2 size={18} /> : <LinkIcon size={18} />}
                        </button>

                        {isArchiveView ? (
                          <>
                            <button
                              type="button"
                              onClick={() => restoreEvent && restoreEvent(event.id)}
                              className="ec-icon-btn"
                              title="Restore event"
                              aria-label="Restore event"
                              style={{ color: "var(--info)" }}
                            >
                              <RefreshCw size={18} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openConfirm(
                                'Permanently delete this event?',
                                'WARNING: This will permanently wipe the event, remove the YouTube broadcast, and erase all associated media files. This cannot be undone.',
                                () => fullDeleteEvent(event.id, true)
                              )}
                              className="ec-icon-btn ec-icon-btn-danger"
                              title="Permanently delete event"
                              aria-label="Permanently delete event"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDuplicateClick(event)}
                              className="ec-icon-btn"
                              title="Duplicate event"
                              aria-label="Duplicate event"
                              style={{ color: "var(--success)" }}
                            >
                              <CopyPlus size={18} />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const message = `Hello! We are excited to invite you to the ${event.event_type || 'event'}. Join us live here: https://eventcast.pro/events/${event.slug}`;
                                window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
                              }}
                              className="ec-icon-btn"
                              title="Share to WhatsApp"
                              aria-label="Share to WhatsApp"
                              style={{ color: "#16A34A" }}
                            >
                              <MessageCircle size={18} />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleEditClick(event)}
                              className="ec-icon-btn"
                              title="Edit event"
                              aria-label="Edit event"
                              style={{ color: "var(--accent)" }}
                            >
                              <Edit size={18} />
                            </button>

                            <button
                              type="button"
                              onClick={() => openConfirm(
                                'Archive this event?',
                                'This will move the event to the archive. It will no longer be visible on the public site.',
                                () => fullDeleteEvent(event.id, false)
                              )}
                              className="ec-icon-btn ec-icon-btn-danger"
                              title="Archive event"
                              aria-label="Archive event"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300" style={{ background: "rgba(26,26,46,0.55)" }}>
          <div
            className="ec-card w-full max-w-3xl !p-0 overflow-hidden animate-in zoom-in-95 duration-300"
            style={{ boxShadow: "var(--shadow-modal)" }}
          >
            <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              <div>
                <h3 className="ec-page-title text-xl flex items-center gap-2" style={{ fontSize: "20px" }}>
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Live stream monitor
                </h3>
                <p className="ec-section-sub mt-1">
                  {previewStream.groom_name || previewStream.celebrant_name} & {previewStream.bride_name || 'Family'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewStream(null)}
                className="ec-icon-btn"
                aria-label="Close preview"
              >
                <X size={22} />
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
              <div id="admin-preview-loader" className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white z-10">
                <RefreshCw size={40} className="animate-spin mb-6" style={{ color: "var(--info)" }} />
                <p className="text-xs font-semibold uppercase tracking-wider animate-pulse text-white/80">Handshaking media server…</p>
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
            
            <div className="p-6 flex flex-col md:flex-row gap-4 items-center justify-between border-t" style={{ borderColor: "var(--border-subtle)", background: "var(--surface-hover)" }}>
              <div className="flex items-center gap-4 flex-wrap">
                <span className="ec-badge ec-badge-live" style={{ fontSize: "11px" }}>
                  <Activity size={10} /> Active pipeline
                </span>
                <div className="text-xs font-mono px-3 py-1 rounded-lg border" style={{ color: "var(--text-secondary)", borderColor: "var(--border)", background: "var(--surface)" }}>
                  SID: {previewStream.slug}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => copyToClipboard(
                    previewStream.restreamer_ingest_url || `rtmp://34.100.142.25/${previewStream.slug}`,
                    'rtmp-preview',
                    'RTMP Ingest URL'
                  )}
                  className="ec-btn ec-btn-secondary ec-btn-sm"
                >
                  {copiedKey === 'rtmp-preview' ? <CheckCircle2 size={14} style={{ color: "var(--success)" }} /> : <Copy size={14} />} Ingest URL
                </button>
                <a
                  href={`https://eventcast.pro/events/${previewStream.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ec-btn ec-btn-primary ec-btn-sm text-white"
                >
                  <ExternalLink size={14} /> View live page
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
