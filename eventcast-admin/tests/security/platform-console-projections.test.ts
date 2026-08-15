import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Browser-facing Platform Console responses must contain only sanitized
 * operational data.
 *
 * These routes read with the service-role client, so the raw rows behind them
 * include stream secret hashes, YouTube secret references, node credentials
 * and phone numbers. Each test below seeds those secret-bearing values into
 * the mocked rows and then asserts they are absent from the serialized
 * response — proving the projections are allowlists, not row spreads.
 */

const { mockRequireSuperAdmin, tableResults, mockFrom, mockRpc } = vi.hoisted(() => {
  const tableResults = new Map<string, { data: unknown; error: unknown; count?: number }>();

  function makeBuilder(table: string) {
    const result = () => tableResults.get(table) ?? { data: [], error: null, count: 0 };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'order', 'range', 'limit', 'update', 'insert']) {
      builder[method] = () => builder;
    }
    for (const method of ['maybeSingle', 'single']) {
      builder[method] = () => {
        const value = result();
        const data = Array.isArray(value.data) ? (value.data[0] ?? null) : value.data;
        return Promise.resolve({ ...value, data });
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  }

  return {
    tableResults,
    mockRequireSuperAdmin: vi.fn(),
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
  };
});

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

function seed(table: string, data: unknown, count?: number) {
  tableResults.set(table, { data, error: null, count });
}

/** Secret-bearing values seeded into mocked rows; none may ever reach a response. */
const SECRETS = {
  streamSecretHash: 'aaaaaaaabbbbbbbbccccccccdddddddd',
  youtubeSecretReference: 'yt-secret-ref-9f2c',
  nodeTokenHash: 'node-token-hash-77b1',
  mobileNumber: '+919876543210',
  serviceRoleKey: 'service-role-key-should-never-appear',
};

function expectNoSecrets(serialized: string) {
  for (const secret of Object.values(SECRETS)) {
    expect(serialized).not.toContain(secret);
  }
}

