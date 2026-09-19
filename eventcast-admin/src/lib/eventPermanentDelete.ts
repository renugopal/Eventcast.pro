import { supabase, supabaseAdmin } from './supabase';
import type { EventRecordingRow } from './eventRecording';
import { deleteFromR2, r2KeyFromPublicUrl } from './r2Delete';

/**
 * The single guarded permanent-delete function for events. Used by BOTH the
 * manual `POST /api/events/[eventId]/permanent-delete` route and the
 * automated 30-day Archived-Draft sweep in
 * `GET /api/cron/event-lifecycle-sweep` — one code path, two callers, so
 * neither caller can ever apply a weaker safety gate than the other.
 *
 * Deliberately NOT used by the 7-day Draft auto-archive sweep, which only
 * ever sets `archived_at` and never reaches this function at all.
 *
 * Every caller must already have verified tenant ownership of `eventId`
 * under `studioId` (the manual route via `getOwnedEventById`; the cron
 * sweep via its own studio-scoped row query) — this function re-scopes its
 * own final delete by both `id` and `studio_id` as defense-in-depth, the
 * same double-`eq` pattern every other mutation in this codebase uses, but
 * does not perform a first-class ownership lookup of its own.
 *
 * Ordering is deliberate: every external side effect (R2 delete, legacy
 * Cloudinary cleanup) happens AFTER the database row is confirmed deleted
 * — confirmed by row count, not merely the absence of an error — never
 * before. If the DB delete fails or matches zero rows, nothing external has
 * been touched yet, so a failed permanent delete never leaves a surviving
 * event with its media already destroyed.
 *
 * Every pre-delete lookup (livestream assignment state, recording/retention
 * state, the guest-photo snapshot) fails CLOSED — a query error blocks the
 * delete rather than being silently treated as "nothing found". This
 * function deliberately does NOT reuse `getEventRecordingState()` from
 * `eventRecording.ts`: that helper collapses a real query error into the
 * same `null` it returns for "no recording row exists yet", which is
 * correct for its existing fail-open display callers but wrong here, so
 * `event_recordings` is queried directly with its error handled explicitly.
 *
 * B2 archival objects (`event_recordings.b2_object_key`) are never deleted
 * anywhere in this module — only recorded as a reference in the audit
 * trail.
 */

const db = supabaseAdmin || supabase;

export type PermanentDeleteBlockReason =
  | 'not_archived'
  | 'assignment_check_failed'
  | 'live_assignment_enabled'
  | 'recording_check_failed'
  | 'recording_in_progress'
  | 'retention_not_expired'
  | 'snapshot_failed';

/**
 * `platformRole` here is the actor's PLATFORM role
 * (`auth.platformRole` — `super_admin` | `live_streamer` | `reseller`),
 * never the studio mutation role (`auth.studioMemberRole` —
 * `owner`/`admin`/`member`). `platform_audit_log.actor_platform_role` is a
 * plain `text NOT NULL` column with no CHECK constraint (confirmed via a
 * live read-only schema check) — writing an ordinary studio owner's real
 * `live_streamer`/`reseller` platform role here is schema-valid and
 * accurate; it must never be replaced with a hardcoded `'super_admin'`,
 * which would misrepresent who performed the action.
 *
 * A `cron` actor additionally carries the automatic-delete eligibility
 * window (`archivedBefore`, a single ISO cutoff fixed once per sweep run).
 * This function re-asserts that exact eligibility — `page_state = 'draft'`,
 * `archived_at IS NOT NULL`, `archived_at < archivedBefore` — both
 * immediately after loading the row and again, atomically, on the final
 * DELETE itself, so a Draft restored, re-archived, or edited between
 * candidate selection and this call safely falls out of scope instead of
 * being deleted on stale eligibility. `requireDraft: true` is a literal
 * marker kept for call-site clarity (the sweep that constructs this actor
 * only ever does so for Draft candidates); manual delete never sets this
 * field and is entirely unaffected by it — no cutoff and no page_state
 * requirement are ever applied to a manual delete.
 */
export type PermanentDeleteActor =
  | { type: 'manual'; userId: string; platformRole: string }
  | { type: 'cron'; requireDraft: true; archivedBefore: string };

