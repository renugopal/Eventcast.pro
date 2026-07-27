import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const schemaSql = readFileSync(path.join(migrationsDir, '0027_event_visibility_schema.sql'), 'utf8');
const policySql = readFileSync(path.join(migrationsDir, '0028_event_visibility_policy_lockdown.sql'), 'utf8');

function executableSql(sql: string): string {
  return sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
}

describe('event visibility migration contract', () => {
  it('0027 adds, backfills, constrains, and defaults event_visibility without changing RLS', () => {
    const sql = executableSql(schemaSql);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/ADD COLUMN event_visibility varchar/i);
    expect(sql).toMatch(/SET event_visibility = 'public'/);
    expect(sql).toMatch(/event_visibility IS NULL/);
    expect(sql).toMatch(/CHECK \(event_visibility IN \('public', 'private', 'synthetic'\)\)/);
    expect(sql).toMatch(/ALTER COLUMN event_visibility SET NOT NULL/i);
    expect(sql).toMatch(/ALTER COLUMN event_visibility SET DEFAULT 'public'/i);
    expect(sql).toMatch(/COMMIT;/);
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/privacy_status/i);
  });

  it('0028 removes both broad events policies and preserves the canonical studio policies', () => {
    const sql = executableSql(policySql);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Public can view events" ON public\.events;/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Admin full access on events" ON public\.events;/);
    for (const policy of ['events_select_policy', 'events_insert_policy', 'events_update_policy', 'events_delete_policy']) {
      expect(sql).not.toMatch(new RegExp(`DROP POLICY[^;]*${policy}`, 'i'));
    }
  });

  it('0028 limits every public event-facing policy to public, unarchived events', () => {
    const sql = executableSql(policySql);
    expect(sql).toMatch(/CREATE POLICY events_public_select_policy[\s\S]*?TO anon, authenticated[\s\S]*?event_visibility = 'public'[\s\S]*?archived_at IS NULL/);
    for (const policy of [
      'wishes_insert_policy',
      'wishes_select_policy',
      'page_views_insert_policy',
      'guest_photos_public_insert',
      'guest_photos_public_select',
    ]) {
      const start = sql.indexOf(`CREATE POLICY ${policy}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const block = sql.slice(start, start + 900);
      expect(block).toContain("event_row.event_visibility = 'public'");
      expect(block).toContain('event_row.archived_at IS NULL');
    }
    expect(sql).toMatch(/guest_photos_public_select[\s\S]*?approved = true/);
  });

  it('0028 is guarded by the 0027 column and check-constraint contract', () => {
    const sql = executableSql(policySql);
    expect(sql).toContain('events_event_visibility_check');
    expect(sql).toContain('event_visibility is not ready for policy lockdown');
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
  });
});
