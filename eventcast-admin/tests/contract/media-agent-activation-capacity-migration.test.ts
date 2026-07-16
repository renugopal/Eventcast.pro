import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only regression checks for
 * supabase/migrations/0024_media_agent_activation_capacity.sql and
 * 0025_restrict_media_assignment_activation_execute.sql — the
 * `activate_media_event_assignment` SQL function and its EXECUTE
 * privilege restriction.
 *
 * IMPORTANT SCOPE NOTE: this suite asserts on the migrations' SQL *text* —
 * it does not execute anything against a real Postgres instance. No local
 * Supabase/Postgres test harness exists in this repository (no
 * supabase/config.toml, no pgTAP, no prior test anywhere under tests/
 * connects to a real database — verified by inspection before writing this
 * file). Per this slice's audit follow-up, introducing one is explicitly
 * out of scope without separate approval, so this is the strongest
 * available regression guard short of that.
 *
 * Migration 0025 exists because production catalog verification after 0024
 * showed `REVOKE ALL ... FROM PUBLIC` alone was insufficient:
 * Supabase's project-level default privileges (external to this repo's
 * migration history) separately and automatically grant EXECUTE on new
 * public-schema functions to `anon` and `authenticated`, which a
 * PUBLIC-only revoke never touches. 0025 revokes those two roles by name.
 * The tests below therefore check the *combined* effect of 0024 + 0025
 * together, not 0024 in isolation, since 0024 alone is a known-insufficient
 * security state.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migration0024Path = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0024_media_agent_activation_capacity.sql',
);
const migration0025Path = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0025_restrict_media_assignment_activation_execute.sql',
);

function readSql(): string {
  return readFileSync(migration0024Path, 'utf8');
}

function readSql0025(): string {
  return readFileSync(migration0025Path, 'utf8');
}

/**
 * Strips full-line and trailing `--` SQL comments, matching the sibling
 * `media-agent-migration-sequence.test.ts`'s helper of the same name. Both
 * of this file's migrations carry prose comments that describe, in plain
 * English, exactly the illegal grant shape being guarded against (e.g.
 * "...grant to anon and authenticated..." while explaining the root
 * cause) — matching against raw file text would false-positive on that
 * prose. Every negative ("must never contain X") assertion below runs
 * against comment-stripped text for this reason.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Extracts complete, semicolon-terminated statements starting with `keyword` (case-insensitive), across a possibly multi-line statement — so a statement's `TO <role>` clause on a later line is still checked together with its `GRANT`/`REVOKE` keyword on an earlier line. */
function extractStatements(sql: string, keyword: string): string[] {
  const re = new RegExp(`${keyword}[^;]*;`, 'gi');
  return sql.match(re) ?? [];
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

  it('0024 alone revokes PUBLIC execute and grants to service_role, and never itself grants to anon/authenticated', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.activate_media_event_assignment[\s\S]*FROM PUBLIC/);
    const grantStatements = extractStatements(sql, 'GRANT');
    expect(grantStatements.length).toBeGreaterThan(0);
    for (const stmt of grantStatements) {
      expect(stmt).not.toMatch(/TO\s+(anon|authenticated)\b/i);
      expect(stmt).toMatch(/TO\s+service_role\b/i);
    }
    // NOTE: this is necessary but NOT sufficient for the actual security
    // property — 0024 alone does not revoke Supabase's separate,
    // automatically-attached default-privilege grants to anon/authenticated
    // (see migration 0025 and the "combined migration sequence" tests below
    // for the property that actually matters).
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

describe('Migration 0025 activate_media_event_assignment EXECUTE restriction — static regression contract', () => {
  it('explicitly revokes EXECUTE from PUBLIC, anon, and authenticated by name', () => {
    const sql = stripSqlComments(readSql0025());
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.activate_media_event_assignment\(\s*uuid,\s*text,\s*text,\s*text,\s*timestamptz,\s*timestamptz\s*\)\s*FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.activate_media_event_assignment\(\s*uuid,\s*text,\s*text,\s*text,\s*timestamptz,\s*timestamptz\s*\)\s*FROM anon/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.activate_media_event_assignment\(\s*uuid,\s*text,\s*text,\s*text,\s*timestamptz,\s*timestamptz\s*\)\s*FROM authenticated/,
    );
  });

  it('grants EXECUTE only to service_role, and never to anon/authenticated/PUBLIC anywhere in the file', () => {
    const sql = stripSqlComments(readSql0025());
    const grantStatements = extractStatements(sql, 'GRANT');
    expect(grantStatements.length).toBeGreaterThan(0);
    for (const stmt of grantStatements) {
      expect(stmt).not.toMatch(/TO\s+(anon|authenticated|PUBLIC)\b/i);
      expect(stmt).toMatch(/TO\s+service_role\b/i);
    }
  });

  it('does not recreate or alter the function body — no CREATE/CREATE OR REPLACE FUNCTION statement', () => {
    const sql = stripSqlComments(readSql0025());
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });

  it('does not touch any table, RLS policy, or data — no DDL/DML beyond REVOKE/GRANT', () => {
    const sql = stripSqlComments(readSql0025());
    expect(sql).not.toMatch(/\bCREATE TABLE\b/i);
    expect(sql).not.toMatch(/\bALTER TABLE\b/i);
    expect(sql).not.toMatch(/\bINSERT INTO\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\./i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/\bENABLE ROW LEVEL SECURITY\b/i);
    expect(sql).not.toMatch(/\bCREATE POLICY\b/i);
    expect(sql).not.toMatch(/\bDROP POLICY\b/i);
  });
});

describe('Combined migration sequence (0024 + 0025) — the actual production security property', () => {
  it('the combined sequence ends with anon and authenticated explicitly revoked, and only service_role granted', () => {
    const combined = stripSqlComments(readSql()) + '\n' + stripSqlComments(readSql0025());

    // Both roles must be explicitly revoked by name somewhere in the
    // sequence — this is the property that was actually missing after 0024
    // alone, per the production catalog verification that motivated 0025.
    expect(combined).toMatch(/REVOKE[\s\S]*FROM anon\b/);
    expect(combined).toMatch(/REVOKE[\s\S]*FROM authenticated\b/);
    expect(combined).toMatch(/REVOKE[\s\S]*FROM PUBLIC\b/);

    // No statement anywhere in the combined sequence may grant EXECUTE (or
    // anything else) to anon, authenticated, or PUBLIC on this function.
    // Extracted as complete semicolon-terminated statements (not single
    // physical lines), since the real GRANT statement's `TO <role>` clause
    // sits on a line after the `GRANT` keyword itself.
    const grantStatements = extractStatements(combined, 'GRANT');
    expect(grantStatements.length).toBeGreaterThan(0);
    for (const stmt of grantStatements) {
      expect(stmt).not.toMatch(/TO\s+(anon|authenticated|PUBLIC)\b/i);
      expect(stmt).toMatch(/TO\s+service_role\b/i);
    }
  });
});
