import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only regression checks for
 * supabase/migrations/0026_media_agent_assignment_deactivation.sql — the
 * `deactivate_media_event_assignment` SQL function and its EXECUTE
 * privilege restriction.
 *
 * IMPORTANT SCOPE NOTE: this suite asserts on the migration's SQL *text* —
 * it does not execute anything against a real Postgres instance, mirroring
 * `media-agent-activation-capacity-migration.test.ts`'s own documented
 * scope limit (no local Supabase/Postgres test harness exists in this
 * repository). Live database capacity/concurrency validation is recorded
 * as a separate, later migration-validation requirement, not claimed here.
 *
 * Unlike 0024 (which needed a follow-up, 0025, to correctly revoke
 * anon/authenticated), this migration revokes PUBLIC, anon, AND
 * authenticated by name from the start — the tests below check that this
 * migration alone already has the complete, correct privilege posture, no
 * combined-sequence test needed.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migration0026Path = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0026_media_agent_assignment_deactivation.sql',
);

function readSql(): string {
  return readFileSync(migration0026Path, 'utf8');
}

/** Mirrors the sibling activation-migration test's helper of the same name. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function extractStatements(sql: string, keyword: string): string[] {
  const re = new RegExp(`${keyword}[^;]*;`, 'gi');
  return sql.match(re) ?? [];
}

describe('Migration 0026 deactivate_media_event_assignment — static regression contract', () => {
  it('the guarded UPDATE stays keyed on (event_id, enabled = true) — the deactivation counterpart to activation\'s (event_id, enabled = false) guard', () => {
    const sql = readSql();
    expect(sql).toMatch(/WHERE event_id = p_event_id AND enabled = true/);
  });

  it('the UPDATE only ever sets enabled = false — never clears ingest_id, playback_id, assigned_media_node_id, stream_secret_hash, or publish window fields', () => {
    const sql = stripSqlComments(readSql());
    const updateMatch = sql.match(/UPDATE public\.media_event_assignments\s+SET([\s\S]*?)WHERE/i);
    expect(updateMatch, 'UPDATE statement not found in expected shape').not.toBeNull();
    const setClause = updateMatch![1];
    expect(setClause).toMatch(/enabled\s*=\s*false/);
    // The SET clause must contain nothing else — a comma anywhere would mean
    // an extra column is being assigned.
    expect(setClause).not.toContain(',');
    for (const forbiddenColumn of [
      'ingest_id',
      'playback_id',
      'assigned_media_node_id',
      'stream_secret_hash',
      'publish_window_start_at',
      'publish_window_end_at',
    ]) {
      expect(setClause).not.toContain(forbiddenColumn);
    }
  });

  it('the function body never references media_nodes.active_stream_count (line comments and the COMMENT ON FUNCTION doc string may explain why it is not used)', () => {
    const sql = stripSqlComments(readSql());
    const bodyMatch = sql.match(/AS \$\$([\s\S]*?)\$\$;/);
    expect(bodyMatch, 'function body not found in expected $$...$$ shape').not.toBeNull();
    expect(bodyMatch![1]).not.toMatch(/active_stream_count/);
  });

  it('contains no DELETE or DROP statement anywhere', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
  });

  it('performs no cross-row / node-level locking in executable SQL — no FOR UPDATE, no SELECT ... FROM media_nodes (comments may explain the contrast with activation)', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/FOR UPDATE/i);
    expect(sql).not.toMatch(/FROM public\.media_nodes/i);
  });

  it('is SECURITY DEFINER with a fixed search_path (required for the EXECUTE restriction below to be meaningful)', () => {
    const sql = readSql();
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public/);
  });

  it('emits both deactivated and no_row_matched as distinct outcomes, and never selects/returns a secret-bearing column', () => {
    const sql = readSql();
    expect(sql).toContain(`'deactivated'::text`);
    expect(sql).toContain(`'no_row_matched'::text`);
    const returnStatements = sql.match(/RETURN QUERY SELECT[^;]+;/g) ?? [];
    expect(returnStatements.length).toBeGreaterThan(0);
    for (const stmt of returnStatements) {
      expect(stmt).not.toMatch(/stream_secret_hash|digest|youtube_stream_key|youtube_secret_reference/i);
    }
  });

  it('revokes EXECUTE from PUBLIC, anon, and authenticated by name, and grants only to service_role — all within this single migration, no follow-up required', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.deactivate_media_event_assignment\(uuid\)\s*FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.deactivate_media_event_assignment\(uuid\)\s*FROM anon/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.deactivate_media_event_assignment\(uuid\)\s*FROM authenticated/,
    );

    const grantStatements = extractStatements(sql, 'GRANT');
    expect(grantStatements.length).toBeGreaterThan(0);
    for (const stmt of grantStatements) {
      expect(stmt).not.toMatch(/TO\s+(anon|authenticated|PUBLIC)\b/i);
      expect(stmt).toMatch(/TO\s+service_role\b/i);
    }
  });
});
