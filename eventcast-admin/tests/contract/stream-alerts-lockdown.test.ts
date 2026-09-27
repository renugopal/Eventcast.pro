import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only contract checks for migration 0043 — the legacy
 * public.stream_alerts lockdown. A read-only remote audit found anon and
 * authenticated holding every table privilege plus a roles={public}
 * `FOR INSERT WITH CHECK (true)` policy (anyone with the anon key could
 * insert alerts). The table has no application consumer.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '0043_stream_alerts_lockdown.sql');

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

function stripSqlComments(sql: string): string {
  // Matches "--" through end of line without a `$` anchor, so it is not
  // defeated by a trailing `\r` on CRLF-checked-out files (JS `.` excludes
  // line-terminator characters, which made the previous per-line
  // split('\n') + /--.*$/ implementation silently no-op on CRLF input).
  return sql.replace(/--[^\r\n]*/g, '');
}

const LEGACY_POLICIES = ['stream_alerts_service_insert', 'stream_alerts_studio_select', 'stream_alerts_studio_delete'];

describe('Migration 0043 — stream_alerts lockdown contract', () => {
  it('drops all three legacy policies with IF EXISTS', () => {
    const sql = stripSqlComments(readSql());
    for (const name of LEGACY_POLICIES) {
      expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS ${name} ON public\\.stream_alerts;`));
    }
    expect(sql.match(/DROP POLICY/g) ?? []).toHaveLength(LEGACY_POLICIES.length);
  });

  it('creates no replacement policy for any role', () => {
    expect(stripSqlComments(readSql())).not.toMatch(/CREATE POLICY/i);
  });

  it('revokes every table privilege from PUBLIC, anon and authenticated', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.stream_alerts FROM PUBLIC;/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.stream_alerts FROM anon;/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.stream_alerts FROM authenticated;/);
  });

  it('restores service_role to SELECT only', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.stream_alerts FROM service_role;/);
    const grants = sql.match(/GRANT [^;]+;/g) ?? [];
    expect(grants).toEqual(['GRANT SELECT ON TABLE public.stream_alerts TO service_role;']);
    const revokeAt = sql.indexOf('FROM service_role;');
    const grantAt = sql.indexOf('GRANT SELECT ON TABLE public.stream_alerts TO service_role;');
    expect(revokeAt).toBeLessThan(grantAt);
  });

  it('keeps the table, its rows and RLS: no DROP TABLE, DELETE, TRUNCATE, or RLS change', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/\bDROP TABLE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/\bALTER TABLE\b/i);
  });

  it('touches only public.stream_alerts', () => {
    const sql = stripSqlComments(readSql());
    const tables = new Set([...sql.matchAll(/\bpublic\.(\w+)/g)].map((m) => m[1]));
    expect(tables).toEqual(new Set(['stream_alerts']));
  });
});
