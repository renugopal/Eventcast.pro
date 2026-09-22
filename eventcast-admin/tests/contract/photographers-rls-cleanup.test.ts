import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only contract checks for migration 0039 — removal of
 * out-of-band, non-canonical RLS policies on public.photographers (see
 * 0039_photographers_rls_lockdown.sql for the full remote-audit history).
 * These checks guard against the migration accidentally dropping a
 * canonical 0003 policy, accidentally leaving an unsafe policy in place,
 * or expanding scope to a mutation type or table beyond what was reviewed
 * and approved.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0039_photographers_rls_lockdown.sql',
);

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

/** Strips full-line and trailing `--` SQL comments so assertions about
 * actual executable statements aren't fooled by explanatory prose in
 * comments (this migration's own header names every policy it discusses).
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const UNSAFE_PHOTOGRAPHERS_POLICIES = [
  'Admin full access on photographers',
  'Public can view photographers',
];

const CANONICAL_POLICIES = [
  'photographers_select_policy',
  'photographers_insert_policy',
  'photographers_update_policy',
  'photographers_delete_policy',
];

describe('Migration 0039 — unsafe photographers policy removal contract', () => {
  it('drops every confirmed unsafe policy on public.photographers with an exact-quoted name', () => {
    const sql = stripSqlComments(readSql());
    for (const name of UNSAFE_PHOTOGRAPHERS_POLICIES) {
      expect(sql).toMatch(
        new RegExp(`DROP POLICY IF EXISTS "${name}" ON public\\.photographers;`),
      );
    }
  });

  it('drops exactly 2 policies — no more, no fewer', () => {
    const sql = stripSqlComments(readSql());
    const matches = sql.match(/DROP POLICY IF EXISTS/g) ?? [];
    expect(matches).toHaveLength(UNSAFE_PHOTOGRAPHERS_POLICIES.length);
  });

  it('never drops any canonical 0003 policy', () => {
    const sql = stripSqlComments(readSql());
    for (const name of CANONICAL_POLICIES) {
      expect(sql).not.toMatch(new RegExp(`DROP POLICY[^;]*"?${name}"?`, 'i'));
    }
  });

  it('mentions every canonical policy only in comments, as preserved source-of-truth documentation', () => {
    const rawSql = readSql();
    for (const name of CANONICAL_POLICIES) {
      expect(rawSql).toContain(name);
    }
    // Confirm each canonical policy name only appears on comment lines (no
    // executable statement references them at all).
    const executableLines = stripSqlComments(rawSql)
      .split('\n')
      .filter((line) => line.trim().length > 0);
    for (const name of CANONICAL_POLICIES) {
      expect(executableLines.some((line) => line.includes(name))).toBe(false);
    }
  });

  it('contains no GRANT, REVOKE, ALTER TABLE, or DROP TABLE statement', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/\bALTER TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP TABLE\b/i);
  });

  it('contains no RLS enable/disable statement', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('only touches public.photographers — no other table', () => {
    const sql = stripSqlComments(readSql());
    const targetTables = new Set(
      [...sql.matchAll(/DROP POLICY IF EXISTS "[^"]+" ON (public\.\w+);/g)].map((m) => m[1]),
    );
    expect(targetTables).toEqual(new Set(['public.photographers']));
  });

  it('every statement uses IF EXISTS (safe to re-run, never errors on an already-dropped policy)', () => {
    const sql = stripSqlComments(readSql());
    const dropLines = sql
      .split('\n')
      .filter((line) => /DROP POLICY/i.test(line));
    for (const line of dropLines) {
      expect(line).toMatch(/DROP POLICY IF EXISTS/i);
    }
  });
});
