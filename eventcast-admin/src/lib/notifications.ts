import { supabase, supabaseAdmin } from '@/lib/supabase';

/**
 * Server-only reusable helper for writing real in-app Notification Center
 * rows (Baseline V2.1 NOT-001, migration 0034). This is the *only*
 * sanctioned write path into `public.notifications` — the table has no
 * anon/authenticated INSERT policy, by design, so this helper always uses
 * the service-role client.
 *
 * This package implements in-app notifications only. It does NOT send
 * WhatsApp, SMS, or email — do not add a delivery adapter here or claim any
 * "sent" state. A later, separately-approved package that wires a real
 * outbound provider can call this helper first (to record the in-app fact)
 * and then, only once real credentials exist, attempt real delivery
 * alongside it — that is out of scope for this call.
 */

const db = supabaseAdmin || supabase;

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface CreateNotificationInput {
  studioId: string;
  eventId?: string | null;
  severity?: NotificationSeverity;
  notificationType: string;
  title: string;
  body?: string | null;
  /**
   * Optional dedup key, unique per studio (migration 0034's partial unique
   * index). Pass a caller-constructed key such as
   * `stream_disconnect:${eventId}:${hourBucket}` to guarantee at most one
   * notification of that exact kind — the insert silently no-ops (does not
   * throw) if a row with the same (studioId, dedupKey) already exists.
   */
  dedupKey?: string | null;
}

export interface CreateNotificationResult {
  created: boolean;
  id: string | null;
}

/**
 * Inserts one notification, honoring the dedup key if provided. Returns
 * `created: false` (never throws) when a duplicate was silently skipped —
 * callers that don't care about dedup outcomes can ignore the return value.
 */
export async function createNotification(input: CreateNotificationInput): Promise<CreateNotificationResult> {
  const { data, error } = await db
    .from('notifications')
    .insert({
      studio_id: input.studioId,
      event_id: input.eventId ?? null,
      severity: input.severity ?? 'info',
      notification_type: input.notificationType,
      title: input.title,
      body: input.body ?? null,
      dedup_key: input.dedupKey ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // A unique-violation on the partial dedup index is the expected,
    // non-fatal "already notified" outcome — every other error is a real
    // failure the caller should be able to see via the thrown message.
    if ((error as { code?: string }).code === '23505') {
      return { created: false, id: null };
    }
    throw new Error('Failed to create notification: ' + error.message);
  }

  return { created: true, id: (data as { id: string } | null)?.id ?? null };
}
