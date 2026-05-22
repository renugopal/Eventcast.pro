'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [events, setEvents]         = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [photos, setPhotos]         = useState<GuestPhoto[]>([]);
  const [photoLimit, setPhotoLimit] = useState<number>(50);
  const [loading, setLoading]       = useState(false);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [lightbox, setLightbox]     = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GuestPhoto | null>(null);

  // Load events list on mount
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

  // Load photos when event selected
  const loadPhotos = useCallback(async (eventId: string) => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    setPhotos([]);

    try {
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;

      const res = await fetch(`/api/guest-photos/list?event_id=${eventId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      if (!json.success) throw new Error(json.error);
      setPhotos(json.photos);
      setPhotoLimit(json.limit);
    } catch (err: any) {
      setError(err.message);
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
      const token   = session.data.session?.access_token;

      const res = await fetch('/api/guest-photos/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({ photo_id: photo.id }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setPhotos(prev => prev.filter(p => p.id !== photo.id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const totalBytes = photos.reduce((sum, p) => sum + (p.file_size_bytes ?? 0), 0);
  const usedCount  = photos.length;

  return (
    <div style={{ padding: '24px', fontFamily: 'var(--font-geist, Inter, sans-serif)' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{
          fontSize: '1.5rem', fontWeight: 700, color: '#fff',
          display: 'flex', alignItems: 'center', gap: '10px', margin: 0
        }}>
          <span style={{ fontSize: '1.4rem' }}>📸</span> Guest Photo Wall
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.5)', margin: '6px 0 0', fontSize: '0.85rem' }}>
          View and moderate guest-uploaded photos for your events
        </p>
      </div>

      {/* Event Selector */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '14px',
        padding: '20px',
        marginBottom: '24px',
        backdropFilter: 'blur(12px)',
      }}>
        <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', display: 'block', marginBottom: '8px' }}>
          SELECT EVENT
        </label>
        <select
          value={selectedEventId}
          onChange={e => setSelectedEventId(e.target.value)}
          style={{
            width: '100%',
            background: 'rgba(0,0,0,0.4)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '10px',
            padding: '10px 14px',
            fontSize: '0.9rem',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">— Choose an event —</option>
          {events.map(ev => (
            <option key={ev.id} value={ev.id}>{getEventLabel(ev)}</option>
          ))}
        </select>
      </div>

      {/* No event selected */}
      {!selectedEventId && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          color: 'rgba(255,255,255,0.3)', fontSize: '0.9rem'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📷</div>
          Select an event to view guest photos
        </div>
      )}

      {/* Stats Bar */}
      {selectedEventId && !loading && (
        <div style={{
          display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap'
        }}>
          {[
            { label: 'Photos', value: `${usedCount} / ${photoLimit}` },
            { label: 'Storage Used', value: formatBytes(totalBytes) },
            { label: 'Slots Remaining', value: `${Math.max(0, photoLimit - usedCount)}` },
          ].map(stat => (
            <div key={stat.label} style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              padding: '14px 20px',
              backdropFilter: 'blur(12px)',
              flex: '1 1 140px',
            }}>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem', marginBottom: '4px' }}>
                {stat.label.toUpperCase()}
              </div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: '1.1rem' }}>
                {stat.value}
              </div>
            </div>
          ))}

          {/* Progress bar */}
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            padding: '14px 20px',
            backdropFilter: 'blur(12px)',
            flex: '1 1 260px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem', marginBottom: '8px' }}>
              PHOTO WALL CAPACITY
            </div>
            <div style={{
              height: '6px', borderRadius: '99px',
              background: 'rgba(255,255,255,0.1)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                borderRadius: '99px',
                width: `${Math.min(100, (usedCount / photoLimit) * 100)}%`,
                background: usedCount >= photoLimit
                  ? 'linear-gradient(90deg,#ef4444,#dc2626)'
                  : 'linear-gradient(90deg,#10b981,#34d399)',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px', color: 'rgba(255,255,255,0.4)' }}>
          <div style={{
            width: '36px', height: '36px', margin: '0 auto 16px',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#10b981', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          Loading photos...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '12px', padding: '16px 20px', color: '#fca5a5',
          marginBottom: '20px', fontSize: '0.85rem'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Empty state */}
      {selectedEventId && !loading && photos.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          color: 'rgba(255,255,255,0.3)', fontSize: '0.9rem'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🖼️</div>
          No guest photos yet for this event
        </div>
      )}

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '14px',
        }}>
          {photos.map(photo => (
            <div
              key={photo.id}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '14px',
                overflow: 'hidden',
                backdropFilter: 'blur(12px)',
                position: 'relative',
                transition: 'transform 0.2s, border-color 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.18)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
              }}
            >
              {/* Photo Thumbnail */}
              <div
                style={{ aspectRatio: '1', overflow: 'hidden', cursor: 'zoom-in', position: 'relative' }}
                onClick={() => setLightbox(photo.photo_url)}
              >
                <img
                  src={photo.photo_url}
                  alt={`Photo by ${photo.uploader_name}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                />
              </div>

              {/* Info */}
              <div style={{ padding: '10px 12px 12px' }}>
                <div style={{
                  color: '#fff', fontWeight: 600, fontSize: '0.82rem',
                  marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}>
                  {photo.uploader_name}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem', marginBottom: '10px' }}>
                  {formatTime(photo.created_at)} · {formatBytes(photo.file_size_bytes)}
                </div>

                {/* Delete button */}
                <button
                  id={`delete-photo-${photo.id}`}
                  onClick={() => setConfirmDelete(photo)}
                  disabled={deleting === photo.id}
                  style={{
                    width: '100%',
                    padding: '7px',
                    background: deleting === photo.id
                      ? 'rgba(239,68,68,0.2)'
                      : 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: '8px',
                    color: '#fca5a5',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: deleting === photo.id ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => {
                    if (deleting !== photo.id) {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.25)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (deleting !== photo.id) {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)';
                    }
                  }}
                >
                  {deleting === photo.id ? (
                    '⏳ Deleting...'
                  ) : (
                    '🗑️ Delete'
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <img
            src={lightbox}
            alt="Photo preview"
            style={{
              maxWidth: '90vw', maxHeight: '90vh',
              borderRadius: '12px', boxShadow: '0 0 60px rgba(0,0,0,0.8)',
            }}
          />
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: 'absolute', top: '20px', right: '24px',
              background: 'rgba(255,255,255,0.1)', border: 'none',
              color: '#fff', fontSize: '1.2rem', padding: '8px 14px',
              borderRadius: '10px', cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      {confirmDelete && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'rgba(15,15,20,0.98)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '18px', padding: '28px',
            maxWidth: '380px', width: '90%',
            boxShadow: '0 0 60px rgba(239,68,68,0.15)',
          }}>
            <h3 style={{ color: '#fff', margin: '0 0 10px', fontSize: '1.1rem' }}>Delete Photo?</h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', margin: '0 0 20px', lineHeight: 1.5 }}>
              This will permanently remove the photo by <strong style={{ color: '#fff' }}>{confirmDelete.uploader_name}</strong> from both storage and the event wall. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  flex: 1, padding: '10px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '10px', color: '#fff',
                  fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                style={{
                  flex: 1, padding: '10px',
                  background: 'rgba(239,68,68,0.8)',
                  border: '1px solid rgba(239,68,68,0.6)',
                  borderRadius: '10px', color: '#fff',
                  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS animation for spinner */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
