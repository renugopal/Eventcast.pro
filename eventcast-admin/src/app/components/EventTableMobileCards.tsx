"use client";

import React from "react";
import {
  RefreshCw, ExternalLink, Edit, Trash2, Copy, QrCode, MessageCircle,
  CopyPlus, X, MapPin, Clock, CheckCircle2, ZapOff, AlertCircle,
} from "lucide-react";

type EventTableMobileCardsProps = {
  events: any[];
  wishes: any[];
  isLoading: boolean;
  isArchiveView: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (event: any) => void;
  onDuplicate: (event: any) => void;
  onArchive: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onRestore?: (id: string) => void;
  onShareWhatsApp: (event: any) => void;
  onCopy: (text: string, key: string, label: string) => void;
  copiedKey: string | null;
  onRestart: (slug: string, id: string) => void;
  restarting: Record<string, boolean>;
  onToggleYoutube: (event: any, enabled: boolean) => void;
  togglingYoutube: Record<string, boolean>;
  onPreview: (event: any) => void;
  onGoLive: (event: any) => void;
  onTerminate: (event: any) => void;
  openQrId: string | null;
  setOpenQrId: (id: string | null) => void;
  formatDisplayDate: (d: string) => string;
  getEventStatus: (d: string) => { label: string };
  adminOptimize: (url: string, w?: number) => string;
};

