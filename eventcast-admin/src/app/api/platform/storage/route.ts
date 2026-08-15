import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import type { EventRecordingRow } from '@/lib/eventRecording';
import { isR2CleanupEligible } from '@/lib/r2CleanupEligibility';
import { toStorageVisibilityView } from '@/lib/platformOperations';

/**
 * GET /api/platform/storage — Super Admin storage visibility (DASH-003,
 * PLAN-006: storage is monitored by Super Admin only and is never shown to
 * a normal provider in V1). `requireSuperAdmin`-gated.
 *
 * Every number here comes from a column this repository actually persists:
 * `guest_photos.file_size_bytes`, the `media_nodes` disk-free/R2-queue
 * counters, and recording/retention state. Per-object byte totals for the
 * media R2 bucket and the B2 archive are reported as explicitly unmeasured —
 * no table stores object sizes and this application cannot enumerate either
 * bucket. No storage figure is estimated, extrapolated, or synthesized.
 */
export const runtime = 'edge';

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const [guestPhotosResult, recordingsResult, nodesResult] = await Promise.all([
    db.from('guest_photos').select('file_size_bytes'),
    db.from('event_recordings').select('*'),
    db.from('media_nodes').select('disk_free_bytes, r2_queue_bytes'),
  ]);

  if (guestPhotosResult.error || recordingsResult.error || nodesResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load storage visibility' }, { status: 500 });
  }

  const guestPhotos = (guestPhotosResult.data ?? []) as { file_size_bytes: number | null }[];
  let guestPhotoBytes = 0;
  let guestPhotoRowsWithoutSize = 0;
  for (const row of guestPhotos) {
    if (typeof row.file_size_bytes === 'number') {
      guestPhotoBytes += row.file_size_bytes;
    } else {
      guestPhotoRowsWithoutSize += 1;
    }
  }

  const recordings = (recordingsResult.data ?? []) as EventRecordingRow[];
  const now = Date.now();

  const nodes = (nodesResult.data ?? []) as { disk_free_bytes: number | null; r2_queue_bytes: number | null }[];
  const nodeDiskFreeValues = nodes.map((row) => row.disk_free_bytes).filter((value): value is number => typeof value === 'number');
  const nodeR2QueueValues = nodes.map((row) => row.r2_queue_bytes).filter((value): value is number => typeof value === 'number');

  const storage = toStorageVisibilityView({
    guestPhotoCount: guestPhotos.length,
    guestPhotoBytes,
    guestPhotoRowsWithoutSize,
    recordingsWithB2Archive: recordings.filter((row) => row.b2_finalized_at !== null).length,
    recordingsRetentionFrozen: recordings.filter((row) => row.retention_frozen_at !== null).length,
    recordingsRetentionExpired: recordings.filter(
      (row) => row.retention_expires_at !== null && new Date(row.retention_expires_at).getTime() <= now
    ).length,
    r2CleanupEligibleCount: recordings.filter((row) => isR2CleanupEligible(row)).length,
    // Null rather than 0 when no node has ever reported: an unreported
    // counter is not the same fact as a zero counter.
    nodeDiskFreeBytes: nodeDiskFreeValues.length > 0 ? nodeDiskFreeValues.reduce((a, b) => a + b, 0) : null,
    nodeR2QueueBytes: nodeR2QueueValues.length > 0 ? nodeR2QueueValues.reduce((a, b) => a + b, 0) : null,
  });

  return NextResponse.json({ success: true, storage });
}
