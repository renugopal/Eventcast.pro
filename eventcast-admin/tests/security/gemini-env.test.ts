import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadSalesChat() {
  return (await import('@/app/api/ai/sales-chat/route')).POST;
}

function chatReq(): Request {
  return new Request('http://test.local/api/ai/sales-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.GEMINI_API_KEY;
  delete process.env.NEXT_PUBLIC_GEMINI_API_KEY;
});

describe('Gemini key is server-only (GEMINI_API_KEY)', () => {
  it('returns a clean 500 when GEMINI_API_KEY is unset, and ignores NEXT_PUBLIC_GEMINI_API_KEY', async () => {
    // Only the (now-removed) public var is present — the route must NOT read it.
    process.env.NEXT_PUBLIC_GEMINI_API_KEY = 'should-be-ignored';
    const POST = await loadSalesChat();
    const res = await POST(chatReq());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/API Key/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
