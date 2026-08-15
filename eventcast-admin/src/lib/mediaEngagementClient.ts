/**
 * Client-side data helpers for the Media + Engagement Core delivery
 * package: event Media tab (Invitation Video, Photo Slideshow), Guest
 * Memories moderation, and Wishes moderation. Pure request wrappers only
 * (no JSX) — mirrors the existing `partnerCreditClient.ts` convention. Each
 * function takes the caller's `authFetch` so it stays testable without a
 * real session.
 */

export type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

// ─── Event Media (Invitation Video + Photo Slideshow) ───────────────────────

export interface EventMediaState {
  invitationVideoUrl: string | null;
  slideshowImages: string[];
}

export async function fetchEventMedia(authFetch: AuthFetch, eventId: string): Promise<EventMediaState> {
  const res = await authFetch(`/api/events/${eventId}/media`);
  return parseJsonResponse<EventMediaState & { success: true }>(res);
}

export async function updateEventMedia(
  authFetch: AuthFetch,
  eventId: string,
  updates: { invitationVideoUrl?: string | null; slideshowImages?: string[] }
): Promise<void> {
  const res = await authFetch(`/api/events/${eventId}/media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  await parseJsonResponse(res);
}

// ─── Guest Memories ──────────────────────────────────────────────────────────

export interface GuestMemoryRecord {
  id: string;
  photo_url: string;
  uploader_name: string;
  approved: boolean;
  created_at: string;
}

export async function fetchGuestMemories(authFetch: AuthFetch, eventId: string): Promise<GuestMemoryRecord[]> {
  const res = await authFetch(`/api/events/${eventId}/guest-memories`);
  const data = await parseJsonResponse<{ guestMemories: GuestMemoryRecord[] }>(res);
  return data.guestMemories;
}

export async function fetchGuestMemoriesSettings(
  authFetch: AuthFetch,
  eventId: string
): Promise<{ manualApprovalEnabled: boolean }> {
  const res = await authFetch(`/api/events/${eventId}/guest-memories/settings`);
  return parseJsonResponse(res);
}

export async function updateGuestMemoriesSettings(
  authFetch: AuthFetch,
  eventId: string,
  manualApprovalEnabled: boolean
): Promise<void> {
  const res = await authFetch(`/api/events/${eventId}/guest-memories/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manualApprovalEnabled }),
  });
  await parseJsonResponse(res);
}

export async function setGuestMemoryApproved(
  authFetch: AuthFetch,
  eventId: string,
  photoId: string,
  approved: boolean
): Promise<void> {
  const res = await authFetch(`/api/events/${eventId}/guest-memories/${photoId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved }),
  });
  await parseJsonResponse(res);
}

export async function deleteGuestMemory(authFetch: AuthFetch, eventId: string, photoId: string): Promise<void> {
  const res = await authFetch(`/api/events/${eventId}/guest-memories/${photoId}`, { method: 'DELETE' });
  await parseJsonResponse(res);
}

// ─── Wishes ──────────────────────────────────────────────────────────────────

export type WishStatus = 'approved' | 'hidden' | 'rejected';

export interface WishRecord {
  id: string;
  name: string;
  message: string;
  status: WishStatus;
  is_pinned: boolean;
  created_at: string;
}

export async function fetchWishes(authFetch: AuthFetch, eventId: string): Promise<WishRecord[]> {
  const res = await authFetch(`/api/events/${eventId}/wishes`);
  const data = await parseJsonResponse<{ wishes: WishRecord[] }>(res);
  return data.wishes;
}

export async function updateWish(
  authFetch: AuthFetch,
  eventId: string,
  wishId: string,
  updates: { status?: WishStatus; isPinned?: boolean }
): Promise<void> {
  const res = await authFetch(`/api/events/${eventId}/wishes/${wishId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  await parseJsonResponse(res);
}

export async function deleteWish(authFetch: AuthFetch, eventId: string, wishId: string): Promise<void> {
  const res = await authFetch(`/api/events/${eventId}/wishes/${wishId}`, { method: 'DELETE' });
  await parseJsonResponse(res);
}

// ─── Global Media Library ────────────────────────────────────────────────────

export interface MediaLibraryItem {
  eventId: string;
  eventName: string;
  slug: string | null;
  pageState: string | null;
  thumbnailUrl: string | null;
  hasInvitationVideo: boolean;
  slideshowImageCount: number;
}

export interface MediaLibraryTotals {
  eventsWithThumbnail: number;
  eventsWithInvitationVideo: number;
  totalSlideshowImages: number;
  recordingsAvailable: boolean;
}

export async function fetchMediaLibrary(
  authFetch: AuthFetch
): Promise<{ items: MediaLibraryItem[]; totals: MediaLibraryTotals }> {
  const res = await authFetch('/api/media');
  return parseJsonResponse(res);
}
