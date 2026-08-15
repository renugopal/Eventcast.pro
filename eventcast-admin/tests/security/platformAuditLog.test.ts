import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockInsert, mockFrom } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn(() => ({ insert: mockInsert }));
  return { mockInsert, mockFrom };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom },
}));

describe('writeAuditLog', () => {
  beforeEach(() => {
    mockInsert.mockClear();
    mockFrom.mockClear();
  });

  it('inserts only the allowlisted, minimal set of fields for a known action', async () => {
    const { writeAuditLog } = await import('@/lib/platformAudit');

    const result = await writeAuditLog({
      action: 'platform_console_note',
      actorUserId: 'user-1',
      targetType: 'studio',
      targetId: 'studio-1',
      reason: 'test note',
      before: {},
      after: {},
    });

    expect(result.error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('platform_audit_log');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'user-1',
        actor_platform_role: 'super_admin',
        action: 'platform_console_note',
        target_type: 'studio',
        target_id: 'studio-1',
        reason: 'test note',
      })
    );
    const insertedRow = mockInsert.mock.calls[0][0];
    // No arbitrary/unexpected keys beyond the known allowlisted shape.
    expect(Object.keys(insertedRow).sort()).toEqual(
      [
        'action',
        'actor_platform_role',
        'actor_user_id',
        'after_state',
        'before_state',
        'reason',
        'target_id',
        'target_type',
      ].sort()
    );
  });

  it('surfaces a database error rather than reporting success', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'db unavailable' } });
    const { writeAuditLog } = await import('@/lib/platformAudit');

    const result = await writeAuditLog({
      action: 'platform_console_note',
      actorUserId: 'user-1',
      targetType: 'studio',
      targetId: 'studio-1',
      before: {},
      after: {},
    });

    expect(result.error).toBe('db unavailable');
  });
});
