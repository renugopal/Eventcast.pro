import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const sql = readFileSync(
  path.join(migrationsDir, '0040_livestream_stream_telemetry_and_node_health.sql'),
  'utf8'
);

const executableSql = sql.replace(/--[^\n]*/g, '');

// Scoped to just the CREATE TABLE column-definition block, not the whole
// file: the migration's own COMMENT ON TABLE/FUNCTION prose legitimately
// contains the English phrases "no FPS field" and "never a viewer/
// audience metric" as documentation, which would otherwise collide with
// a naive whole-file substring check. This directly tests the real
// invariant - no such COLUMN exists - rather than merely no such word
// anywhere in the file.
function extractTableColumnsBlock(tableName: string): string {
  const startMarker = `CREATE TABLE public.${tableName} (`;
  const startIdx = executableSql.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`extractTableColumnsBlock: could not find "${startMarker}" in the migration`);
  }
  const endIdx = executableSql.indexOf(');', startIdx);
  if (endIdx === -1) {
    throw new Error(`extractTableColumnsBlock: could not find a closing ");" after ${tableName}'s CREATE TABLE`);
  }
  if (endIdx <= startIdx) {
    throw new Error(`extractTableColumnsBlock: closing ");" for ${tableName} appears before its CREATE TABLE start`);
  }
  return executableSql.slice(startIdx, endIdx);
}

