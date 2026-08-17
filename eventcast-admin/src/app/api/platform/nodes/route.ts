import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { toPlatformMediaNodeView, type MediaNodeRow } from '@/lib/platformOperations';

/**
 * GET /api/platform/nodes — the SRS / Media Node operational roster
 * (Baseline §15, ADM-006). `requireSuperAdmin`-gated, service-role client.
 *
 * Reads `media_nodes` only. It never touches `media_node_credentials`, and
 * no node token, pepper, provisioning secret, or credential hash is
 * projected. CPU/memory/network utilisation is reported as explicitly
 * unavailable — migration `0020` persists heartbeat, capacity, disk-free and
 * R2-queue columns, and nothing in this repository collects the rest.
 */

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const [nodesResult, assignmentsResult] = await Promise.all([
    db
      .from('media_nodes')
      .select(
        'id, name, region, ingest_hostname, status, maintenance_mode, hard_stream_limit, active_stream_count, disk_free_bytes, r2_queue_bytes, last_heartbeat_at, software_version, config_version, updated_at'
      )
      .order('name', { ascending: true }),
    db.from('media_event_assignments').select('assigned_media_node_id, enabled').eq('enabled', true),
  ]);

  if (nodesResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load media nodes' }, { status: 500 });
  }

  const enabledAssignmentsByNode = new Map<string, number>();
  for (const row of (assignmentsResult.data ?? []) as { assigned_media_node_id: string | null }[]) {
    if (!row.assigned_media_node_id) continue;
    enabledAssignmentsByNode.set(
      row.assigned_media_node_id,
      (enabledAssignmentsByNode.get(row.assigned_media_node_id) ?? 0) + 1
    );
  }

  const nodes = ((nodesResult.data ?? []) as MediaNodeRow[]).map((row) => ({
    ...toPlatformMediaNodeView(row),
    // A separate, honestly-named fact from `activeStreamCount` (the
    // capacity counter the activation RPC maintains): this is how many
    // enabled assignments currently point at this node, not how many are
    // ingesting.
    enabledAssignmentCount: enabledAssignmentsByNode.get(row.id) ?? 0,
  }));

  return NextResponse.json({ success: true, nodes });
}
