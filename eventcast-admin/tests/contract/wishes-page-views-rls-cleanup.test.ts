import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only contract checks for migration 0022 — removal of
 * out-of-band, non-canonical RLS policies on public.wishes and
 * public.page_views (see 0022_remove_unsafe_wishes_page_views_policies.sql
 * for the full remote-audit history). These checks guard against the
 * migration accidentally dropping a canonical 0003 policy, accidentally
 * leaving an unsafe policy in place, or expanding scope to a mutation type
 * or table beyond what was reviewed and approved.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0022_remove_unsafe_wishes_page_views_policies.sql',
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

const UNSAFE_WISHES_POLICIES = [
  'Admin can delete wishes',
  'Admin can update and delete wishes',
  'Anyone can insert wishes',
  'Authenticated users can delete wishes',
  'Authenticated users can read wishes',
  'Public can insert wishes',
  'Public can view wishes',
];

const UNSAFE_PAGE_VIEWS_POLICIES = [
  'Admin full access on page_views',
  'Anyone can insert page views',
  'Anyone can read page views',
  'Public can insert page_views',
];

const CANONICAL_POLICIES = [
  'wishes_insert_policy',
  'wishes_select_policy',
  'wishes_delete_policy',
  'page_views_insert_policy',
  'page_views_select_policy',
];

describe('Migration 0022 — unsafe wishes/page_views policy removal contract', () => {
  it('drops every confirmed unsafe policy on public.wishes with an exact-quoted name', () => {
    const sql = stripSqlComments(readSql());
    for (const name of UNSAFE_WISHES_POLICIES) {
      expect(sql).toMatch(
        new RegExp(`DROP POLICY IF EXISTS "${name}" ON public\\.wishes;`),
      );
    }
  });

  it('drops every confirmed unsafe policy on public.page_views with an exact-quoted name', () => {
    const sql = stripSqlComments(readSql());
    for (const name of UNSAFE_PAGE_VIEWS_POLICIES) {
      expect(sql).toMatch(
        new RegExp(`DROP POLICY IF EXISTS "${name}" ON public\\.page_views;`),
      );
    }
  });

  it('drops exactly 11 policies — no more, no fewer', () => {
    const sql = stripSqlComments(readSql());
    const matches = sql.match(/DROP POLICY IF EXISTS/g) ?? [];
    expect(matches).toHaveLength(UNSAFE_WISHES_POLICIES.length + UNSAFE_PAGE_VIEWS_POLICIES.length);
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

  it('only touches public.wishes and public.page_views — no other table', () => {
    const sql = stripSqlComments(readSql());
    const targetTables = new Set(
      [...sql.matchAll(/DROP POLICY IF EXISTS "[^"]+" ON (public\.\w+);/g)].map((m) => m[1]),
    );
    expect(targetTables).toEqual(new Set(['public.wishes', 'public.page_views']));
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