describe('Livestream stream telemetry + node health migration contract (0040, local-only)', () => {
  it('creates exactly the two new tables and adds no column to media_nodes', () => {
    expect(sql).toMatch(/CREATE TABLE public\.media_stream_telemetry/);
    expect(sql).toMatch(/CREATE TABLE public\.media_stream_sessions/);
    expect(sql).not.toMatch(/ALTER TABLE public\.media_nodes/);
  });

  it('media_stream_telemetry is keyed by event_id and carries no FPS/frame-rate column', () => {
    expect(sql).toMatch(/event_id\s+uuid PRIMARY KEY REFERENCES public\.events\(id\)/);
    const columns = extractTableColumnsBlock('media_stream_telemetry').toLowerCase();
    expect(columns).not.toMatch(/\bfps\b/);
    expect(columns).not.toMatch(/frame_rate|framerate/);
  });

  it('media_stream_telemetry carries no viewer/audience analytics column', () => {
    const columns = extractTableColumnsBlock('media_stream_telemetry').toLowerCase();
    expect(columns).not.toMatch(/viewer|watch_time|concurrent/);
  });

  it('media_stream_sessions.session_id is the durable unique idempotency key', () => {
    expect(sql).toMatch(/session_id\s+text NOT NULL UNIQUE/);
  });

  it('duration_seconds is a GENERATED column derived from started_at/disconnected_at, never a plain input column', () => {
    expect(sql).toMatch(/duration_seconds\s+double precision GENERATED ALWAYS AS/);
    expect(sql).toMatch(/EXTRACT\(EPOCH FROM \(disconnected_at - started_at\)\)/);
  });

  it('both new tables enable RLS with zero ordinary-user policies and no CREATE POLICY exists', () => {
    expect(sql).toMatch(/ALTER TABLE public\.media_stream_telemetry ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/ALTER TABLE public\.media_stream_sessions ENABLE ROW LEVEL SECURITY;/);
    expect(sql).not.toMatch(/CREATE POLICY/);
  });

  it('both new tables revoke all privileges from PUBLIC/anon/authenticated/service_role, then grant only SELECT to service_role', () => {
    for (const table of ['media_stream_telemetry', 'media_stream_sessions']) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC;`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM anon;`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM authenticated;`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM service_role;`));
      expect(sql).toMatch(new RegExp(`GRANT SELECT ON TABLE public\\.${table} TO service_role;`));
    }
  });

  it('rejects an unknown reporting media node before writing anything', () => {
    expect(sql).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM public\.media_nodes mn WHERE mn\.id = p_reporting_media_node_id\) THEN\s*\n\s*RAISE EXCEPTION/
    );
  });

  it('node heartbeat fields are each independently optional via COALESCE, never a fabricated fallback', () => {
    expect(sql).toMatch(/disk_free_bytes\s*=\s*COALESCE\(p_disk_free_bytes, disk_free_bytes\)/);
    expect(sql).toMatch(/r2_queue_bytes\s*=\s*COALESCE\(p_r2_queue_bytes, r2_queue_bytes\)/);
    expect(sql).toMatch(/active_stream_count\s*=\s*COALESCE\(p_active_stream_count, active_stream_count\)/);
  });

  it('current-stream telemetry loop is authorized against the CURRENT enabled media_event_assignments node, never activation history', () => {
    const streamsLoopStart = sql.indexOf(
      "FOR v_stream IN SELECT * FROM jsonb_array_elements(COALESCE(p_streams, '[]'::jsonb))"
    );
    const sessionsLoopStart = sql.indexOf(
      "FOR v_session IN SELECT * FROM jsonb_array_elements(COALESCE(p_ended_sessions, '[]'::jsonb))"
    );
    expect(streamsLoopStart).toBeGreaterThan(-1);
    expect(sessionsLoopStart).toBeGreaterThan(streamsLoopStart);

    const streamsLoopRegion = sql.slice(streamsLoopStart, sessionsLoopStart);

    expect(streamsLoopRegion).toMatch(/FROM public\.media_event_assignments mea/);
    expect(streamsLoopRegion).toMatch(/mea\.assigned_media_node_id = p_reporting_media_node_id/);
    expect(streamsLoopRegion).toMatch(/mea\.enabled = true/);
    // Must not authorize current telemetry via activation history.
    expect(streamsLoopRegion).not.toMatch(/media_event_assignment_activations/);
  });

  it('ended-session loop is authorized against activation history, never current assignment', () => {
    const sessionsLoopStart = sql.indexOf(
      "FOR v_session IN SELECT * FROM jsonb_array_elements(COALESCE(p_ended_sessions, '[]'::jsonb))"
    );
    const returnIdx = sql.indexOf('RETURN v_accepted;');
    expect(sessionsLoopStart).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(sessionsLoopStart);

    const sessionsLoopRegion = sql.slice(sessionsLoopStart, returnIdx);

    expect(sessionsLoopRegion).toMatch(/FROM public\.media_event_assignment_activations a/);
    expect(sessionsLoopRegion).toMatch(/a\.event_id = v_event_id/);
    expect(sessionsLoopRegion).toMatch(/a\.media_node_id = p_reporting_media_node_id/);
    // Must not authorize ended-session history via current assignment.
    expect(sessionsLoopRegion).not.toMatch(/media_event_assignments\s+mea/);
  });

  it('every required stream field (sampled_at, connected) is checked for NULL and skipped via CONTINUE, never defaulted', () => {
    expect(sql).not.toMatch(/COALESCE\(\(v_stream->>'sampled_at'\)/);
    expect(sql).not.toMatch(/COALESCE\(\(v_stream->>'connected'\)/);
    expect(sql).toMatch(/v_sampled_at := \(v_stream->>'sampled_at'\)::timestamptz;\s*\n\s*IF v_sampled_at IS NULL THEN\s*\n\s*CONTINUE;/);
    expect(sql).toMatch(/v_connected := \(v_stream->>'connected'\)::boolean;\s*\n\s*IF v_connected IS NULL THEN\s*\n\s*CONTINUE;/);
  });

  it('every required session field (started_at, disconnected_at, segment_count) is checked for NULL and skipped via CONTINUE, never defaulted', () => {
    expect(sql).not.toMatch(/COALESCE\(\(v_session->>'segment_count'\)/);
    expect(sql).not.toMatch(/COALESCE\(\(v_session->>'duration_seconds'\)/);
    expect(sql).toMatch(/v_started_at := \(v_session->>'started_at'\)::timestamptz;\s*\n\s*IF v_started_at IS NULL THEN\s*\n\s*CONTINUE;/);
    expect(sql).toMatch(/v_disconnected_at := \(v_session->>'disconnected_at'\)::timestamptz;\s*\n\s*IF v_disconnected_at IS NULL THEN\s*\n\s*CONTINUE;/);
    expect(sql).toMatch(/v_segment_count := \(v_session->>'segment_count'\)::integer;\s*\n\s*IF v_segment_count IS NULL THEN\s*\n\s*CONTINUE;/);
  });

  it('duration_seconds is never read from the ended-session jsonb payload', () => {
    expect(executableSql).not.toMatch(/v_session->>'duration_seconds'/);
  });

  it('the current-state upsert applies a sampled_at freshness guard on ON CONFLICT DO UPDATE', () => {
    expect(sql).toMatch(
      /ON CONFLICT \(event_id\) DO UPDATE SET[\s\S]*?WHERE public\.media_stream_telemetry\.sampled_at <= EXCLUDED\.sampled_at;/
    );
  });

  it('ended-session insert uses ON CONFLICT (session_id) DO NOTHING for idempotency', () => {
    expect(sql).toMatch(/ON CONFLICT \(session_id\) DO NOTHING;/);
  });

  it('re-acknowledgement is identity-safe: requires event_id, reporting_media_node_id, started_at, disconnected_at, and segment_count to all match before accepting', () => {
    expect(sql).toMatch(
      /IF v_existing_event_id = v_event_id\s*\n\s*AND v_existing_node_id = p_reporting_media_node_id\s*\n\s*AND v_existing_started_at = v_started_at\s*\n\s*AND v_existing_disconnected_at = v_disconnected_at\s*\n\s*AND v_existing_segment_count = v_segment_count THEN/
    );
  });

  it('every loop iteration is wrapped in its own BEGIN/EXCEPTION WHEN OTHERS THEN CONTINUE block', () => {
    const exceptionBlocks = executableSql.match(/EXCEPTION WHEN OTHERS THEN\s*\n\s*CONTINUE;/g) ?? [];
    // One per loop (streams, ended_sessions).
    expect(exceptionBlocks.length).toBe(2);
  });

  it('EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to service_role', () => {
    expect(executableSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.apply_media_stream_telemetry_report\(uuid, bigint, bigint, text, text, integer, jsonb, jsonb\) FROM PUBLIC;/
    );
    expect(executableSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.apply_media_stream_telemetry_report\(uuid, bigint, bigint, text, text, integer, jsonb, jsonb\) FROM anon, authenticated;/
    );
    expect(executableSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_media_stream_telemetry_report\(uuid, bigint, bigint, text, text, integer, jsonb, jsonb\) TO service_role;/
    );
  });

  it('the function is SECURITY DEFINER with a fixed safe search_path', () => {
    expect(sql).toMatch(/SECURITY DEFINER\s*\n\s*SET search_path = public, pg_temp/);
  });

  it('returns the accepted session ids array', () => {
    expect(sql).toMatch(/RETURNS text\[\]/);
    expect(sql).toMatch(/RETURN v_accepted;/);
  });
});