export type PermanentDeleteResult =
  | { status: 'deleted'; eventId: string; warnings: string[] }
  | { status: 'blocked'; reason: PermanentDeleteBlockReason; message: string }
  /**
   * Race-safe, non-error outcome: the candidate stopped matching automatic
   * (or, in principle, manual) delete eligibility between being selected
   * and being acted on — e.g. a concurrent restore, re-archive, or
   * duplicate delete request. Distinct from `blocked` (an otherwise-still-
   * eligible event failed a safety guard) and from an actual thrown error
   * (a genuine database failure).
   */
  | { status: 'skipped'; message: string }
  | { status: 'not_found' };

interface DeletableEventRow {
  id: string;
  studio_id: string;
  slug: string | null;
  page_state: string | null;
  archived_at: string | null;
  thumbnail_url: string | null;
  invitation_video_url: string | null;
  gallery_urls: string[] | null;
}

interface GuestPhotoRef {
  id: string;
  r2_key: string;
}

// ─── Legacy Cloudinary cleanup (reused from the pre-existing
//     /api/events/delete permanent-delete branch; corrected to actually
//     route video URLs to the video resource type, to positively identify
//     a Cloudinary URL rather than assuming "not R2 => Cloudinary", and to
//     surface a non-2xx destroy response as a warning instead of silently
//     ignoring it) ─────────────────────────────────────────────────────────

/**
 * Positive identification only: a URL is treated as a Cloudinary asset of
 * THIS project only when it is actually hosted at
 * `res.cloudinary.com/<configured cloud name>/...`. Anything else — an
 * unrelated external host, a malformed URL, or `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
 * being unset — is never assumed to be a stale Cloudinary asset just
 * because it also failed R2 key resolution.
 */
function isConfiguredCloudinaryUrl(url: string): boolean {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'res.cloudinary.com') return false;
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[0] === cloudName;
  } catch {
    return false;
  }
}

async function generateCloudinarySignature(params: Record<string, string>, apiSecret: string): Promise<string> {
  const sortedKeys = Object.keys(params).sort();
  const stringToSign = sortedKeys.map((k) => `${k}=${params[k]}`).join('&') + apiSecret;

  const encoder = new TextEncoder();
  const data = encoder.encode(stringToSign);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getCloudinaryPublicId(url: string): string {
  try {
    const parts = url.split('/');
    const lastPart = parts.pop();
    const folder = parts.slice(parts.indexOf('upload') + 2).join('/');
    const publicId = lastPart?.split('.')[0];
    return folder ? `${folder}/${publicId}` : publicId || '';
  } catch {
    return '';
  }
}

/** Returns a warning string on a non-2xx destroy response, `null` on success or when there was nothing to delete. */
async function cloudinaryDestroy(publicIds: string[], resourceType: 'image' | 'video'): Promise<string | null> {
  if (publicIds.length === 0) return null;

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;
  const timestamp = Math.round(new Date().getTime() / 1000).toString();

  const params = { public_ids: publicIds.join(','), timestamp };
  const signature = await generateCloudinarySignature(params, apiSecret);
  const body = new URLSearchParams();
  body.append('public_ids', publicIds.join(','));
  body.append('timestamp', timestamp);
  body.append('api_key', apiKey);
  body.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return `Cloudinary ${resourceType} destroy returned ${res.status}: ${text}`;
  }
  return null;
}

/**
 * Best-effort Cloudinary cleanup for POSITIVELY-IDENTIFIED legacy Cloudinary
 * URLs only. `imageUrls` covers thumbnail + gallery; `videoUrls` covers the
 * invitation video — kept separate so each is destroyed under its correct
 * Cloudinary resource type, unlike the original code this was extracted
 * from, which never populated a video list at all.
 */
async function legacyCloudinaryCleanup(imageUrls: string[], videoUrls: string[]): Promise<string[]> {
  const warnings: string[] = [];
  const imageIds = imageUrls.map(getCloudinaryPublicId).filter((id) => id.length > 0);
  const videoIds = videoUrls.map(getCloudinaryPublicId).filter((id) => id.length > 0);

  const imageWarning = await cloudinaryDestroy(imageIds, 'image');
  if (imageWarning) warnings.push(imageWarning);

  const videoWarning = await cloudinaryDestroy(videoIds, 'video');
  if (videoWarning) warnings.push(videoWarning);

  return warnings;
}

// ─── Main guarded operation ────────────────────────────────────────────────

