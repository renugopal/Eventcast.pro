/**
 * Client-side data helpers for the Live Control Room (Livestream + YouTube +
 * Live Control Room delivery package). Pure request wrappers only (no JSX) —
 * mirrors the existing `mediaEngagementClient.ts`/`partnerCreditClient.ts`
 * convention.
 */

export type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface LivestreamStatus {
  enabled: boolean;
  ingestId: string | null;
  playbackId: string | null;
  streamUrl: string | null;
  publishWindowStartAt: string | null;
  publishWindowEndAt: string | null;
  youtubeEnabled: boolean;
  configVersion: string | null;
  updatedAt: string | null;
}

export interface LivestreamStatusResponse {
  status: LivestreamStatus;
  youtubeWatchUrl: string | null;
}

export async function fetchLivestreamStatus(authFetch: AuthFetch, eventId: string): Promise<LivestreamStatusResponse> {
  const res = await authFetch(`/api/events/${eventId}/livestream/status`);
  return parseJsonResponse<LivestreamStatusResponse & { success: true }>(res);
}

/** One-time credentials — only ever present in the response of a successful enable call. */
export interface EnableLivestreamResult {
  streamUrl: string;
  streamKey: string;
}

export async function enableLivestream(authFetch: AuthFetch, eventId: string): Promise<EnableLivestreamResult> {
  const res = await authFetch(`/api/events/${eventId}/livestream/enable`, { method: 'POST' });
  return parseJsonResponse<EnableLivestreamResult & { success: true }>(res);
}

export async function endLivestream(authFetch: AuthFetch, eventId: string): Promise<void> {
  const res = await authFetch(`/api/events/${eventId}/livestream/end`, { method: 'POST' });
  await parseJsonResponse(res);
}

export async function updateYoutubeWatchUrl(
  authFetch: AuthFetch,
  eventId: string,
  youtubeUrl: string | null
): Promise<void> {
  const res = await authFetch(`/api/events/${eventId}/livestream/youtube`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ youtubeUrl }),
  });
  await parseJsonResponse(res);
}

/**
 * Livestream Technical Telemetry + Media Node Health Reporting — the
 * Provider-facing technical-health shape, mirroring
 * `platformOperations.ts`'s `ProviderStreamTechnicalView` field-for-field
 * as a local type rather than importing it, so nothing from that
 * server-side lib module is pulled into the client bundle. Every field
 * that has no measured value this tick is an explicit `UnavailableFact`
 * (`{ available: false; reason: string }`), never a fabricated number —
 * the component renders that reason text directly rather than guessing.
 */
export interface UnavailableFact {
  available: false;
  reason: string;
}

export interface LivestreamTechnical {
  sourceHealth: 'good' | 'no_signal';
  connected: boolean | UnavailableFact;
  videoWidth: number | UnavailableFact;
  videoHeight: number | UnavailableFact;
  videoCodec: string | UnavailableFact;
  audioCodec: string | UnavailableFact;
  audioPresent: boolean | UnavailableFact;
  fps: UnavailableFact;
  ingestKbpsRecv30s: number | UnavailableFact;
  capturedSegmentBitrateKbps: number | UnavailableFact;
  publishDurationSeconds: number | UnavailableFact;
  reconnectCount: number | UnavailableFact;
  relayStateWord: 'youtube_enabled' | 'youtube_disabled';
  sampledAt: string | null;
}

export interface LivestreamTechnicalResponse {
  technical: LivestreamTechnical;
}

export function isAvailable<T>(v: T | UnavailableFact): v is T {
  return !(typeof v === 'object' && v !== null && 'available' in v && (v as UnavailableFact).available === false);
}

export async function fetchLivestreamTelemetry(
  authFetch: AuthFetch,
  eventId: string
): Promise<LivestreamTechnicalResponse> {
  const res = await authFetch(`/api/events/${eventId}/livestream/telemetry`);
  return parseJsonResponse<LivestreamTechnicalResponse & { success: true }>(res);
}
