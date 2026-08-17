import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { deriveEventLifecycleStatus } from '@/lib/eventLifecycle';
import { getEventRecordingState } from '@/lib/eventRecording';
import {
  buildR2CleanupPlan,
  toPlatformRecordingView,
  unavailable,
  NO_LIVE_TELEMETRY_REASON,
  NO_TECHNICAL_STREAM_METRICS_REASON,
} from '@/lib/platformOperations';

/**
 * GET /api/platform/events/[eventId] — the cross-tenant operational
 * drill-down for one event. `requireSuperAdmin`-gated, service-role client.
 *
 * Assembles the facts a Super Admin needs to operate an event — assignment
 * state, activation provenance, recording/archive evidence, retention state,
 * and the non-destructive R2 cleanup plan — from the mechanisms that already
 * own them. Nothing here re-derives recording, retention, or cleanup
 * semantics.
 *
 * Secret boundary: the assignment projection deliberately excludes
 * `stream_secret_hash` and `youtube_secret_reference`, and reports only
 * whether an ingest/playback identity is present. Real live/ingest state and
 * technical stream metrics are reported as explicitly unavailable rather
 * than inferred from `enabled = true`.
 */

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;

  const { data: event, error: eventError } = await db
    .from('events')
    .select(
      'id, slug, studio_id, page_state, event_visibility, scheduled_start_at, archived_at, template_id, youtube_url, created_at, studios(slug, display_name)'
    )
    .eq('id', eventId)
    .maybeSingle();

  if (eventError) {
    return NextResponse.json({ success: false, error: 'Failed to load event' }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 });
  }

  const [assignmentResult, activationsResult, ticketsResult, notificationsResult, recording] = await Promise.all([
    db
      .from('media_event_assignments')
      .select(
        'assigned_media_node_id, ingest_id, playback_id, enabled, publish_window_start_at, publish_window_end_at, youtube_enabled, config_version, updated_at'
      )
      .eq('event_id', eventId)
      .maybeSingle(),
    db
      .from('media_event_assignment_activations')
      .select('media_node_id, ingest_id, playback_id, activated_at')
      .eq('event_id', eventId)
      .order('activated_at', { ascending: true }),
    db.from('support_tickets').select('id, subject, category, status, created_at').eq('event_id', eventId),
    db
      .from('notifications')
      .select('id, severity, notification_type, title, read_at, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(50),
    getEventRecordingState(eventId),
  ]);

  const assignmentRow = assignmentResult.data as Record<string, unknown> | null;
  const activations = ((activationsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    media_node_id: row.media_node_id as string,
    playback_id: row.playback_id as string,
    activated_at: (row.activated_at as string | null) ?? null,
  }));

  const studios = event.studios as { slug?: string; display_name?: string } | { slug?: string; display_name?: string }[] | null;
  const studio = Array.isArray(studios) ? studios[0] : studios;

  return NextResponse.json({
    success: true,
    event: {
      id: event.id,
      slug: event.slug,
      studioId: event.studio_id,
      studioSlug: studio?.slug ?? null,
      studioDisplayName: studio?.display_name ?? null,
      pageState: event.page_state,
      eventVisibility: event.event_visibility,
      scheduledStartAt: event.scheduled_start_at,
      archivedAt: event.archived_at,
      templateId: event.template_id,
      /** Provider-supplied public watch link. Not a credential and not a relay secret. */
      youtubeUrl: event.youtube_url,
      createdAt: event.created_at,
      lifecycleStatus: deriveEventLifecycleStatus({
        page_state: event.page_state,
        archived_at: event.archived_at,
        scheduled_start_at: event.scheduled_start_at,
      }),
    },
    assignment: assignmentRow
      ? {
          assignedMediaNodeId: assignmentRow.assigned_media_node_id,
          enabled: assignmentRow.enabled,
          ingestPresent: Boolean(assignmentRow.ingest_id),
          playbackPresent: Boolean(assignmentRow.playback_id),
          publishWindowStartAt: assignmentRow.publish_window_start_at,
          publishWindowEndAt: assignmentRow.publish_window_end_at,
          youtubeEnabled: assignmentRow.youtube_enabled,
          configVersion: assignmentRow.config_version,
          updatedAt: assignmentRow.updated_at,
          liveStatus: unavailable(NO_LIVE_TELEMETRY_REASON),
          technicalStreamMetrics: unavailable(NO_TECHNICAL_STREAM_METRICS_REASON),
        }
      : null,
    activationHistory: activations.map((row) => ({
      mediaNodeId: row.media_node_id,
      playbackId: row.playback_id,
      activatedAt: row.activated_at,
    })),
    recording: recording ? toPlatformRecordingView(recording) : null,
    r2CleanupPlan: buildR2CleanupPlan(eventId, recording, activations),
    supportTickets: ((ticketsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id,
      subject: row.subject,
      category: row.category,
      status: row.status,
      createdAt: row.created_at,
    })),
    notifications: ((notificationsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id,
      severity: row.severity,
      notificationType: row.notification_type,
      title: row.title,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
  });
}
