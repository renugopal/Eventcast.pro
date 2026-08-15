import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFromMock, type MockQueryBuilder } from './support/mocks';

const { mockDb } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadHelper() {
  const mod = await import('@/lib/notifications');
  return mod.createNotification;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('createNotification', () => {
  it('inserts a real notification row with the given fields', async () => {
    mockDb.from = createFromMock({ notifications: [{ data: { id: 'notif-1' }, error: null }] });
    const createNotification = await loadHelper();

    const result = await createNotification({
      studioId: 'studio-a',
      notificationType: 'support_reply',
      title: 'New reply on your ticket',
      body: 'We replied to your support ticket.',
    });

    expect(result).toEqual({ created: true, id: 'notif-1' });
    const call = mockDb.from.mock.results[0].value;
    expect(call.insert).toHaveBeenCalledWith({
      studio_id: 'studio-a',
      event_id: null,
      severity: 'info',
      notification_type: 'support_reply',
      title: 'New reply on your ticket',
      body: 'We replied to your support ticket.',
      dedup_key: null,
    });
  });

  it('returns created: false, without throwing, on a dedup unique-violation', async () => {
    mockDb.from = createFromMock({
      notifications: [{ data: null, error: { message: 'duplicate key value', code: '23505' } }],
    });
    const createNotification = await loadHelper();

    const result = await createNotification({
      studioId: 'studio-a',
      notificationType: 'stream_disconnect',
      title: 'Stream disconnected',
      dedupKey: 'stream_disconnect:event-1:2026081200',
    });

    expect(result).toEqual({ created: false, id: null });
  });

  it('throws on a real, non-dedup database error', async () => {
    mockDb.from = createFromMock({
      notifications: [{ data: null, error: { message: 'connection refused', code: '08000' } }],
    });
    const createNotification = await loadHelper();

    await expect(
      createNotification({ studioId: 'studio-a', notificationType: 'x', title: 'x' })
    ).rejects.toThrow('Failed to create notification');
  });
});
