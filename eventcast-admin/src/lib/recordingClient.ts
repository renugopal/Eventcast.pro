/**
 * Client-side data helper for the provider-facing recording/replay view
 * (Milestone N — B2 playback delivery, replay expiry, verified YouTube
 * fallback). Pure request wrapper only (no JSX) — mirrors the existing
 * `livestreamClient.ts` convention. Calls the already-implemented
 * `GET /api/events/[eventId]/recording` route; no parallel recording logic.
 */

import type { AuthFetch } from './livestreamClient';

export interface ProviderRecordingView {
  replayStatus: 'not_available' | 'processing' | 'available' | 'failed';
  retentionExpiresAt: string | null;
  youtubeFallbackAvailable: boolean;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchRecordingView(authFetch: AuthFetch, eventId: string): Promise<ProviderRecordingView> {
  const res = await authFetch(`/api/events/${eventId}/recording`);
  const data = await parseJsonResponse<{ recording: ProviderRecordingView; success: true }>(res);
  return data.recording;
}
