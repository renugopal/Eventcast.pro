import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only regression checks for
 * supabase/migrations/0024_media_agent_activation_capacity.sql's
 * `activate_media_event_assignment` SQL function.
 *
 * IMPORTANT SCOPE NOTE: this suite asserts on the migration's SQL *text* —
 * it does not execute the function against a real Postgres instance. No
 * local Supabase/Postgres test harness exists in this repository (no
 * supabase/config.toml, no pgTAP, no prior test anywhere under tests/
 * connects to a real database — verified by inspection before writing this
 * file). Per this slice's audit follow-up, introducing one is explicitly
 * out of scope without separate approval, so this is the strongest
 * available regression guard short of that: it will fail loudly if a
 * future edit removes the self-exclusion clause that fixes the
 * already_activated-vs-node_at_capacity misclassification (audit finding
 * F-1), the row-locking clause the concurrency-safety argument depends on,
 * the node-eligibility filter, or the EXECUTE-privilege restriction. It
 * cannot prove runtime behavior (true concurrency, actual PostgREST role
 * enforcement) the way a database-backed test would — see this slice's
 * final report for what that would require.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0024_media_agent_activation_capacity.sql',
);

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('Migration 0024 activate_media_event_assignment — static regression contract', () => {
  it('F-1 regression guard: the capacity count excludes the requested event itself', () => {
    const sql = readSql();
    // Must appear inside the same subquery that filters on
    // assigned_media_node_id/enabled — a loose substring check on the
    // whole file would be satisfied by a stray comment, so anchor on the
    // subquery block itself.
    const capacityBlockMatch = sql.match(
      /SELECT count\(\*\) FROM public\.media_event_assignments mea\s+WHERE([\s\S]*?)\)\s*<\s*v_node\.hard_stream_limit/,
    );
    expect(capacityBlockMatch, 'capacity-count subquery not found in expected shape').not.toBeNull();
    const whereClause = capacityBlockMatch![1];
    expect(whereClause).toMatch(/mea\.assigned_media_node_id\s*=\s*v_node\.id/);
    expect(whereClause).toMatch(/mea\.enabled\s*=\s*true/);
    expect(whereClause).toMatch(/mea\.event_id\s*<>\s*p_event_id/);
  });

  it('node eligibility requires status=healthy AND maintenance_mode=false (not just != retired)', () => {
    const sql = readSql();
    expect(sql).toMatch(/mn\.status\s*=\s*'healthy'\s+AND\s+mn\.maintenance_mode\s*=\s*false/);
  });

  it('candidate node rows are locked (FOR UPDATE) before the capacity check — the concurrency-safety mechanism', () => {
    const sql = readSql();
    expect(sql).toMatch(/FOR UPDATE OF mn/);
  });

  it('emits both node_at_capacity and no_eligible_node as distinct outcomes', () => {
    const sql = readSql();
    expect(sql).toContain(`'node_at_capacity'::text`);
    expect(sql).toContain(`'no_eligible_node'::text`);
  });

  it('the activation UPDATE stays guarded on (event_id, enabled = false) — unchanged by the F-1 fix', () => {
    const sql = readSql();
    expect(sql).toMatch(/WHERE event_id = p_event_id AND enabled = false/);
  });

  it('is SECURITY DEFINER with a fixed search_path (required for the EXECUTE restriction below to be meaningful)', () => {
    const sql = readSql();
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public/);
  });

  it('revokes PUBLIC execute and grants only to service_role — no anon/authenticated grant anywhere in the file', () => {
    const sql = readSql();
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.activate_media_event_assignment[\s\S]*FROM PUBLIC/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.activate_media_event_assignment[\s\S]*TO service_role/);
    expect(sql).not.toMatch(/GRANT[\s\S]*TO\s+(anon|authenticated)\b/i);
  });

  it('never selects or returns a secret-bearing column (stream_secret_hash, digest, youtube key/reference)', () => {
    const sql = readSql();
    // The function's own RETURNS TABLE shape and RETURN QUERY statements
    // must never project a secret column — only outcome/node_id/ingest_hostname.
    const returnStatements = sql.match(/RETURN QUERY SELECT[^;]+;/g) ?? [];
    expect(returnStatements.length).toBeGreaterThan(0);
    for (const stmt of returnStatements) {
      expect(stmt).not.toMatch(/stream_secret_hash|digest|youtube_stream_key|youtube_secret_reference/i);
    }
  });
});
