import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const sql = readFileSync(path.join(migrationsDir, '0034_analytics_support_auth_foundation.sql'), 'utf8');

function executableSql(source: string): string {
  return source.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
}

const body = executableSql(sql);

const NEW_TABLES = [
  'event_audience_heartbeats',
  'support_tickets',
  'support_ticket_messages',
  'notifications',
] as const;

// Section anchors must be executable statements: `executableSql` strips
// every `--` comment, so the migration's comment banners are not present.
const HEARTBEAT_ANCHOR = 'CREATE OR REPLACE FUNCTION public.event_audience_heartbeat_bucket';
const STUDIO_GUARD_ANCHOR = 'CREATE OR REPLACE FUNCTION public.enforce_event_belongs_to_studio()';
const TICKETS_ANCHOR = 'CREATE TABLE IF NOT EXISTS public.support_tickets';
const NOTIFICATIONS_ANCHOR = 'CREATE TABLE IF NOT EXISTS public.notifications';

function sectionBetween(from: string, to: string): string {
  const start = body.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = to ? body.indexOf(to) : body.length;
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe('migration 0034 — analytics/support/auth foundation contract', () => {
  it('is wrapped in a transaction and guarded against missing prerequisites', () => {
    expect(body).toMatch(/BEGIN;/);
    expect(body).toMatch(/COMMIT;/);
    expect(body).toMatch(/page_state is missing/);
    expect(body).toMatch(/does not yet allow unlisted/);
    expect(body).toMatch(/media_event_assignments is missing/);
  });

  it('uses only gen_random_uuid() for uuid defaults', () => {
    expect(body).toContain('gen_random_uuid()');
    expect(body).not.toMatch(/uuid_generate_v4/);
  });

  it('adds page_views.visitor_id as a nullable, additive column only', () => {
    expect(body).toMatch(/ALTER TABLE public\.page_views\s+ADD COLUMN IF NOT EXISTS visitor_id text NULL;/);
    // Must not touch the existing insert policy or make the column NOT NULL.
    expect(body).not.toMatch(/visitor_id text NOT NULL/);
    expect(body).not.toMatch(/DROP POLICY[^;]*page_views_insert_policy/);
  });

  describe('event_audience_heartbeats — measurement integrity', () => {
    const heartbeatSection = () => sectionBetween(HEARTBEAT_ANCHOR, STUDIO_GUARD_ANCHOR);

    it('gives anon and authenticated no direct write path to the table', () => {
      const section = heartbeatSection();
      // The pre-apply review's blocker A: no direct anonymous INSERT design.
      expect(body).not.toMatch(/CREATE POLICY event_audience_heartbeats_insert_policy/);
      expect(section).toContain('REVOKE ALL ON TABLE public.event_audience_heartbeats FROM anon;');
      expect(section).toContain('REVOKE ALL ON TABLE public.event_audience_heartbeats FROM authenticated;');
      // Read stays studio-scoped and authenticated-only; anon gets nothing.
      expect(section).toContain('GRANT SELECT ON TABLE public.event_audience_heartbeats TO authenticated;');
      expect(section).not.toMatch(/GRANT[^;]*ON TABLE public\.event_audience_heartbeats TO[^;]*anon/);
    });

    it('types viewer/session identifiers as uuid and derives the bucket from server time only', () => {
      const section = heartbeatSection();
      expect(section).toMatch(/viewer_id\s+uuid NOT NULL/);
      expect(section).toMatch(/session_id uuid NOT NULL/);
      expect(section).toMatch(/bucket_started_at timestamptz NOT NULL/);
      expect(section).toContain('public.event_audience_heartbeat_bucket(now())');
      // The bucket helper floors to the 20-second heartbeat cadence.
      expect(section).toMatch(/date_part\('epoch', p_at\) \/ 20\) \* 20/);
    });

    it('enforces at most one accepted heartbeat per session per bucket', () => {
      const section = heartbeatSection();
      expect(section).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_event_audience_heartbeats_session_bucket'
      );
      expect(section).toMatch(
        /uq_event_audience_heartbeats_session_bucket\s+ON public\.event_audience_heartbeats \(event_id, session_id, bucket_started_at\);/
      );
      expect(section).toContain('ON CONFLICT (event_id, session_id, bucket_started_at) DO NOTHING');
    });

    it('checks event eligibility inside the SECURITY DEFINER RPC with a fail-closed search_path', () => {
      const rpcStart = body.indexOf('CREATE OR REPLACE FUNCTION public.record_event_audience_heartbeat');
      expect(rpcStart).toBeGreaterThanOrEqual(0);
      const rpc = body.slice(rpcStart, body.indexOf('COMMENT ON FUNCTION public.record_event_audience_heartbeat'));

      expect(rpc).toContain('SECURITY DEFINER');
      expect(rpc).toContain("SET search_path = ''");
      expect(rpc).toMatch(/p_event_id\s+uuid/);
      expect(rpc).toMatch(/p_viewer_id\s+uuid/);
      expect(rpc).toMatch(/p_session_id uuid/);
      // Never returns raw heartbeat rows.
      expect(rpc).toContain('RETURNS boolean');

      // Guest playback eligibility, checked as the definer so the
      // service-role-only assignment table is actually readable.
      expect(rpc).toContain("event_row.page_state = 'published'");
      expect(rpc).toContain("event_row.event_visibility IN ('public', 'unlisted')");
      expect(rpc).toContain('event_row.archived_at IS NULL');
      expect(rpc).toContain('public.media_event_assignments');
      expect(rpc).toContain('assignment_row.enabled = true');

      // Every referenced object is schema-qualified (search_path is empty).
      expect(rpc).not.toMatch(/FROM events\b/);
      expect(rpc).not.toMatch(/INTO event_audience_heartbeats\b/);
    });

    it('grants EXECUTE on the RPC only to the public player roles', () => {
      const signature = 'public.record_event_audience_heartbeat(uuid, uuid, uuid)';
      expect(body).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
      expect(body).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`);
      expect(body).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM authenticated;`);
      expect(body).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO anon, authenticated;`);

      const revokeAt = body.indexOf(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
      const grantAt = body.indexOf(`GRANT EXECUTE ON FUNCTION ${signature} TO anon, authenticated;`);
      expect(revokeAt).toBeLessThan(grantAt);
    });

    it('keeps raw heartbeat reads studio-scoped and never anonymous', () => {
      const selectBlock = sectionBetween(
        'CREATE POLICY event_audience_heartbeats_select_policy',
        'REVOKE ALL ON TABLE public.event_audience_heartbeats FROM anon;'
      );
      expect(selectBlock).toContain('TO authenticated');
      expect(selectBlock).not.toContain('anon');
      expect(selectBlock).toContain('studio_members');
    });
  });

  describe('support tickets — ownership and history preservation', () => {
    const ticketsSection = () => sectionBetween(TICKETS_ANCHOR, NOTIFICATIONS_ANCHOR);

    it('is authenticated-only with no anonymous policy', () => {
      expect(ticketsSection()).not.toMatch(/TO anon/);
      expect(ticketsSection()).toContain("CHECK (category IN ('general', 'urgent_live'))");
      expect(ticketsSection()).toContain("CHECK (status IN ('open', 'closed'))");
    });

    it('exposes no direct authenticated mutation surface — server-mediated only', () => {
      const section = ticketsSection();
      expect(body).not.toMatch(/CREATE POLICY support_tickets_insert_policy/);
      expect(body).not.toMatch(/CREATE POLICY support_tickets_update_policy/);
      expect(body).not.toMatch(/CREATE POLICY support_ticket_messages_insert_policy/);
      for (const table of ['support_tickets', 'support_ticket_messages']) {
        expect(section).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon;`);
        expect(section).toContain(`REVOKE ALL ON TABLE public.${table} FROM authenticated;`);
        expect(section).toContain(`GRANT SELECT ON TABLE public.${table} TO authenticated;`);
      }
    });

    it('enforces same-studio event linkage in the database, not only in the API route', () => {
      expect(body).toContain('CREATE OR REPLACE FUNCTION public.enforce_event_belongs_to_studio()');
      const guard = sectionBetween(STUDIO_GUARD_ANCHOR, TICKETS_ANCHOR);
      expect(guard).toContain('SECURITY DEFINER');
      expect(guard).toContain("SET search_path = ''");
      expect(guard).toContain('event_row.studio_id = NEW.studio_id');
      expect(guard).toContain('linked event must belong to the same studio');

      expect(body).toMatch(
        /CREATE TRIGGER support_tickets_event_studio_match\s+BEFORE INSERT OR UPDATE OF event_id, studio_id ON public\.support_tickets/
      );
      expect(body).toMatch(
        /CREATE TRIGGER notifications_event_studio_match\s+BEFORE INSERT OR UPDATE OF event_id, studio_id ON public\.notifications/
      );
    });

    it('preserves support history when an Auth user or an event is deleted', () => {
      const section = ticketsSection();
      expect(section).toMatch(/created_by_user_id uuid NULL REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
      expect(section).toMatch(/author_user_id\s+uuid NULL REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
      expect(section).not.toMatch(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
      // An event going away nulls the association; it never deletes the ticket.
      expect(section).toMatch(/event_id\s+uuid NULL REFERENCES public\.events\(id\) ON DELETE SET NULL/);
    });
  });

  describe('notifications — server-only creation, mark-read only mutation', () => {
    const notificationsSection = () => body.slice(body.indexOf(NOTIFICATIONS_ANCHOR));

    it('has select/update-only policies and no anon/authenticated insert path', () => {
      const section = notificationsSection();
      expect(section).toMatch(/CREATE POLICY notifications_select_policy/);
      expect(section).toMatch(/CREATE POLICY notifications_update_policy/);
      expect(body).not.toMatch(/CREATE POLICY notifications_insert_policy/);
      expect(section).toContain('REVOKE ALL ON TABLE public.notifications FROM anon;');
      expect(section).toContain('REVOKE ALL ON TABLE public.notifications FROM authenticated;');
      expect(section).not.toMatch(/GRANT INSERT[^;]*public\.notifications/);
    });

    it('restricts provider mutation to the read_at column', () => {
      const section = notificationsSection();
      expect(section).toContain('GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;');
      // No blanket UPDATE grant that would allow rewriting title/body/severity.
      expect(section).not.toMatch(/GRANT UPDATE ON TABLE public\.notifications/);
    });

    it('keeps the retry-safe partial dedup unique index', () => {
      const section = notificationsSection();
      expect(section).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_studio_dedup_key');
      expect(section).toContain('WHERE dedup_key IS NOT NULL');
    });
  });

  it('enables RLS on every new table', () => {
    for (const table of NEW_TABLES) {
      expect(body).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    }
  });

  it('is retry-safe: every new object is created idempotently', () => {
    for (const table of NEW_TABLES) {
      expect(body).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    }
    // No bare CREATE INDEX / CREATE TRIGGER without an idempotency guard.
    expect(body).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    for (const match of body.matchAll(/CREATE TRIGGER (\w+)/g)) {
      expect(body).toContain(`DROP TRIGGER IF EXISTS ${match[1]}`);
    }
    for (const match of body.matchAll(/CREATE POLICY (\w+)/g)) {
      expect(body).toContain(`DROP POLICY IF EXISTS ${match[1]}`);
    }
    expect(body).not.toMatch(/CREATE FUNCTION /);
  });

  it('does not touch any pre-existing table, policy, or trigger outside the four additions', () => {
    // Every DROP POLICY in this migration is a retry guard for a policy this
    // same migration then recreates on one of its own new tables.
    const droppedPolicyTables = [...body.matchAll(/DROP POLICY IF EXISTS \w+ ON public\.(\w+);/g)].map((m) => m[1]);
    expect(droppedPolicyTables.length).toBeGreaterThan(0);
    for (const table of droppedPolicyTables) {
      expect(NEW_TABLES).toContain(table as (typeof NEW_TABLES)[number]);
    }

    const droppedTriggerTables = [...body.matchAll(/DROP TRIGGER IF EXISTS \w+ ON public\.(\w+);/g)].map((m) => m[1]);
    for (const table of droppedTriggerTables) {
      expect(NEW_TABLES).toContain(table as (typeof NEW_TABLES)[number]);
    }

    expect(body).not.toMatch(/ALTER TABLE public\.events\b/);
    expect(body).not.toMatch(/ALTER TABLE public\.wishes\b/);
    expect(body).not.toMatch(/ALTER TABLE public\.guest_photos\b/);
    expect(body).not.toMatch(/ALTER TABLE public\.media_event_assignments\b/);
    // page_views is only ever ADD COLUMN IF NOT EXISTS.
    const pageViewsAlters = [...body.matchAll(/ALTER TABLE public\.page_views([\s\S]*?);/g)].map((m) => m[1]);
    expect(pageViewsAlters).toHaveLength(1);
    expect(pageViewsAlters[0]).toContain('ADD COLUMN IF NOT EXISTS visitor_id text NULL');
  });
});
