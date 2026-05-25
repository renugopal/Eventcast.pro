'use client';

import { useState, useEffect, useCallback } from 'react';
import { Camera, Loader2, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface GuestPhoto {
  id: string;
  photo_url: string;
  uploader_name: string;
  file_size_bytes: number | null;
  approved: boolean;
  created_at: string;
}

interface EventOption {
  id: string;
  slug: string;
  groom_name: string | null;
  bride_name: string | null;
  celebrant_name: string | null;
  event_type: string | null;
  event_date: string | null;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function getEventLabel(e: EventOption): string {
  if (e.groom_name && e.bride_name) return `${e.groom_name} & ${e.bride_name} — ${e.event_type ?? ''}`;
  return `${e.celebrant_name ?? 'Event'} — ${e.event_type ?? ''}`;
}

export default function GuestPhotoModeration() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [photos, setPhotos] = useState<GuestPhoto[]>([]);
  const [photoLimit, setPhotoLimit] = useState<number>(50);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GuestPhoto | null>(null);

  useEffect(() => {
    const loadEvents = async () => {
      const { data } = await supabase
        .from('events')
        .select('id, slug, groom_name, bride_name, celebrant_name, event_type, event_date')
        .is('archived_at', null)
        .order('event_date', { ascending: false });
      if (data) setEvents(data);
    };
    loadEvents();
  }, []);

  const loadPhotos = useCallback(async (eventId: string) => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    setPhotos([]);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`/api/guest-photos/list?event_id=${eventId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      if (!json.success) throw new Error(json.error);
      setPhotos(json.photos);
      setPhotoLimit(json.limit);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedEventId) loadPhotos(selectedEventId);
  }, [selectedEventId, loadPhotos]);

  const handleDelete = async (photo: GuestPhoto) => {
    setConfirmDelete(null);
    setDeleting(photo.id);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch('/api/guest-photos/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ photo_id: photo.id }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const usedCount = photos.length;
  const capacityPct = Math.min(100, (usedCount / photoLimit) * 100);

  return (
    <div className="w-full space-y-8 ec-animate-in">
      <div className="ec-section-header" style={{ marginBottom: 0 }}>
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--error-50)', color: 'var(--error)', border: '2px solid #FECDD3' }}
          >
            <Camera size={22} />
          </div>
          <div>
            <h2 className="ec-page-title" style={{ fontSize: '24px' }}>Guest Photo Wall</h2>
            <p className="ec-section-sub">View and moderate guest-uploaded photos for your events</p>
          </div>
        </div>
      </div>

      <div className="ec-card">
        <label className="ec-label" htmlFor="guest-wall-event">Select event</label>
        <select
          id="guest-wall-event"
          value={selectedEventId}
          onChange={(e) => setSelectedEventId(e.target.value)}
          className="ec-input"
          style={{ cursor: 'pointer' }}
        >
          <option value="">— Choose an event —</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>{getEventLabel(ev)}</option>
          ))}
        </select>
      </div>

      {!selectedEventId && (
        <div className="ec-card text-center" style={{ padding: '48px 24px' }}>
          <Camera size={48} className="mx-auto mb-4 opacity-30" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an event to view guest photos</p>
        </div>
      )}

      {selectedEventId && !loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Photos', value: `${usedCount} / ${photoLimit}` },
            { label: 'Storage used', value: formatBytes(photos.reduce((s, p) => s + (p.file_size_bytes ?? 0), 0)) },
            { label: 'Slots remaining', value: `${Math.max(0, photoLimit - usedCount)}` },
          ].map((stat) => (
            <div key={stat.label} className="ec-card ec-card-sm">
              <p className="ec-label" style={{ marginBottom: '8px' }}>{stat.label}</p>
              <p className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>{stat.value}</p>
            </div>
          ))}
          <div className="ec-card ec-card-sm lg:col-span-1 sm:col-span-2">
            <p className="ec-label" style={{ marginBottom: '10px' }}>Photo wall capacity</p>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${capacityPct}%`,
                  background: usedCount >= photoLimit
                    ? 'var(--error)'
                    : 'linear-gradient(90deg, var(--success), #34D399)',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="ec-card flex flex-col items-center justify-center gap-4" style={{ padding: '48px' }}>
          <Loader2 className="animate-spin" size={36} style={{ color: 'var(--primary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Loading photos…</p>
        </div>
      )}

      {error && (
        <div
          className="ec-card"
          style={{ background: 'var(--error-50)', borderColor: '#FECDD3', color: 'var(--error)' }}
        >
          {error}
        </div>
      )}

      {selectedEventId && !loading && photos.length === 0 && !error && (
        <div className="ec-card text-center" style={{ padding: '48px 24px' }}>
          <p style={{ color: 'var(--text-secondary)' }}>No guest photos yet for this event</p>
        </div>
      )}

      {photos.length > 0 && (
        <div className="ec-photo-grid grid gap-4">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="ec-card overflow-hidden"
              style={{ padding: 0 }}
            >
              <button
                type="button"
                className="w-full aspect-square overflow-hidden block cursor-zoom-in border-0 p-0"
                onClick={() => setLightbox(photo.photo_url)}
              >
                <img
                  src={photo.photo_url}
                  alt={`Photo by ${photo.uploader_name}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
              <div style={{ padding: '14px 16px 16px' }}>
                <p className="font-semibold truncate" style={{ color: 'var(--foreground)' }}>
                  {photo.uploader_name}
                </p>
                <p className="text-sm mt-1 mb-3" style={{ color: 'var(--text-tertiary)' }}>
                  {formatTime(photo.created_at)} · {formatBytes(photo.file_size_bytes)}
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(photo)}
                  disabled={deleting === photo.id}
                  className="ec-btn ec-btn-danger w-full ec-btn-sm"
                >
                  <Trash2 size={16} />
                  {deleting === photo.id ? 'Deleting…' : 'Delete photo'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.9)' }}
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal
        >
          <img
            src={lightbox}
            alt="Photo preview"
            className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="ec-icon-btn absolute top-5 right-6"
            style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)' }}
            aria-label="Close preview"
          >
            <X size={20} />
          </button>
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          <div className="ec-card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--foreground)' }}>Delete photo?</h3>
            <p className="mb-6" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              This permanently removes the photo by{' '}
              <strong style={{ color: 'var(--foreground)' }}>{confirmDelete.uploader_name}</strong>{' '}
              from storage and the event wall.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmDelete(null)} className="ec-btn ec-btn-secondary flex-1">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDelete)}
                className="ec-btn ec-btn-danger flex-1"
              >
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
