import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { deriveEventLifecycleStatus } from '@/lib/eventLifecycle';
import type { EventRecordingRow } from '@/lib/eventRecording';
import { isR2CleanupEligible } from '@/lib/r2CleanupEligibility';
import { NO_LIVE_TELEMETRY_REASON } from '@/lib/platformOperations';

/**
 * GET /api/platform/overview — cross-tenant Platform Overview (Baseline §15,
 * ADM-003).
 *
 * Server-side privileged path via the service-role client, gated by
 * `requireSuperAdmin()`. Deliberately does not weaken any existing tenant
 * RLS or add broad client-side database access — this route alone bypasses
 * RLS server-side, under the Super Admin guard.
 *
 * Every counter is a real count of a persisted row. Where no authoritative
 * source exists — notably real active/ingesting stream count — the field
 * stays null with its reason attached rather than being inferred from
 * enabled-assignment state.
 */
export const runtime = 'edge';

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const [studiosResult, eventsResult, assignmentsResult, nodesResult, recordingsResult, ticketsResult, notificationsResult] =
    await Promise.all([
      db.from('studios').select('id', { count: 'exact', head: true }),
      db.from('events').select('page_state, archived_at, scheduled_start_at'),
      // Enabled Stream Assignments only — never labeled "active"/"live", since
      // `enabled = true` proves the assignment is enabled, not that it is
      // currently ingesting. No authoritative live-session/telemetry source
      // exists in this repository to prove that.
      db.from('media_event_assignments').select('event_id', { count: 'exact', head: true }).eq('enabled', true),
      db.from('media_nodes').select('status, maintenance_mode, last_heartbeat_at'),
      db.from('event_recordings').select('*'),
      db.from('support_tickets').select('status, category'),
      db.from('notifications').select('severity, read_at'),
    ]);

  if (eventsResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load events summary' }, { status: 500 });
  }

  const lifecycleCounts: Record<string, number> = { draft: 0, upcoming: 0, published: 0, archived: 0 };
  for (const row of eventsResult.data ?? []) {
    const status = deriveEventLifecycleStatus(row as { page_state: string | null; archived_at: string | null; scheduled_start_at: string | null });
    lifecycleCounts[status] = (lifecycleCounts[status] ?? 0) + 1;
  }

  const nodes = (nodesResult.data ?? []) as { status: string; maintenance_mode: boolean; last_heartbeat_at: string | null }[];
  const nodesByStatus: Record<string, number> = {};
  for (const node of nodes) {
    nodesByStatus[node.status] = (nodesByStatus[node.status] ?? 0) + 1;
  }

  const recordings = (recordingsResult.data ?? []) as EventRecordingRow[];
  const now = Date.now();

  const tickets = (ticketsResult.data ?? []) as { status: string; category: string }[];
  const notifications = (notificationsResult.data ?? []) as { severity: string; read_at: string | null }[];

  return NextResponse.json({
    success: true,
    overview: {
      studioCount: studiosResult.count ?? 0,
      eventsByLifecycle: lifecycleCounts,
      enabledStreamAssignmentCount: assignmentsResult.count ?? 0,
      activeStreamCount: null,
      activeStreamCountUnavailableReason: NO_LIVE_TELEMETRY_REASON,
      nodes: {
        total: nodes.length,
        byStatus: nodesByStatus,
        inMaintenance: nodes.filter((node) => node.maintenance_mode).length,
        neverReportedHeartbeat: nodes.filter((node) => node.last_heartbeat_at === null).length,
      },
      recordings: {
        total: recordings.length,
        b2Finalized: recordings.filter((row) => row.recording_state === 'b2_finalized').length,
        failed: recordings.filter((row) => row.recording_state === 'failed').length,
        gapsPendingReview: recordings.filter((row) => row.gap_status === 'pending_review').length,
        retentionFrozen: recordings.filter((row) => row.retention_frozen_at !== null).length,
        retentionExpired: recordings.filter(
          (row) => row.retention_expires_at !== null && new Date(row.retention_expires_at).getTime() <= now
        ).length,
        youtubeFallbackVerified: recordings.filter((row) => row.youtube_fallback_verified).length,
        r2CleanupEligible: recordings.filter((row) => isR2CleanupEligible(row)).length,
      },
      support: {
        total: tickets.length,
        open: tickets.filter((ticket) => ticket.status === 'open').length,
        urgentLiveOpen: tickets.filter((ticket) => ticket.status === 'open' && ticket.category === 'urgent_live').length,
      },
      notifications: {
        total: notifications.length,
        unread: notifications.filter((row) => row.read_at === null).length,
        critical: notifications.filter((row) => row.severity === 'critical').length,
      },
    },
  });
}