describe('Platform Console response projections', () => {
  beforeEach(() => {
    tableResults.clear();
    mockFrom.mockClear();
    mockRpc.mockReset();
    mockRequireSuperAdmin.mockReset();
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
  });

  it('GET /api/platform/studios returns account facts without contact PII', async () => {
    seed('studios', [
      {
        id: 'studio-1',
        slug: 'acme',
        display_name: 'Acme Studio',
        plan_tier: 'free_trial',
        owner_user_id: 'user-1',
        created_at: '2026-01-01T00:00:00.000Z',
        mobile_number: SECRETS.mobileNumber,
      },
    ]);
    seed('studio_members', [{ studio_id: 'studio-1', user_id: 'user-1', role: 'owner' }]);
    seed('events', [{ studio_id: 'studio-1', page_state: 'draft', archived_at: null, scheduled_start_at: null }]);
    seed('studio_retention_overrides', [{ studio_id: 'studio-1', retention_days: 120 }]);

    const { GET } = await import('@/app/api/platform/studios/route');
    const json = await (await GET(new Request('http://t.local/api/platform/studios'))).json();

    expect(json.success).toBe(true);
    expect(json.studios[0]).toMatchObject({ memberCount: 1, eventCount: 1, retentionOverrideDays: 120 });
    expectNoSecrets(JSON.stringify(json));
    // Suspension/entitlement controls are honestly reported as unavailable,
    // never rendered as a working-looking capability.
    expect(json.accountControls.available).toBe(false);
  });

  it('GET /api/platform/security surfaces the platform role roster without the phone number itself', async () => {
    seed('platform_users', [
      {
        user_id: 'user-1',
        platform_role: 'super_admin',
        mobile_verified: true,
        mobile_number: SECRETS.mobileNumber,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    seed('platform_audit_log', [
      { action: 'retention_extended', actor_user_id: 'user-1', created_at: '2026-07-01T00:00:00.000Z' },
    ]);

    const { GET } = await import('@/app/api/platform/security/route');
    const json = await (await GET(new Request('http://t.local/api/platform/security'))).json();

    expect(json.platformUsers[0]).toEqual({
      userId: 'user-1',
      platformRole: 'super_admin',
      mobileVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expectNoSecrets(JSON.stringify(json));
    expect(json.sessionControls.available).toBe(false);
  });

  it('GET /api/platform/nodes never exposes node credentials and never invents resource telemetry', async () => {
    seed('media_nodes', [
      {
        id: 'node-1',
        name: 'gcp-asia-south1-01',
        region: 'asia-south1',
        ingest_hostname: 'ingest-1.eventcast.pro',
        status: 'healthy',
        maintenance_mode: false,
        hard_stream_limit: 10,
        active_stream_count: 2,
        disk_free_bytes: 100,
        r2_queue_bytes: 5,
        last_heartbeat_at: null,
        software_version: 'v1.0.9',
        config_version: 'cfg-1',
        updated_at: '2026-07-01T00:00:00.000Z',
        token_hash: SECRETS.nodeTokenHash,
      },
    ]);
    seed('media_event_assignments', [{ assigned_media_node_id: 'node-1', enabled: true }]);

    const { GET } = await import('@/app/api/platform/nodes/route');
    const json = await (await GET(new Request('http://t.local/api/platform/nodes'))).json();

    expect(json.nodes[0].enabledAssignmentCount).toBe(1);
    expect(json.nodes[0].resourceTelemetry.available).toBe(false);
    expect(json.nodes[0].heartbeatAgeMinutes).toBeNull();
    expectNoSecrets(JSON.stringify(json));
  });

  it('GET /api/platform/events/[eventId] excludes assignment secrets and never claims live status', async () => {
    seed('events', [
      {
        id: 'event-1',
        slug: 'anaya-rohan',
        studio_id: 'studio-1',
        page_state: 'published',
        event_visibility: 'public',
        scheduled_start_at: '2026-09-01T10:00:00.000Z',
        archived_at: null,
        template_id: 'wedding-template-01',
        youtube_url: 'https://www.youtube.com/watch?v=abc12345678',
        created_at: '2026-01-01T00:00:00.000Z',
        studios: { slug: 'acme', display_name: 'Acme Studio' },
      },
    ]);
    seed('media_event_assignments', [
      {
        assigned_media_node_id: 'node-1',
        ingest_id: 'ingest-1',
        playback_id: 'pb-1',
        enabled: true,
        publish_window_start_at: null,
        publish_window_end_at: null,
        youtube_enabled: false,
        config_version: 3,
        updated_at: '2026-07-01T00:00:00.000Z',
        stream_secret_hash: SECRETS.streamSecretHash,
        youtube_secret_reference: SECRETS.youtubeSecretReference,
      },
    ]);
    seed('media_event_assignment_activations', [
      { media_node_id: 'node-1', ingest_id: 'ingest-1', playback_id: 'pb-1', activated_at: '2026-07-01T00:00:00.000Z' },
    ]);
    seed('support_tickets', []);
    seed('notifications', []);
    seed('event_recordings', null);

    const { GET } = await import('@/app/api/platform/events/[eventId]/route');
    const json = await (
      await GET(new Request('http://t.local/api/platform/events/event-1'), {
        params: Promise.resolve({ eventId: 'event-1' }),
      })
    ).json();

    expect(json.success).toBe(true);
    expect(json.assignment.ingestPresent).toBe(true);
    expect(json.assignment.playbackPresent).toBe(true);
    expect(json.assignment.liveStatus.available).toBe(false);
    expect(json.assignment.technicalStreamMetrics.available).toBe(false);
    // Enabled is reported as enabled, never promoted into an "active" claim.
    expect(JSON.stringify(json).toLowerCase()).not.toContain('"live":true');
    expectNoSecrets(JSON.stringify(json));
  });

  it('GET /api/platform/media-operations reports the existing cleanup verdict and counts Guest Memories without reading content', async () => {
    seed('event_recordings', [
      {
        id: 'rec-1',
        event_id: 'event-1',
        recording_state: 'b2_finalized',
        local_finalized_at: '2026-06-01T00:00:00.000Z',
        b2_object_key: 'events/event-1/vod/gen-1.m3u8',
        b2_bucket: 'eventcast-vod',
        b2_finalized_at: '2026-06-01T01:00:00.000Z',
        integrity_verified_at: '2026-06-01T02:00:00.000Z',
        finalization_failure_reason: null,
        finalization_generation: 'gen-1',
        gap_count: 0,
        gap_status: 'none',
        youtube_fallback_url: null,
        youtube_fallback_verified: false,
        retention_effective_days: 90,
        retention_frozen_at: '2026-06-01T02:00:00.000Z',
        retention_expires_at: '2026-08-30T02:00:00.000Z',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T02:00:00.000Z',
        events: { slug: 'anaya-rohan', studio_id: 'studio-1' },
      },
    ]);
    seed('guest_photos', [
      { event_id: 'event-1', approved: true, photo_url: 'https://cdn.example/secret-guest-photo.jpg' },
      { event_id: 'event-1', approved: false, photo_url: 'https://cdn.example/secret-guest-photo-2.jpg' },
    ]);

    const { GET } = await import('@/app/api/platform/media-operations/route');
    const json = await (await GET(new Request('http://t.local/api/platform/media-operations'))).json();

    expect(json.recordings[0]).toMatchObject({
      eventId: 'event-1',
      r2CleanupEligible: true,
      guestMemoryCount: 2,
      guestMemoryPendingCount: 1,
    });
    // Counted, never browsed.
    expect(JSON.stringify(json)).not.toContain('secret-guest-photo');
  });

  it('GET /api/platform/notifications omits bodies and never claims outbound delivery', async () => {
    seed('notifications', [
      {
        id: 'notif-1',
        studio_id: 'studio-1',
        event_id: 'event-1',
        severity: 'critical',
        notification_type: 'stream_disconnect',
        title: 'Stream disconnected',
        body: 'private notification body detail',
        dedup_key: 'stream_disconnect:event-1:12',
        read_at: null,
        created_at: '2026-07-01T00:00:00.000Z',
        studios: { slug: 'acme' },
      },
    ]);

    const { GET } = await import('@/app/api/platform/notifications/route');
    const json = await (await GET(new Request('http://t.local/api/platform/notifications'))).json();

    expect(json.notifications[0].deduplicated).toBe(true);
    expect(JSON.stringify(json)).not.toContain('private notification body detail');
    expect(json.outboundDelivery.available).toBe(false);
    expect(json.outboundDelivery.reason).toMatch(/WhatsApp, SMS, or application-email/);
  });

  it('GET /api/platform/support returns ticket metadata only — never a message body', async () => {
    seed('support_tickets', [
      {
        id: 'ticket-1',
        studio_id: 'studio-1',
        event_id: null,
        subject: 'Stream keeps dropping',
        category: 'urgent_live',
        status: 'open',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        closed_at: null,
        studios: { slug: 'acme' },
      },
    ]);
    seed('support_ticket_messages', [{ ticket_id: 'ticket-1' }, { ticket_id: 'ticket-1' }]);

    const { GET } = await import('@/app/api/platform/support/route');
    const json = await (await GET(new Request('http://t.local/api/platform/support'))).json();

    expect(json.tickets[0].messageCount).toBe(2);
    expect(json.tickets[0]).not.toHaveProperty('body');
    expect(json.contentAccessPolicy).toMatch(/audit log/);
  });

  it('GET /api/platform/storage reports unmeasured object bytes rather than zero', async () => {
    seed('guest_photos', [{ file_size_bytes: 1000 }, { file_size_bytes: null }]);
    seed('event_recordings', []);
    seed('media_nodes', [{ disk_free_bytes: null, r2_queue_bytes: null }]);

    const { GET } = await import('@/app/api/platform/storage/route');
    const json = await (await GET(new Request('http://t.local/api/platform/storage'))).json();

    expect(json.storage.guestPhotoBytes).toBe(1000);
    expect(json.storage.guestPhotoRowsWithoutSize).toBe(1);
    expect(json.storage.nodeDiskFreeBytes).toBeNull();
    expect(json.storage.r2MediaObjectBytes.available).toBe(false);
    expect(json.storage.b2ArchiveObjectBytes.available).toBe(false);
  });

  it('GET /api/platform/templates reports real usage and offers no write path', async () => {
    seed('events', [{ template_id: 'wedding-template-01' }, { template_id: 'unregistered-template' }]);

    const { GET } = await import('@/app/api/platform/templates/route');
    const json = await (await GET(new Request('http://t.local/api/platform/templates'))).json();

    const unregistered = json.templates.find((t: { templateId: string }) => t.templateId === 'unregistered-template');
    expect(unregistered.registered).toBe(false);
    expect(json.mutation.available).toBe(false);
  });

  it('GET /api/platform/overview leaves the active stream count null with its reason', async () => {
    seed('studios', [], 4);
    seed('events', [{ page_state: 'published', archived_at: null, scheduled_start_at: null }]);
    seed('media_event_assignments', [], 2);
    seed('media_nodes', [{ status: 'healthy', maintenance_mode: false, last_heartbeat_at: null }]);
    seed('event_recordings', []);
    seed('support_tickets', [{ status: 'open', category: 'urgent_live' }]);
    seed('notifications', [{ severity: 'critical', read_at: null }]);

    const { GET } = await import('@/app/api/platform/overview/route');
    const json = await (await GET(new Request('http://t.local/api/platform/overview'))).json();

    expect(json.overview.activeStreamCount).toBeNull();
    expect(json.overview.activeStreamCountUnavailableReason).toMatch(/not that it is currently ingesting/);
    expect(json.overview.support.urgentLiveOpen).toBe(1);
    expect(json.overview.nodes.neverReportedHeartbeat).toBe(1);
  });
});
