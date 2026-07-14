import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only contract checks for the Media Agent migration sequence
 * repair: migration 0019's original design (media_nodes, stream_sessions,
 * media_jobs, event_state_transitions) conflicted with 0020's own
 * `CREATE TABLE public.media_nodes` (no `IF NOT EXISTS`) — see
 * eventcast-admin/supabase/migrations/0019_livestream_control_plane.sql and
 * eventcast-admin/supabase/migrations/0020_media_agent_assignments.sql for
 * the full history. These checks guard against that conflict silently
 * coming back (e.g. someone reverting 0019 to its original content).
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const supersededDir = path.join(repoRoot, 'supabase', 'superseded-migrations');

const activeMigration0019Path = path.join(migrationsDir, '0019_livestream_control_plane.sql');
const archivedOriginal0019Path = path.join(
  supersededDir,
  '0019_livestream_control_plane.original.sql',
);

const CONFLICTING_TABLE_NAMES = ['media_nodes', 'stream_sessions', 'media_jobs', 'event_state_transitions'];

function readSql(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

/**
 * Strips full-line and trailing `--` SQL comments so assertions about
 * actual executable statements aren't fooled by explanatory prose in
 * comments (e.g. this file's own no-op migration documents, in comments,
 * the exact table names and ALTER TABLE it must never actually execute).
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('Migration 0019 supersession contract', () => {
  it('the active 0019 migration file exists inside supabase/migrations', () => {
    expect(existsSync(activeMigration0019Path)).toBe(true);
  });

  it('the active 0019 migration creates none of the original conflicting tables', () => {
    const sql = stripSqlComments(readSql(activeMigration0019Path));
    for (const table of CONFLICTING_TABLE_NAMES) {
      expect(sql).not.toMatch(new RegExp(`CREATE TABLE[^;]*\\b${table}\\b`, 'i'));
    }
  });

  it('the active 0019 migration does not ALTER TABLE events', () => {
    const sql = stripSqlComments(readSql(activeMigration0019Path));
    expect(sql).not.toMatch(/ALTER TABLE\s+events\b/i);
  });

  it('the active 0019 migration makes no schema or data changes beyond a notice', () => {
    const sql = stripSqlComments(readSql(activeMigration0019Path));
    // Only a single DO block (RAISE NOTICE) is expected as executable SQL —
    // no CREATE/ALTER/DROP/INSERT/UPDATE/DELETE statement of any kind.
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\s+(TABLE|INDEX|FUNCTION|TRIGGER|POLICY|TYPE)\b/i);
    expect(sql).toMatch(/DO\s+\$\$/);
    expect(sql).toMatch(/RAISE NOTICE/i);
  });

  it('the archived original 0019 SQL exists only outside the active migrations directory', () => {
    expect(existsSync(archivedOriginal0019Path)).toBe(true);
    expect(path.dirname(archivedOriginal0019Path)).not.toBe(migrationsDir);
  });

  it('the archived original 0019 SQL preserves the original conflicting table definitions', () => {
    const sql = stripSqlComments(readSql(archivedOriginal0019Path));
    for (const table of CONFLICTING_TABLE_NAMES) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE[^;]*\\b${table}\\b`, 'i'));
    }
  });

  it('0020 remains the sole active migration that creates public.media_nodes', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const creators = migrationFiles.filter((file) => {
      const sql = stripSqlComments(readSql(path.join(migrationsDir, file)));
      return /CREATE TABLE\s+(public\.)?media_nodes\b/i.test(sql);
    });

    expect(creators).toEqual(['0020_media_agent_assignments.sql']);
  });
});
