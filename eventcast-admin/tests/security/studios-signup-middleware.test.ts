import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

async function loadMiddleware() {
  const mod = await import('@/middleware');
  return mod.middleware;
}

describe('Middleware — anonymous studio signup bypass', () => {
  it('allows an unauthenticated POST to /api/studios/signup through to the route', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest('http://test.local/api/studios/signup', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('still requires a session token for another studio API route', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest('http://test.local/api/events/draft', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });
});
