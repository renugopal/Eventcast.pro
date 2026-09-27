import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only contract checks for migration 0044 — the durable
 * finalized-R2 replay pointer (event_recordings.r2_playback_id) and the
 * relay/manifest telemetry fields. Behavioral SQL verification must still
 * run against a disposable Postgres before any remote apply; these checks
 * pin the security/privilege shape and the approved rules.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0044_livestream_replay_pointer_and_relay_telemetry.sql',
);
const migration0036Path = path.join(repoRoot, 'supabase', 'migrations', '0036_event_recording_transition_rpc.sql');

function readSql(p = migrationPath): string {
  return readFileSync(p, 'utf8');
}

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const OLD_SIG = 'uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[]';
const NEW_SIG = `${OLD_SIG}, text`;
const TELEMETRY_SIG = 'uuid, bigint, bigint, text, text, integer, jsonb, jsonb';

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  const bodyStart = sql.indexOf('AS $$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart);
  return sql.slice(bodyStart, bodyEnd);
}

describe('Migration 0044 — recording transition signature replacement', () => {
  it('drops exactly the verified 12-argument signature so no ambiguous overload remains', () => {
    const sql = stripSqlComments(readSql()).replace(/\s+/g, ' ');
    expect(sql).toContain(`DROP FUNCTION public.apply_event_recording_transition( ${OLD_SIG} );`);
    expect(sql.match(/DROP FUNCTION/g) ?? []).toHaveLength(1);
  });

  it('creates (not create-or-replaces) the 13-argument function with p_r2_playback_id last, defaulting NULL', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).toMatch(/CREATE FUNCTION public\.apply_event_recording_transition\(/);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.apply_event_recording_transition/);
    expect(sql).toMatch(/p_covered_playback_ids text\[\] DEFAULT NULL,\s*\n\s*p_r2_playback_id text DEFAULT NULL\s*\n\s*\)/);
  });

  it('keeps SECURITY DEFINER with the hardened search_path', () => {
    const sql = stripSqlComments(readSql());
    const at = sql.indexOf('CREATE FUNCTION public.apply_event_recording_transition(');
    const header = sql.slice(at, sql.indexOf('AS $$', at));
    expect(header).toMatch(/RETURNS public\.event_recordings/);
    expect(header).toMatch(/SECURITY DEFINER/);
    expect(header).toMatch(/SET search_path = public, pg_temp/);
  });

  it('revokes EXECUTE from PUBLIC/anon/authenticated and grants only service_role on the new signature', () => {
    const sql = stripSqlComments(readSql());
    const sig = NEW_SIG.replace(/[[\]()]/g, (c) => `\\${c}`);
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.apply_event_recording_transition\\(${sig}\\) FROM PUBLIC;`));
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.apply_event_recording_transition\\(${sig}\\) FROM anon, authenticated;`));
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.apply_event_recording_transition\\(${sig}\\) TO service_role;`));
    expect(sql).not.toMatch(/GRANT [^;]*apply_event_recording_transition[^;]*TO (anon|authenticated|PUBLIC)/i);
  });

  it('preserves every 0036 transition rule verbatim (pointer logic is additive only)', () => {
    const body0036 = functionBody(stripSqlComments(readSql(migration0036Path)), 'apply_event_recording_transition');
    const body0044 = functionBody(stripSqlComments(readSql()), 'apply_event_recording_transition');
    const rules = [
      "RAISE EXCEPTION 'invalid target recording state: %', p_target_state;",
      "RAISE EXCEPTION 'gap_count must be supplied explicitly for state %', p_target_state;",
      "RAISE EXCEPTION 'covered_playback_ids must be a non-empty set of playback ids for state %', p_target_state;",
      'v_provenance_ok := v_activation_count > 0',
      "v_effective_state := 'b2_finalizing';",
      "RAISE EXCEPTION 'invalid recording state regression: % -> %', v_row.recording_state, v_effective_state;",
      "RAISE EXCEPTION 'b2_finalized requires a B2 object key and bucket';",
      'integrity_verified_at = CASE',
    ];
    for (const rule of rules) {
      expect(body0036).toContain(rule);
      expect(body0044).toContain(rule);
    }
  });
});

describe('Migration 0044 — r2_playback_id pointer rules', () => {
  const sql = stripSqlComments(readSql());
  const body = functionBody(sql, 'apply_event_recording_transition');

  it('adds a nullable column with the Worker playback-id validation constraint and no backfill', () => {
    expect(sql).toMatch(/ALTER TABLE public\.event_recordings\s+ADD COLUMN r2_playback_id text NULL;/);
    expect(sql).toMatch(/CHECK \(r2_playback_id IS NULL OR r2_playback_id ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,127\}\$'\)/);
    expect(sql).not.toMatch(/UPDATE public\.event_recordings\s+SET r2_playback_id/);
  });

  it('proves the pointer from the EFFECTIVE state, covered_playback_ids, and single-node single-playback history', () => {
    expect(body).toMatch(/v_effective_state IN \('local_finalized', 'b2_finalizing', 'b2_finalized'\)/);
    expect(body).toMatch(/p_r2_playback_id = ANY \(v_covered\)/);
    expect(body).toMatch(/count\(DISTINCT a\.playback_id\)/);
    expect(body).toMatch(/v_ptr_foreign_node_count = 0/);
    expect(body).toMatch(/v_ptr_distinct_playback_count = 1/);
    expect(body).toMatch(/v_ptr_single_playback_id = p_r2_playback_id/);
    // Proof is computed after the provenance hold decides the effective state.
    expect(body.indexOf("v_effective_state := 'b2_finalizing';")).toBeLessThan(body.indexOf('v_r2_proven := p_r2_playback_id;'));
  });

  it('ignores (never raises on) an unproven pointer', () => {
    const pointerBlock = body.slice(body.indexOf('IF p_r2_playback_id IS NOT NULL'), body.indexOf('v_current_rank :='));
    expect(pointerBlock).not.toMatch(/RAISE/);
  });

  it('binds the pointer to the generation in both write paths', () => {
    expect(body).toMatch(/r2_playback_id\s+= v_r2_proven,/); // frozen atomic replacement
    expect(body).toMatch(
      /WHEN p_finalization_generation IS NOT NULL\s+AND p_finalization_generation IS DISTINCT FROM finalization_generation THEN v_r2_proven/,
    );
    expect(body).toMatch(/WHEN r2_playback_id IS NULL AND v_r2_proven IS NOT NULL THEN v_r2_proven/);
    expect(body).toMatch(/ELSE r2_playback_id END/);
  });
});

describe('Migration 0044 — relay/manifest telemetry', () => {
  const sql = stripSqlComments(readSql());
  const body = functionBody(sql, 'apply_media_stream_telemetry_report');

  it('adds the four nullable columns with source-derived constraints', () => {
    expect(sql).toMatch(/ADD COLUMN relay_status text NULL/);
    expect(sql).toMatch(/ADD COLUMN relay_restart_count integer NULL/);
    expect(sql).toMatch(/ADD COLUMN relay_error_category text NULL/);
    expect(sql).toMatch(/ADD COLUMN manifest_age_seconds double precision NULL/);
    expect(sql).toMatch(/relay_status IN \('starting', 'running', 'stopped', 'failed'\)/);
    expect(sql).toMatch(/relay_restart_count >= 0/);
    expect(sql).toMatch(
      /'restart_budget_exhausted', 'ffmpeg_start_failed', 'ffmpeg_exited', 'agent_restarted', 'other'/,
    );
    expect(sql).toMatch(/manifest_age_seconds >= 0 AND manifest_age_seconds < 'Infinity'::double precision/);
    expect(sql).toMatch(/\(relay_status IS NULL\) = \(relay_restart_count IS NULL\)/);
  });

  it('keeps the telemetry RPC signature (CREATE OR REPLACE) and restates only service_role EXECUTE', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_media_stream_telemetry_report\(/);
    const sig = TELEMETRY_SIG.replace(/[[\]()]/g, (c) => `\\${c}`);
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.apply_media_stream_telemetry_report\\(${sig}\\) FROM PUBLIC;`));
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.apply_media_stream_telemetry_report\\(${sig}\\) FROM anon, authenticated;`));
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.apply_media_stream_telemetry_report\\(${sig}\\) TO service_role;`));
  });

  it('preserves current-assignment authorization and the sampled_at freshness guard', () => {
    expect(body).toMatch(/AND mea\.assigned_media_node_id = p_reporting_media_node_id\s+AND mea\.enabled = true/);
    expect(body).toMatch(/WHERE public\.media_stream_telemetry\.sampled_at <= EXCLUDED\.sampled_at;/);
  });

  it('normalizes invalid optional values to NULL inside guarded blocks, never skipping the core element', () => {
    expect(body).toMatch(/jsonb_typeof\(v_stream->'relay_status'\) = 'string'/);
    expect(body).toMatch(/jsonb_typeof\(v_stream->'relay_restart_count'\) = 'number'/);
    expect(body).toMatch(/jsonb_typeof\(v_stream->'manifest_age_seconds'\) = 'number'/);
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s+v_relay_status := NULL;/);
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s+v_manifest_age_seconds := NULL;/);
    // The only CONTINUE statements remain the pre-existing core-field ones.
    const optionalBlock = body.slice(body.indexOf('v_relay_status := NULL;'), body.indexOf('INSERT INTO public.media_stream_telemetry'));
    expect(optionalBlock).not.toMatch(/CONTINUE/);
  });

  it('writes the four fields on both insert and freshness-guarded update', () => {
    for (const col of ['relay_status', 'relay_restart_count', 'relay_error_category', 'manifest_age_seconds']) {
      expect(body).toMatch(new RegExp(`${col}\\s+= EXCLUDED\\.${col}`));
    }
  });
});
