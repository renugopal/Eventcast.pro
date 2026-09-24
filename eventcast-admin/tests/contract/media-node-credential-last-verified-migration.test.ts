import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only contract checks for migration 0041 — the additive,
 * server-only `media_node_credentials.last_verified_at` slot-verification
 * evidence column. Guards against the migration growing beyond the one
 * reviewed column: no credential-material column, no default/backfill, no
 * policy/grant/index/RLS change, no destructive DDL, and no silent
 * `IF NOT EXISTS` masking of unexpected pre-existing schema.
 *
 * The explanatory header comments and the `COMMENT ON COLUMN` text may
 * legitimately mention tokens, digests, or the pepper, so every
 * executable-statement check below runs on the SQL with both removed.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0041_media_node_credential_last_verified.sql',
);

const COMMENT_ON_STATEMENT =
  /COMMENT ON COLUMN public\.media_node_credentials\.last_verified_at IS\s+'(?:[^']|'')*';/g;

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

/** Strips full-line and trailing `--` SQL comments. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Executable DDL only: `--` comments and the `COMMENT ON` statement removed. */
function executableSql(): string {
  return stripSqlComments(readSql()).replace(COMMENT_ON_STATEMENT, '');
}

function normalizeWhitespace(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('Migration 0041 — media_node_credentials.last_verified_at contract', () => {
  it('its only executable DDL is the one approved additive column', () => {
    expect(normalizeWhitespace(executableSql())).toBe(
      'ALTER TABLE public.media_node_credentials ADD COLUMN last_verified_at timestamptz NULL;',
    );
  });

  it('adds exactly one column, and it is last_verified_at', () => {
    const addColumns = [...executableSql().matchAll(/ADD COLUMN\s+(\w+)/gi)].map((m) => m[1]);
    expect(addColumns).toEqual(['last_verified_at']);
  });

  it('does not use IF NOT EXISTS — unexpected pre-existing schema must fail visibly', () => {
    expect(executableSql()).not.toMatch(/IF\s+NOT\s+EXISTS/i);
  });

  it('introduces no default or backfill', () => {
    const sql = executableSql();
    expect(sql).not.toMatch(/\bDEFAULT\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bNOT NULL\b/i);
  });

  it('changes no policy, grant, index, or RLS setting', () => {
    const sql = executableSql();
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/\bINDEX\b/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('contains no destructive or type-altering DDL', () => {
    const sql = executableSql();
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bALTER COLUMN\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    expect(sql).not.toMatch(/\bTYPE\b/i);
  });

  it('introduces no credential-material identifier in executable DDL', () => {
    expect(executableSql()).not.toMatch(/token|digest|pepper|secret|hash/i);
  });

  it('touches only public.media_node_credentials', () => {
    const tables = [...executableSql().matchAll(/ALTER TABLE\s+([\w.]+)/gi)].map((m) => m[1]);
    expect(tables).toEqual(['public.media_node_credentials']);
  });

  it('documents the column with exactly one COMMENT ON COLUMN statement', () => {
    const comments = stripSqlComments(readSql()).match(COMMENT_ON_STATEMENT) ?? [];
    expect(comments).toHaveLength(1);
    // Evidence semantics are recorded precisely: authentication-scoped, not
    // downstream-handler success, and never credential material.
    expect(comments[0]).toContain('uniquely identified active credential slot');
    expect(comments[0]).toContain('replay-nonce claim');
    expect(comments[0]).toContain('Does not indicate that the downstream handler succeeded');
  });
});
