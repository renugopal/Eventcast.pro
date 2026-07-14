import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static, read-only contract checks for migration 0023 — reconciliation of
 * public.subscription_notifications / public.plan_limits /
 * public.addon_pricing with verified production reality (see
 * 0023_reconcile_subscription_notifications_rls.sql for the full remote-
 * audit history). These checks guard against the migration accidentally
 * touching a table/column/index beyond what was reviewed and approved, or
 * regressing to a data-mutating or policy-changing statement.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '0023_reconcile_subscription_notifications_rls.sql',
);

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

/** Strips full-line and trailing `--` SQL comments so assertions about
 * actual executable statements aren't fooled by explanatory prose in
 * comments (this migration's own header names every object it discusses).
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('Migration 0023 — subscription_notifications/RLS reconciliation contract', () => {
  it('adds notification_date as date NOT NULL DEFAULT CURRENT_DATE with IF NOT EXISTS', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).toMatch(
      /ALTER TABLE public\.subscription_notifications\s+ADD COLUMN IF NOT EXISTS notification_date date NOT NULL DEFAULT CURRENT_DATE;/i,
    );
  });

  it('drops sub_notif_unique_per_day before recreating it', () => {
    const sql = stripSqlComments(readSql());
    const dropIndex = sql.search(/DROP INDEX IF EXISTS public\.sub_notif_unique_per_day;/i);
    const createIndex = sql.search(/CREATE UNIQUE INDEX sub_notif_unique_per_day/i);
    expect(dropIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(dropIndex);
  });

  it('recreates sub_notif_unique_per_day as UNIQUE on exactly the four physical columns', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX sub_notif_unique_per_day\s+ON public\.subscription_notifications \(studio_id, notification_type, channel, notification_date\);/i,
    );
    // Must not be the original 0015 expression-index shape.
    expect(sql).not.toMatch(/sent_at::date/i);
    expect(sql).not.toMatch(/\(sent_at\)/i);
  });

  it('enables RLS on exactly the three approved tables, no more, no fewer', () => {
    const sql = stripSqlComments(readSql());
    const enabledTables = [...sql.matchAll(/ALTER TABLE (public\.\w+) ENABLE ROW LEVEL SECURITY;/gi)].map(
      (m) => m[1],
    );
    expect(new Set(enabledTables)).toEqual(
      new Set(['public.plan_limits', 'public.addon_pricing', 'public.subscription_notifications']),
    );
    expect(enabledTables).toHaveLength(3);
  });

  it('contains no CREATE POLICY, ALTER POLICY, or DROP POLICY statement', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/\bPOLICY\b/i);
  });

  it('contains no GRANT or REVOKE statement', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
  });

  it('contains no data mutation or destructive DDL statement', () => {
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDROP TABLE\b/i);
  });

  it('does not modify migration 0015 or any application source file', () => {
    // This migration must be a standalone new file — it must never itself
    // reference editing 0015's file, and by construction (a fresh file)
    // cannot touch application code; this test guards the SQL content only.
    const sql = stripSqlComments(readSql());
    expect(sql).not.toMatch(/CREATE TABLE\b/i);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION\b/i);
    expect(sql).not.toMatch(/CREATE TRIGGER\b/i);
  });

  it('only touches subscription_notifications, plan_limits, and addon_pricing — no other table', () => {
    const sql = stripSqlComments(readSql());
    const alterTables = [...sql.matchAll(/ALTER TABLE (public\.\w+)/gi)].map((m) => m[1]);
    const indexTables = [...sql.matchAll(/ON (public\.\w+) \(/gi)].map((m) => m[1]);
    const dropIndexTargets = [...sql.matchAll(/DROP INDEX IF EXISTS (public\.\w+);/gi)].map((m) => m[1]);

    const touchedTables = new Set(alterTables);
    for (const t of indexTables) touchedTables.add(t);
    expect(touchedTables).toEqual(
      new Set(['public.subscription_notifications', 'public.plan_limits', 'public.addon_pricing']),
    );
    // The only index touched, by name, is sub_notif_unique_per_day.
    expect(dropIndexTargets).toEqual(['public.sub_notif_unique_per_day']);
  });
});
