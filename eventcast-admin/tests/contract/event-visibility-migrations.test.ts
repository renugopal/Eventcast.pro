import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const schemaSql = readFileSync(path.join(migrationsDir, '0027_event_visibility_schema.sql'), 'utf8');
const policySql = readFileSync(path.join(migrationsDir, '0028_event_visibility_policy_lockdown.sql'), 'utf8');
const unlistedSql = readFileSync(path.join(migrationsDir, '0031_event_visibility_unlisted_value.sql'), 'utf8');
const childPolicySql = readFileSync(
  path.join(migrationsDir, '0032_visibility_child_policy_unlisted_eligibility.sql'),
  'utf8'
);
const wishesModerationSql = readFileSync(
  path.join(migrationsDir, '0033_wishes_moderation_schema.sql'),
  'utf8'
);

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

  // 0031 — Visibility Foundation Gate: widens events_event_visibility_check
  // to add 'unlisted' alongside the legacy public/private/synthetic values.
  // Deliberately does NOT touch events_public_select_policy — anonymous
  // Supabase SELECT access stays Public-only; Unlisted direct-link delivery
  // is provided only by the service-role public render Worker.
  it('0031 widens the exact verified constraint name to include unlisted alongside the legacy values', () => {
    const sql = executableSql(unlistedSql);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/DROP CONSTRAINT\s+events_event_visibility_check/);
    expect(sql).toMatch(
      /ADD CONSTRAINT\s+events_event_visibility_check\s+CHECK\s*\(\s*event_visibility\s+IN\s*\(\s*'public'\s*,\s*'private'\s*,\s*'synthetic'\s*,\s*'unlisted'\s*\)\s*\)/
    );
    expect(sql).toMatch(/COMMIT;/);
  });

  it('0031 does not widen events_public_select_policy, touch any other policy, or reclassify existing rows', () => {
    const sql = executableSql(unlistedSql);
    expect(sql).not.toMatch(/events_public_select_policy/);
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.events/i);
    expect(sql).not.toMatch(/SET DEFAULT/i);
    expect(sql).not.toMatch(/RENAME COLUMN/i);
    expect(sql).not.toMatch(/privacy_status/i);
  });

  it('0031 is guarded against running before the constraint exists or after unlisted is already present', () => {
    const sql = executableSql(unlistedSql);
    expect(sql).toContain('events_event_visibility_check is missing');
    expect(sql).toContain('events_event_visibility_check already allows unlisted');
  });

  // 0032 — narrow compatibility correction: the five guest-engagement
  // child-table policies 0028 created (wishes/page_views/guest_photos) are
  // ordinary page-runtime actions scoped to a known event_id, not a
  // discovery surface, so they should accept Published + Unlisted on the
  // same terms as Published + Public. 0028 predates page_state entirely, so
  // this migration adds page_state = 'published' to all five at the same
  // time it widens event_visibility — omitting that would have made every
  // Draft (event_visibility defaults to 'unlisted') anonymously writable.
  const CHILD_POLICIES = [
    ['wishes', 'wishes_insert_policy'],
    ['wishes', 'wishes_select_policy'],
    ['page_views', 'page_views_insert_policy'],
    ['guest_photos', 'guest_photos_public_insert'],
    ['guest_photos', 'guest_photos_public_select'],
  ] as const;

  it('0032 replaces exactly the five 0028 child policies, each requiring published + (public or unlisted) + unarchived', () => {
    const sql = executableSql(childPolicySql);
    for (const [table, policy] of CHILD_POLICIES) {
      expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS ${policy} ON public\\.${table};`));
      const start = sql.indexOf(`CREATE POLICY ${policy}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const block = sql.slice(start, start + 700);
      expect(block).toContain("event_row.page_state = 'published'");
      expect(block).toContain("event_row.event_visibility IN ('public', 'unlisted')");
      expect(block).toContain('event_row.archived_at IS NULL');
    }
    expect(sql).toMatch(/guest_photos_public_select[\s\S]*?approved = true/);
  });

  it('0032 does not widen events_public_select_policy, touch migration 0028, or allow private/synthetic', () => {
    const sql = executableSql(childPolicySql);
    expect(sql).not.toMatch(/CREATE POLICY events_public_select_policy/);
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS events_public_select_policy/);
    expect(sql).not.toMatch(/'private'/);
    expect(sql).not.toMatch(/'synthetic'/);
  });

  it('0032 touches only the five named policies on wishes, page_views, and guest_photos — no other table or policy', () => {
    const sql = executableSql(childPolicySql);
    const droppedPolicies = new Set(
      [...sql.matchAll(/DROP POLICY IF EXISTS (\S+) ON (public\.\w+);/g)].map((m) => `${m[2]}.${m[1]}`)
    );
    const expected = new Set(CHILD_POLICIES.map(([table, policy]) => `public.${table}.${policy}`));
    expect(droppedPolicies).toEqual(expected);
  });

  it('0032 is guarded against running before 0029 (page_state) or 0031 (unlisted) are applied', () => {
    const sql = executableSql(childPolicySql);
    expect(sql).toContain('page_state is missing');
    expect(sql).toContain('does not yet allow unlisted');
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
  });
});

// 0033 — Media + Engagement Core: adds the two columns needed to represent
// Wishes moderation (WISH-002) truthfully, and widens wishes_select_policy
// (public anonymous read) to also require status = 'approved', so a
// provider's hide/reject action actually removes a wish from the public
// page. Default 'approved' preserves today's "wish appears immediately"
// behavior exactly — there is no per-event Wishes moderation-mode toggle
// (unlike Guest Memories/GM-004).
describe('wishes moderation migration contract (0033)', () => {
  it('adds status (default approved, checked) and is_pinned (default false) additively', () => {
    const sql = executableSql(wishesModerationSql);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(
      /ADD COLUMN status text NOT NULL DEFAULT 'approved'\s*\n?\s*CHECK \(status IN \('approved', 'hidden', 'rejected'\)\)/
    );
    expect(sql).toMatch(/ADD COLUMN is_pinned boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/COMMIT;/);
  });

  it('widens exactly wishes_select_policy to additionally require status = \'approved\', preserving the 0032 published+visibility conditions', () => {
    const sql = executableSql(wishesModerationSql);
    expect(sql).toMatch(/DROP POLICY IF EXISTS wishes_select_policy ON public\.wishes;/);
    const start = sql.indexOf('CREATE POLICY wishes_select_policy');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = sql.slice(start, start + 700);
    expect(block).toContain("status = 'approved'");
    expect(block).toContain("event_row.page_state = 'published'");
    expect(block).toContain("event_row.event_visibility IN ('public', 'unlisted')");
    expect(block).toContain('event_row.archived_at IS NULL');
  });

  it('does not touch wishes_insert_policy, wishes_delete_policy, or any other table/policy', () => {
    const sql = executableSql(wishesModerationSql);
    expect(sql).not.toMatch(/wishes_insert_policy/);
    expect(sql).not.toMatch(/wishes_delete_policy/);
    expect(sql).not.toMatch(/guest_photos|page_views|events_public_select_policy/);
  });

  it('is guarded against running twice or before wishes_select_policy exists', () => {
    const sql = executableSql(wishesModerationSql);
    expect(sql).toContain('already exists; refusing to run this migration twice');
    expect(sql).toContain('wishes_select_policy is missing');
  });
});