export function EventTableMobileCards(props: EventTableMobileCardsProps) {
  const {
    events, wishes, isLoading, isArchiveView, selectedIds, onToggleSelect,
    onEdit, onDuplicate, onArchive, onPermanentDelete, onRestore, onShareWhatsApp,
    onCopy, copiedKey, onRestart, restarting, onToggleYoutube, togglingYoutube,
    onPreview, onGoLive, onTerminate, openQrId, setOpenQrId,
    formatDisplayDate, getEventStatus, adminOptimize,
  } = props;

  if (isLoading) {
    return (
      <div className="ec-card flex flex-col items-center justify-center py-16 gap-4">
        <RefreshCw className="animate-spin" size={40} style={{ color: "var(--primary)" }} />
        <p className="font-semibold" style={{ color: "var(--foreground)" }}>Loading events…</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="ec-card text-center py-16" style={{ color: "var(--text-tertiary)" }}>
        No events found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event) => {
        const eventWishes = wishes.filter((w) => w.event_id === event.id);
        const status = getEventStatus(event.event_date);
        const title = `${event.groom_name || event.celebrant_name}${event.bride_name && event.bride_name.toLowerCase() !== "family" ? ` & ${event.bride_name}` : ""}`;
        const ingestUrl = event.restreamer_ingest_url || `rtmp://34.100.142.25/${event.slug}`;
        const liveUrl = `https://eventcast.pro/events/${event.slug}`;

        return (
          <article key={event.id} className="ec-event-mobile-card">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(event.id)}
                onChange={() => onToggleSelect(event.id)}
                className="w-4 h-4 mt-1 rounded accent-[var(--primary)] shrink-0"
                aria-label="Select event"
              />
              <div
                className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border"
                style={{ borderColor: "var(--border)", background: "var(--surface-hover)" }}
              >
                {event.thumbnail_url ? (
                  <img src={adminOptimize(event.thumbnail_url, 150)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-tertiary)" }}>
                    <AlertCircle size={24} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="ec-badge" style={{ background: "var(--info-50)", color: "var(--info)", border: "1px solid #BFDBFE", fontSize: "11px" }}>
                    {event.event_type}
                  </span>
                  {event.deployment_status === "live" && <span className="ec-badge ec-badge-live" style={{ fontSize: "11px" }}>Live</span>}
                  {event.deployment_status === "deploying" && <span className="ec-badge ec-badge-amber" style={{ fontSize: "11px" }}>Deploying</span>}
                  {eventWishes.length > 0 && (
                    <span className="ec-badge" style={{ background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0", fontSize: "11px" }}>
                      <MessageCircle size={10} /> {eventWishes.length}
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-base leading-snug" style={{ color: "var(--foreground)" }}>{title}</h3>
              </div>
            </div>

            <div className="ec-event-mobile-meta">
              <div className="flex items-center gap-2 flex-wrap">
                <Clock size={14} style={{ color: "var(--text-tertiary)" }} />
                <span className="font-semibold" style={{ color: "var(--foreground)" }}>{formatDisplayDate(event.event_date)}</span>
                {event.event_time ? <span>· {event.event_time}</span> : null}
                <span className={`ec-badge ${status.label === "Today" ? "ec-badge-live" : status.label === "Upcoming" ? "ec-badge-amber" : "ec-badge-completed"}`} style={{ fontSize: "10px" }}>
                  {status.label}
                </span>
              </div>
              {event.venue_name ? (
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-tertiary)" }} />
                  <span>{event.venue_name}</span>
                </div>
              ) : null}
              <div className="font-mono text-sm font-bold" style={{ color: "var(--foreground)" }}>
                {event.view_count || 0} visitors
              </div>
            </div>

            {(event.restreamer_url || event.youtube_stream_key) && (
              <div className="space-y-2 pt-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                <p className="ec-label mb-0">Stream</p>
                <div className="ec-event-mobile-row">
                  {event.restreamer_url ? (
                    <button type="button" onClick={() => onPreview(event)} className="ec-btn ec-btn-sm ec-btn-primary text-white">
                      Preview
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRestart(event.slug, event.id)}
                    disabled={restarting[event.id]}
                    className="ec-btn ec-btn-sm ec-btn-amber text-white"
                  >
                    {restarting[event.id] ? "Restarting…" : "Restart"}
                  </button>
                  <button type="button" onClick={() => onCopy(ingestUrl, `ingest-${event.id}`, "Ingest URL")} className="ec-btn ec-btn-sm ec-btn-secondary">
                    {copiedKey === `ingest-${event.id}` ? <CheckCircle2 size={14} /> : <CopyPlus size={14} />} Ingest
                  </button>
                  {event.youtube_stream_key ? (
                    <>
                      <button type="button" onClick={() => onToggleYoutube(event, true)} disabled={togglingYoutube[event.id]} className="ec-btn ec-btn-sm bg-red-600 text-white border-transparent">
                        Relay on
                      </button>
                      <button type="button" onClick={() => onToggleYoutube(event, false)} disabled={togglingYoutube[event.id]} className="ec-btn ec-btn-sm ec-btn-secondary">
                        Relay off
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {event.youtube_broadcast_id ? (
              <div className="ec-event-mobile-row">
                <button type="button" onClick={() => onGoLive(event)} className="ec-btn ec-btn-sm bg-red-600 text-white border-transparent">
                  Go live
                </button>
                <button type="button" onClick={() => onTerminate(event)} className="ec-btn ec-btn-sm ec-btn-secondary">
                  Terminate
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
                <ZapOff size={16} /> No YouTube relay
              </div>
            )}

            <div className="ec-event-mobile-icon-row pt-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <button type="button" onClick={() => setOpenQrId(openQrId === event.id ? null : event.id)} className="ec-icon-btn" aria-label="QR code">
                <QrCode size={18} />
              </button>
              <button type="button" onClick={() => onCopy(liveUrl, `live-${event.id}`, "Live link")} className="ec-icon-btn" aria-label="Copy link">
                {copiedKey === `live-${event.id}` ? <CheckCircle2 size={18} /> : <Copy size={18} />}
              </button>
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="ec-icon-btn" aria-label="Open event">
                <ExternalLink size={18} />
              </a>
              {!isArchiveView ? (
                <>
                  <button type="button" onClick={() => onShareWhatsApp(event)} className="ec-icon-btn" aria-label="Share on WhatsApp" style={{ color: "#16A34A" }}>
                    <MessageCircle size={18} />
                  </button>
                  <button type="button" onClick={() => onEdit(event)} className="ec-icon-btn" aria-label="Edit">
                    <Edit size={18} />
                  </button>
                  <button type="button" onClick={() => onDuplicate(event)} className="ec-icon-btn" aria-label="Duplicate">
                    <CopyPlus size={18} />
                  </button>
                  <button type="button" onClick={() => onArchive(event.id)} className="ec-icon-btn ec-icon-btn-danger" aria-label="Archive">
                    <Trash2 size={18} />
                  </button>
                </>
              ) : (
                <>
                  {onRestore ? (
                    <button type="button" onClick={() => onRestore(event.id)} className="ec-icon-btn" aria-label="Restore">
                      <RefreshCw size={18} />
                    </button>
                  ) : null}
                  <button type="button" onClick={() => onPermanentDelete(event.id)} className="ec-icon-btn ec-icon-btn-danger" aria-label="Delete">
                    <Trash2 size={18} />
                  </button>
                </>
              )}
            </div>

            {openQrId === event.id && (
              <div className="ec-card !p-4 text-center">
                <div className="flex items-center justify-between mb-3">
                  <span className="ec-label mb-0">Event QR</span>
                  <button type="button" onClick={() => setOpenQrId(null)} className="ec-icon-btn ec-icon-btn-danger" aria-label="Close QR">
                    <X size={16} />
                  </button>
                </div>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(liveUrl)}`}
                  alt="QR code"
                  className="mx-auto rounded-lg border max-w-[180px] w-full"
                  style={{ borderColor: "var(--border-subtle)" }}
                />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
