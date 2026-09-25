import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only contract checks for migration 0042 — S3 containment of
 * the legacy `public.events.youtube_stream_key` exposure. The migration must
 * null the stored values without ever reading or returning them, forbid any
 * future non-empty value, and stay narrowly scoped (no grant/policy rewrite,
 * no column drop in this hotfix).
 *
 * The header comments and the `COMMENT ON COLUMN` text legitimately mention
 * SELECT/grants/drop, so every executable-statement check runs on the SQL
 * with both removed.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0042_retire_legacy_events_youtube_stream_key.sql',
);

const COMMENT_ON_STATEMENT =
  /COMMENT ON COLUMN public\.events\.youtube_stream_key IS\s+'(?:[^']|'')*';/g;

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function executableSql(): string {
  return stripSqlComments(readSql()).replace(COMMENT_ON_STATEMENT, '');
}

function normalizeWhitespace(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('Migration 0042 — retire legacy events.youtube_stream_key (S3 containment)', () => {
  it('its only executable statements are the null-out UPDATE and the retirement CHECK', () => {
    expect(normalizeWhitespace(executableSql())).toBe(
      'UPDATE public.events SET youtube_stream_key = NULL WHERE youtube_stream_key IS NOT NULL; ' +
        'ALTER TABLE public.events ADD CONSTRAINT events_youtube_stream_key_retired_chk ' +
        "CHECK (youtube_stream_key IS NULL OR btrim(youtube_stream_key) = '');",
    );
  });

  it('never reads or returns the legacy values', () => {
    const sql = executableSql();
    expect(sql).not.toMatch(/\bSELECT\b/i);
    expect(sql).not.toMatch(/\bRETURNING\b/i);
    expect(sql).not.toMatch(/\bRAISE\b/i);
    expect(sql).not.toMatch(/\bCOPY\b/i);
  });

  it('only ever writes NULL into the column', () => {
    const sets = [...executableSql().matchAll(/SET\s+youtube_stream_key\s*=\s*([^\s;]+)/gi)].map((m) => m[1]);
    expect(sets).toEqual(['NULL']);
  });

  it('does not drop the column, rewrite grants/policies, or touch any other table', () => {
    const sql = executableSql();
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    const tables = [...sql.matchAll(/(?:UPDATE|ALTER TABLE)\s+([\w.]+)/gi)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['public.events']));
  });

  it('does not use IF NOT EXISTS — unexpected pre-existing schema must fail visibly', () => {
    expect(executableSql()).not.toMatch(/IF\s+NOT\s+EXISTS/i);
  });

  it('documents the retired column', () => {
    expect(readSql()).toMatch(COMMENT_ON_STATEMENT);
  });
});
