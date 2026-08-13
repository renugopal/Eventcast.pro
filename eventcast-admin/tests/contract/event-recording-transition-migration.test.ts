import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const sql = readFileSync(path.join(migrationsDir, '0036_event_recording_transition_rpc.sql'), 'utf8');

/**
 * The migration's executable SQL with `--` line comments stripped, so
 * privilege assertions match real GRANT/REVOKE statements rather than prose
 * that happens to mention "granted".
 */
const executableSql = sql.replace(/--[^\n]*/g, '');

const RPCS = [
  'apply_event_recording_transition(uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[])',
  'event_recording_state_rank(text)',
] as const;

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('event recording transition migration contract (0036, local-only)', () => {
  it('adds only the additive columns it needs to event_recordings', () => {
    expect(sql).toMatch(/ALTER TABLE public\.event_recordings ADD COLUMN finalization_generation text/);
    expect(sql).toMatch(/ALTER TABLE public\.event_recordings ADD COLUMN gap_count integer NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/ALTER TABLE public\.event_recordings ADD COLUMN gap_status text NOT NULL DEFAULT 'none'/);
  });

  // Gap vocabulary must mirror the Media Agent's own vod_finalizations
  // semantics exactly - no invented statuses.
  it('constrains gap_status to exactly the existing Media Agent gap vocabulary', () => {
    expect(sql).toMatch(/gap_status IN \('none', 'pending_review', 'acknowledged', 'rejected'\)/);
  });

  // Migration 0035 granted service_role SELECT only and said a future
  // writer must add its own explicit path. That path is the RPC, never a
  // table grant.
  it('never grants service_role write access to event_recordings', () => {
    expect(executableSql).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*ON TABLE public\.event_recordings/i);
  });

  it('creates the append-only activation-history table with non-null producing identity', () => {
    expect(sql).toMatch(/CREATE TABLE public\.media_event_assignment_activations/);
    expect(sql).toMatch(/media_node_id uuid NOT NULL REFERENCES public\.media_nodes\(id\)/);
    // NOT NULL matters: a nullable playback identity could never be
    // "covered", quietly weakening the coverage gate.
    expect(sql).toMatch(/ingest_id\s+text NOT NULL/);
    expect(sql).toMatch(/playback_id\s+text NOT NULL/);
    expect(sql).toMatch(/CREATE INDEX media_event_assignment_activations_event_node_idx/);
  });

  it('locks the activation-history table down to server-side reads only', () => {
    expect(sql).toMatch(/ALTER TABLE public\.media_event_assignment_activations ENABLE ROW LEVEL SECURITY/);
    expect(executableSql).not.toMatch(/CREATE POLICY[^;]*media_event_assignment_activations/i);

    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(executableSql).toMatch(
        new RegExp(`REVOKE ALL ON TABLE public\\.media_event_assignment_activations FROM ${role}`)
      );
    }
    expect(executableSql).toMatch(/GRANT SELECT ON TABLE public\.media_event_assignment_activations TO service_role/);
    // The only writer is the SECURITY DEFINER activation function.
    expect(executableSql).not.toMatch(
      /GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*ON TABLE public\.media_event_assignment_activations/i
    );
  });

  it('writes activation history only on the successful activation branch', () => {
    expect(sql).toMatch(/INSERT INTO public\.media_event_assignment_activations/);
    // One insert only: a failed/at-capacity/no-row-matched activation must
    // not record provenance for a node that was never given the event.
    expect(sql.match(/INSERT INTO public\.media_event_assignment_activations/g)).toHaveLength(1);
  });

  it('preserves the existing activation function behavior around that insert', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.activate_media_event_assignment/);
    expect(sql).toMatch(/WHERE mn\.status = 'healthy' AND mn\.maintenance_mode = false/);
    expect(sql).toMatch(/ORDER BY mn\.created_at ASC\s*\n\s*FOR UPDATE OF mn/);
    expect(sql).toMatch(/< v_node\.hard_stream_limit THEN/);
    expect(sql).toMatch(/WHERE event_id = p_event_id AND enabled = false/);
    for (const outcome of ['activated', 'no_row_matched', 'node_at_capacity', 'no_eligible_node']) {
      expect(sql).toContain(`'${outcome}'::text`);
    }
  });

  it('restricts every function to service_role only', () => {
    for (const rpc of RPCS) {
      const signature = escapeRe(`public.${rpc}`);
      expect(executableSql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`));
      expect(executableSql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM anon, authenticated`));
      expect(executableSql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`));
    }
  });

  it('uses the 0035 security conventions for the transition function', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_event_recording_transition[\s\S]*?SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(sql).toMatch(/FOR UPDATE;/);
  });

  // Authoritative timestamps are server-owned: there is deliberately no
  // parameter for either, so a node value can never distort retention.
  it('accepts no node-supplied b2_finalized_at or integrity_verified_at parameter', () => {
    const signature = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.apply_event_recording_transition'),
      sql.indexOf('RETURNS public.event_recordings')
    );
    expect(signature).not.toMatch(/p_b2_finalized_at/);
    expect(signature).not.toMatch(/p_integrity_verified_at/);
    expect(signature).toMatch(/p_reporting_media_node_id uuid/);
    expect(signature).toMatch(/p_covered_playback_ids text\[\]/);
  });

  it('requires explicit gap evidence so omitted facts cannot masquerade as zero gaps', () => {
    expect(sql).toMatch(/IF p_gap_count IS NULL THEN[\s\S]*?RAISE EXCEPTION/);
    expect(sql).toMatch(/gap_count must be supplied explicitly/);
    expect(sql).toMatch(/IF p_gap_count < 0 THEN/);
    expect(sql).toMatch(/gap_status must be supplied explicitly/);
    expect(sql).toMatch(/finalization_generation is required for state/);
  });

  it('requires a distinct, non-empty covered playback set for finalization states', () => {
    expect(sql).toMatch(/SELECT array_agg\(DISTINCT c\) INTO v_covered/);
    expect(sql).toMatch(/WHERE c IS NOT NULL AND btrim\(c\) <> ''/);
    expect(sql).toMatch(/covered_playback_ids must be a non-empty set/);
  });

  it('requires single-node activation provenance with no null-history exception', () => {
    expect(sql).toMatch(/FROM public\.media_event_assignment_activations a\s*\n\s*WHERE a\.event_id = p_event_id/);
    expect(sql).toMatch(/v_provenance_ok := v_activation_count > 0/);
    expect(sql).toMatch(/v_foreign_node_count = 0/);
    expect(sql).toMatch(/v_uncovered_count = 0/);
  });

  // A multi-node (split) recording must never carry the authoritative key,
  // or a partial archive would wear the finalized label.
  it('holds a report that fails provenance at b2_finalizing instead of b2_finalized', () => {
    expect(sql).toMatch(/IF p_target_state = 'b2_finalized' AND NOT v_provenance_ok THEN\s*\n\s*v_effective_state := 'b2_finalizing';/);
    expect(sql).toMatch(/WHEN v_effective_state = 'b2_finalized'[\s\S]*?THEN p_b2_object_key/);
  });

  it('enforces monotonic transitions with only the documented guarded exceptions', () => {
    expect(sql).toMatch(/event_recording_state_rank/);
    expect(sql).toMatch(/invalid recording state regression/);
    expect(sql).toMatch(/v_effective_state = 'b2_finalizing' AND NOT v_same_generation AND NOT v_frozen/);
  });

  it('grants integrity verification only from explicit evidence and an eligible gap state', () => {
    expect(sql).toMatch(/v_gap_eligible :=/);
    expect(sql).toMatch(/p_strong_integrity_verified AND v_gap_eligible/);
    // Never cleared once set.
    expect(sql).toMatch(/WHEN v_grant_integrity AND integrity_verified_at IS NULL THEN now\(\)\s*\n\s*ELSE integrity_verified_at END/);
  });

  it('refuses to re-resolve an already-resolved gap differently', () => {
    expect(sql).toMatch(/gap already resolved as .* refusing to re-resolve/);
  });

  it('protects an already-frozen recording from an unverified replacement generation', () => {
    expect(sql).toMatch(/IF v_frozen AND NOT v_same_generation THEN/);
    expect(sql).toMatch(/AND p_strong_integrity_verified\s*\n\s*AND \(p_gap_count = 0 OR p_gap_status = 'acknowledged'\)/);
    expect(sql).toMatch(/AND v_provenance_ok/);
  });

  // freeze_event_retention (0035) stays the only retention writer.
  it('never writes retention fields', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.apply_event_recording_transition'));
    for (const column of ['retention_effective_days', 'retention_frozen_at', 'retention_expires_at']) {
      expect(fn).not.toMatch(new RegExp(`SET[\\s\\S]{0,400}${column}\\s*=`));
    }
  });

  it('does not weaken the platform audit-log actor constraint', () => {
    expect(executableSql).not.toMatch(/ALTER TABLE public\.platform_audit_log/i);
    expect(executableSql).not.toMatch(/INSERT INTO public\.platform_audit_log/i);
  });

  it('performs no activation-history backfill', () => {
    expect(executableSql).not.toMatch(
      /INSERT INTO public\.media_event_assignment_activations[\s\S]*?SELECT[\s\S]*?FROM public\.media_event_assignments/i
    );
  });
});
