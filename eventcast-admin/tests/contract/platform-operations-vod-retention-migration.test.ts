import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const sql = readFileSync(
  path.join(migrationsDir, '0035_platform_operations_vod_retention_foundation.sql'),
  'utf8'
);

/** The five tables 0035 creates. All are server/service-role-mediated surfaces. */
const NEW_TABLES = [
  'event_recordings',
  'platform_retention_policy',
  'studio_retention_overrides',
  'event_retention_extensions',
  'platform_audit_log',
] as const;

/** The four SECURITY DEFINER RPCs, with the exact identity arguments used in REVOKE/GRANT. */
const NEW_RPCS = [
  'freeze_event_retention(uuid)',
  'apply_event_retention_extension(uuid, timestamptz, text, uuid)',
  'apply_platform_retention_policy_update(integer, uuid)',
  'apply_studio_retention_override(uuid, integer, uuid)',
] as const;

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The migration's executable SQL with `--` line comments stripped. Privilege
 * assertions run against this so they match real GRANT/REVOKE statements
 * rather than prose that happens to mention "granted" or "TRUNCATE".
 */
const executableSql = sql.replace(/--[^\n]*/g, '');

describe('platform operations + VOD/retention migration contract (0035, local-only)', () => {
  it('event_recordings has a unique event_id (one authoritative row per event) and no client-facing RLS policy', () => {
    expect(sql).toMatch(/CREATE TABLE public\.event_recordings/);
    expect(sql).toMatch(/event_id uuid NOT NULL UNIQUE REFERENCES public\.events\(id\)/);
    expect(sql).toMatch(/ALTER TABLE public\.event_recordings ENABLE ROW LEVEL SECURITY;/);
    // No CREATE POLICY anywhere scoped to event_recordings.
    expect(sql).not.toMatch(/CREATE POLICY \w*event_recordings\w*/i);
    // The UNIQUE constraint already creates event_recordings_event_id_key —
    // no duplicate index is added on top of it.
    expect(sql).not.toMatch(/CREATE INDEX event_recordings_event_id_idx/);
  });

  it('event_recordings distinguishes local finalization from authoritative B2 finalization', () => {
    expect(sql).toMatch(/local_finalized_at timestamptz/);
    expect(sql).toMatch(/b2_finalized_at timestamptz/);
    expect(sql).toMatch(/integrity_verified_at timestamptz/);
    expect(sql).toMatch(/event_recordings_b2_finalized_requires_reference CHECK/);
    expect(sql).toMatch(/event_recordings_frozen_requires_b2_and_integrity CHECK/);
  });

  it('event_recordings enforces youtube_fallback_verified requires a URL, and frozen fields are internally consistent', () => {
    expect(sql).toMatch(/event_recordings_youtube_fallback_requires_url CHECK \(\s*NOT youtube_fallback_verified OR youtube_fallback_url IS NOT NULL/);
    expect(sql).toMatch(/event_recordings_frozen_fields_consistent CHECK/);
    expect(sql).toMatch(/retention_effective_days IS NOT NULL AND retention_effective_days > 0/);
    expect(sql).toMatch(/retention_expires_at > retention_frozen_at/);
  });

  it('platform_retention_policy is a true database singleton, seeded at 90 days', () => {
    expect(sql).toMatch(/CREATE TABLE public\.platform_retention_policy/);
    expect(sql).toMatch(/lock_key integer NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/CONSTRAINT platform_retention_policy_lock_key_fixed CHECK \(lock_key = 1\)/);
    expect(sql).toMatch(/CONSTRAINT platform_retention_policy_singleton UNIQUE \(lock_key\)/);
    expect(sql).toMatch(/default_retention_days integer NOT NULL DEFAULT 90 CHECK \(default_retention_days > 0\)/);
    expect(sql).toMatch(/INSERT INTO public\.platform_retention_policy \(default_retention_days\)\s*VALUES \(90\)/);
  });

  it('every retention/audit RPC is revoked from PUBLIC, anon, and authenticated', () => {
    for (const fn of NEW_RPCS) {
      const escaped = escapeRe(fn);
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC;`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM anon, authenticated;`));
    }
    // Ordinary roles are never granted EXECUTE back on any of the four.
    expect(executableSql).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  it('every retention/audit RPC explicitly grants EXECUTE to service_role', () => {
    // States the execution boundary in the migration itself rather than
    // depending on the Supabase project's default ACLs (convention set by
    // migrations 0025/0026).
    for (const fn of NEW_RPCS) {
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escapeRe(fn)} TO service_role;`)
      );
    }
  });

  it('no JWT-facing RLS policy is created on any of the five new tables', () => {
    // 0035 deliberately creates no policies at all: these are
    // server/service-role-mediated surfaces reached through
    // requireSuperAdmin()-gated routes and the sanitized provider recording
    // projection. The four previously-designed super-admin SELECT policies
    // must not be reintroduced.
    expect(executableSql).not.toMatch(/CREATE POLICY/i);
    expect(executableSql).not.toMatch(/DROP POLICY/i);
    for (const name of [
      'platform_retention_policy_super_admin_select',
      'studio_retention_overrides_super_admin_select',
      'event_retention_extensions_select',
      'platform_audit_log_super_admin_select',
    ]) {
      expect(sql).not.toMatch(new RegExp(escapeRe(name)));
    }
  });

  it('RLS is enabled on all five new tables', () => {
    for (const table of NEW_TABLES) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`)
      );
    }
  });

  it('ordinary roles receive no direct table privileges on any of the five new tables', () => {
    // Supabase's project default privileges hand every new public-schema
    // table to anon/authenticated as arwdDxtm. RLS blocks row DML, but
    // TRUNCATE is not RLS-governed — so the inherited grants are revoked
    // explicitly.
    for (const table of NEW_TABLES) {
      for (const role of ['PUBLIC', 'anon', 'authenticated']) {
        expect(sql).toMatch(
          new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM ${role};`)
        );
      }
    }
    // And nothing is granted back to an ordinary role.
    expect(executableSql).not.toMatch(/GRANT[^;]*ON TABLE[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  it('service_role table privileges are explicit, narrow, and never include TRUNCATE', () => {
    // Inherited arwdDxtm (which includes TRUNCATE) is revoked from
    // service_role too, then only what the already-implemented server-side
    // code needs is granted back.
    for (const table of NEW_TABLES) {
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM service_role;`)
      );
    }

    // src/lib/eventRecording.ts reads only; the retention-policy and
    // retention-override routes read only; platformAudit.ts appends audit
    // rows; nothing reads event_retention_extensions through PostgREST.
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.event_recordings TO service_role;/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.platform_retention_policy TO service_role;/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.studio_retention_overrides TO service_role;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON TABLE public\.platform_audit_log TO service_role;/);
    expect(executableSql).not.toMatch(/GRANT[^;]*ON TABLE public\.event_retention_extensions/);

    // No TRUNCATE, and no blanket ALL, anywhere in the table grants.
    expect(executableSql).not.toMatch(/GRANT[^;]*TRUNCATE/i);
    expect(executableSql).not.toMatch(/GRANT ALL[^;]*ON TABLE/i);
    // Audit rows stay append-only from the application's side.
    expect(executableSql).not.toMatch(
      /GRANT[^;]*(UPDATE|DELETE)[^;]*ON TABLE public\.platform_audit_log/i
    );
  });

  it('every actual SECURITY DEFINER function definition uses a fixed safe search_path', () => {
    // Matches only real function definitions (LANGUAGE plpgsql / SECURITY
    // DEFINER / SET search_path appearing together), not the module doc
    // comment's prose mention of "SECURITY DEFINER".
    const definerBlocks = sql.match(/LANGUAGE plpgsql\nSECURITY DEFINER\n[\s\S]{0,60}/g) ?? [];
    expect(definerBlocks.length).toBe(4);
    for (const block of definerBlocks) {
      expect(block).toMatch(/SET search_path = public, pg_temp/);
    }
  });

  it('the three Super-Admin-initiated RPCs re-verify the actor is a super_admin as defense-in-depth', () => {
    for (const fn of ['apply_event_retention_extension', 'apply_platform_retention_policy_update', 'apply_studio_retention_override']) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const block = sql.slice(start, start + 1200);
      expect(block).toMatch(/platform_users pu\s*\n\s*WHERE pu\.user_id = p_actor AND pu\.platform_role = 'super_admin'/);
    }
    // freeze_event_retention is system/finalization-pipeline-initiated, not
    // a person clicking a button — it deliberately does not check p_actor.
    const freezeStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.freeze_event_retention');
    const freezeBlock = sql.slice(freezeStart, freezeStart + 200);
    expect(freezeBlock).not.toMatch(/p_actor/);
  });

  it('apply_event_retention_extension requires retention already frozen and a strictly later, non-empty-reason extension', () => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.apply_event_retention_extension');
    const block = sql.slice(start, start + 2500);
    expect(block).toMatch(/retention_frozen_at IS NULL OR v_row\.retention_expires_at IS NULL/);
    expect(block).toMatch(/p_new_expires_at <= v_row\.retention_expires_at/);
    expect(block).toMatch(/btrim\(coalesce\(p_reason, ''\)\)/);
  });

  it('freeze_event_retention resolves effective days from the studio override before the global default, and uses GREATEST for the freeze timestamp', () => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.freeze_event_retention');
    const block = sql.slice(start, start + 2500);
    const overrideIdx = block.indexOf('studio_retention_overrides');
    const defaultIdx = block.indexOf('platform_retention_policy');
    expect(overrideIdx).toBeGreaterThan(0);
    expect(defaultIdx).toBeGreaterThan(overrideIdx);
    expect(block).toMatch(/GREATEST\(v_row\.b2_finalized_at, v_row\.integrity_verified_at\)/);
  });

  it('extension, override, and policy-update RPCs each insert their platform_audit_log row in the same transaction as their business mutation', () => {
    for (const fn of ['apply_event_retention_extension', 'apply_platform_retention_policy_update', 'apply_studio_retention_override']) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`);
      const end = sql.indexOf('$$;', start);
      const block = sql.slice(start, end);
      expect(block).toMatch(/INSERT INTO public\.platform_audit_log/);
    }
  });

  it('does not touch events, page_state, event_visibility, photographers, or Restreamer/GrapesJS objects', () => {
    // The migration's own header/footer comments mention "photographers"/
    // "Restreamer"/"GrapesJS" only to document that they are explicitly
    // out of scope — so this asserts no actual DDL/DML touches those
    // objects, not that the words never appear in a comment.
    expect(sql).not.toMatch(/ALTER TABLE public\.events\b/i);
    expect(sql).not.toMatch(/(?:ALTER|DROP|CREATE)\s+(?:TABLE|POLICY)[^;]*\bphotographers\b/i);
    expect(sql).not.toMatch(/(?:ALTER|DROP|CREATE)\s+(?:TABLE|POLICY)[^;]*restreamer/i);
    expect(sql).not.toMatch(/(?:ALTER|DROP|CREATE)\s+(?:TABLE|POLICY)[^;]*grapesjs/i);
  });
});