export async function permanentlyDeleteEvent(
  eventId: string,
  studioId: string,
  actor: PermanentDeleteActor
): Promise<PermanentDeleteResult> {
  const { data: event, error: fetchError } = await db
    .from('events')
    .select('id, studio_id, slug, page_state, archived_at, thumbnail_url, invitation_video_url, gallery_urls')
    .eq('id', eventId)
    .eq('studio_id', studioId)
    .maybeSingle();

  if (fetchError || !event) {
    return { status: 'not_found' };
  }
  const row = event as DeletableEventRow;

  // Cron eligibility re-check, against the row as it actually is RIGHT NOW
  // — not merely the state it was in when the sweep's candidate query ran.
  // A Draft that was restored, re-archived, or otherwise changed since
  // then safely falls out of scope here instead of being deleted on stale
  // eligibility.
  if (actor.type === 'cron') {
    const stillEligible =
      row.page_state === 'draft' &&
      row.archived_at !== null &&
      new Date(row.archived_at).getTime() < new Date(actor.archivedBefore).getTime();
    if (!stillEligible) {
      return {
        status: 'skipped',
        message: 'No longer matches automatic-delete eligibility (state changed since candidate selection).',
      };
    }
  }

  if (!row.archived_at) {
    return {
      status: 'blocked',
      reason: 'not_archived',
      message: 'Event must be archived before it can be permanently deleted.',
    };
  }

  // Fail CLOSED: a query error here must block the delete, never be
  // silently read as "no active assignment".
  const { data: assignment, error: assignmentError } = await db
    .from('media_event_assignments')
    .select('enabled')
    .eq('event_id', eventId)
    .maybeSingle();

  if (assignmentError) {
    return {
      status: 'blocked',
      reason: 'assignment_check_failed',
      message: `Could not verify livestream assignment state: ${assignmentError.message}`,
    };
  }
  if (assignment && (assignment as { enabled: boolean }).enabled) {
    return {
      status: 'blocked',
      reason: 'live_assignment_enabled',
      message: 'This event has an active livestream assignment and cannot be permanently deleted.',
    };
  }

  // Fail CLOSED: queried directly (not via getEventRecordingState(), which
  // collapses an error into the same null it returns for "no row") so a
  // real query failure blocks the delete instead of being read as "no
  // recording, safe to proceed".
  const { data: recordingRow, error: recordingError } = await db
    .from('event_recordings')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();

  if (recordingError) {
    return {
      status: 'blocked',
      reason: 'recording_check_failed',
      message: `Could not verify recording/retention state: ${recordingError.message}`,
    };
  }
  const recording = recordingRow as EventRecordingRow | null;
  let b2ObjectKeyForAudit: string | null = null;

  if (recording) {
    b2ObjectKeyForAudit = recording.b2_object_key;

    if (recording.recording_state === 'recording' || recording.recording_state === 'b2_finalizing') {
      return {
        status: 'blocked',
        reason: 'recording_in_progress',
        message: `Recording is still in progress (state: ${recording.recording_state}) and cannot be permanently deleted yet.`,
      };
    }
    if (
      recording.retention_frozen_at &&
      recording.retention_expires_at &&
      new Date(recording.retention_expires_at).getTime() > Date.now()
    ) {
      return {
        status: 'blocked',
        reason: 'retention_not_expired',
        message: `This event's recording retention window has not expired yet (expires ${recording.retention_expires_at}).`,
      };
    }
  }

  // Snapshot everything cleanup will need BEFORE the DB delete. Fails
  // CLOSED: a query error here must block the delete, never be silently
  // read as "no guest photos to clean up" (which would strand orphaned R2
  // objects with no remaining event row to find them by).
  const { data: guestPhotos, error: guestPhotosError } = await db
    .from('guest_photos')
    .select('id, r2_key')
    .eq('event_id', eventId);

  if (guestPhotosError) {
    return {
      status: 'blocked',
      reason: 'snapshot_failed',
      message: `Could not snapshot guest photos for cleanup: ${guestPhotosError.message}`,
    };
  }
  const guestPhotoRefs = (guestPhotos ?? []) as GuestPhotoRef[];

  // Resolve R2 vs. positively-identified-Cloudinary vs. unknown/skip
  // classification for event media now, while the row still exists,
  // keeping image/video URLs separate so Cloudinary cleanup can use the
  // correct resource type for each. Pure classification only — no network
  // call happens in this block.
  const preDeleteWarnings: string[] = [];

  const r2ImageKeys: string[] = [];
  const legacyImageUrls: string[] = [];
  const classifyImageUrl = (url: string) => {
    const key = r2KeyFromPublicUrl(url);
    if (key) {
      r2ImageKeys.push(key);
    } else if (isConfiguredCloudinaryUrl(url)) {
      legacyImageUrls.push(url);
    } else {
      preDeleteWarnings.push(`unrecognized external media URL, skipped (not R2, not Cloudinary): ${url}`);
    }
  };
  if (row.thumbnail_url) classifyImageUrl(row.thumbnail_url);
  for (const url of Array.isArray(row.gallery_urls) ? row.gallery_urls : []) classifyImageUrl(url);

  const r2VideoKeys: string[] = [];
  const legacyVideoUrls: string[] = [];
  if (row.invitation_video_url) {
    const key = r2KeyFromPublicUrl(row.invitation_video_url);
    if (key) {
      r2VideoKeys.push(key);
    } else if (isConfiguredCloudinaryUrl(row.invitation_video_url)) {
      legacyVideoUrls.push(row.invitation_video_url);
    } else {
      preDeleteWarnings.push(
        `unrecognized external media URL, skipped (not R2, not Cloudinary): ${row.invitation_video_url}`
      );
    }
  }

  // ── The hard delete. Nothing external has been touched above this line. ──
  // For a cron actor, the SAME eligibility just re-checked above is also
  // asserted atomically in the DELETE's own WHERE clause — closing the
  // window between that check and this statement. A manual delete adds no
  // extra clause here: only id + studio_id scope it, exactly as before.
  let deleteQuery = db.from('events').delete().eq('id', row.id).eq('studio_id', studioId);
  if (actor.type === 'cron') {
    deleteQuery = deleteQuery.eq('page_state', 'draft').not('archived_at', 'is', null).lt('archived_at', actor.archivedBefore);
  }
  const { data: deletedRows, error: deleteError } = await deleteQuery.select('id');

  if (deleteError) {
    throw new Error(`Permanent delete failed: ${deleteError.message}`);
  }
  if (!deletedRows || deletedRows.length !== 1) {
    // A race (concurrent restore/re-archive/duplicate-delete) between the
    // eligibility check above and this statement — safe by construction,
    // never treated as success, and no audit/cleanup runs for it.
    return {
      status: 'skipped',
      message: 'Event no longer matched the expected state at delete time.',
    };
  }

  const warnings: string[] = [...preDeleteWarnings];

  // ── Audit (post-delete; a failure here never un-succeeds the delete). ──
  const auditPayload = {
    eventId: row.id,
    studioId,
    slug: row.slug,
    archivedAt: row.archived_at,
    b2ObjectKey: b2ObjectKeyForAudit, // reference only — never passed to any delete call
    deletedAt: new Date().toISOString(),
  };

  if (actor.type === 'manual') {
    const { error: auditError } = await db.from('platform_audit_log').insert({
      actor_user_id: actor.userId,
      actor_platform_role: actor.platformRole,
      action: 'event_permanently_deleted',
      target_type: 'event',
      target_id: row.id,
      reason: null,
      before_state: auditPayload,
      after_state: {},
    });
    if (auditError) {
      // The event is already gone — an audit-write failure is a logged
      // warning, never a reason to report the delete itself as failed.
      warnings.push(`audit log write failed: ${auditError.message}`);
      console.error('[eventPermanentDelete] audit log write failed after successful delete', {
        eventId: row.id,
        error: auditError.message,
      });
    }
  } else {
    // No system/service auth.users row exists to satisfy
    // platform_audit_log.actor_user_id's NOT NULL FK for an automated
    // actor, so the automated path logs the same fact set structurally
    // instead of forcing an invalid or borrowed user id into that column.
    console.log('[eventPermanentDelete] cron permanent delete', {
      actor: 'system:cron-lifecycle-sweep',
      ...auditPayload,
    });
  }

  // ── Best-effort external cleanup (post-delete, non-fatal). ──
  for (const photo of guestPhotoRefs) {
    try {
      await deleteFromR2(photo.r2_key);
    } catch (err) {
      warnings.push(`guest_photo ${photo.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const key of [...r2ImageKeys, ...r2VideoKeys]) {
    try {
      await deleteFromR2(key);
    } catch (err) {
      warnings.push(`event media ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (legacyImageUrls.length > 0 || legacyVideoUrls.length > 0) {
    try {
      const cloudinaryWarnings = await legacyCloudinaryCleanup(legacyImageUrls, legacyVideoUrls);
      warnings.push(...cloudinaryWarnings);
    } catch (err) {
      warnings.push(`legacy Cloudinary cleanup: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { status: 'deleted', eventId: row.id, warnings };
}
