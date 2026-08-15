import { describe, expect, it, vi } from 'vitest';
import { fetchRecordingView } from '@/lib/recordingClient';

/**
 * Focused unit tests for the provider-facing recording/replay client
 * wrapper (Milestone N). Pure function, no React/DOM — calls the
 * already-implemented `GET /api/events/[eventId]/recording` route through an
 * injected fetch, mirroring the `livestreamClient`/`partnerCreditClient`
 * convention.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('fetchRecordingView', () => {
  it('calls the existing provider recording route and returns the sanitized view', async () => {
    const view = { replayStatus: 'processing' as const, retentionExpiresAt: null, youtubeFallbackAvailable: false };
    const authFetch = vi.fn().mockResolvedValue(jsonResponse({ success: true, recording: view }));

    const result = await fetchRecordingView(authFetch, 'event-1');

    expect(authFetch).toHaveBeenCalledWith('/api/events/event-1/recording');
    expect(result).toEqual(view);
  });

  it('throws on a failed response instead of returning a partial/garbage view', async () => {
    const authFetch = vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'Event not found' }, 404));
    await expect(fetchRecordingView(authFetch, 'event-1')).rejects.toThrow('Event not found');
  });
});
