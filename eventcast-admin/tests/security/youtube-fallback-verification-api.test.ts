import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRequireSuperAdmin, mockRpc } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mockRpc },
  supabaseAdmin: { rpc: mockRpc },
}));

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/platform/events/event-1/youtube-fallback-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callRoute(body: unknown) {
  const { POST } = await import('@/app/api/platform/events/[eventId]/youtube-fallback-verification/route');
  return POST(makeRequest(body), { params: Promise.resolve({ eventId: 'event-1' }) });
}

describe('POST /api/platform/events/[eventId]/youtube-fallback-verification', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockReset();
    mockRpc.mockReset();
  });

  it('rejects before calling the RPC when not a super admin', async () => {
    mockRequireSuperAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await callRoute({ youtubeUrl: 'https://youtube.com/watch?v=abc' });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a non-YouTube URL before calling the RPC', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    const res = await callRoute({ youtubeUrl: 'https://evil.example.com/live' });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a missing/non-string youtubeUrl before calling the RPC', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    const res = await callRoute({});
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('never accepts a client-supplied verified flag — only youtubeUrl reaches the RPC', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({
      data: { event_id: 'event-1', youtube_fallback_url: 'https://youtube.com/watch?v=abc', youtube_fallback_verified: true },
      error: null,
    });

    await callRoute({ youtubeUrl: 'https://youtube.com/watch?v=abc', verified: true });

    expect(mockRpc).toHaveBeenCalledWith('apply_youtube_fallback_verification', {
      p_event_id: 'event-1',
      p_youtube_url: 'https://youtube.com/watch?v=abc',
      p_actor: 'super-1',
    });
  });

  it('calls the atomic verification RPC with the actor and URL, and surfaces the verified result', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({
      data: { event_id: 'event-1', youtube_fallback_url: 'https://youtube.com/watch?v=abc', youtube_fallback_verified: true },
      error: null,
    });

    const res = await callRoute({ youtubeUrl: 'https://youtube.com/watch?v=abc' });
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.youtubeFallbackVerified).toBe(true);
    expect(json.youtubeFallbackUrl).toBe('https://youtube.com/watch?v=abc');
  });

  it('surfaces RPC rejection (e.g. cross-event mismatch, non-super-admin actor, missing event) as a 409, never a partial success', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "youtube_url does not match event event-1's current provider-supplied watch link" },
    });

    const res = await callRoute({ youtubeUrl: 'https://youtube.com/watch?v=stale' });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('surfaces a database failure as a rejection, never as success', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection error' } });

    const res = await callRoute({ youtubeUrl: 'https://youtube.com/watch?v=abc' });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
