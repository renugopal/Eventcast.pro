-- Platform Operations + VOD/Retention foundation (local design only — NOT
-- applied to the linked Supabase project as part of this task).
--
-- Baseline V2.1 §15 (Super Admin Operations Console) and §16 (Recording,
-- VOD, and page retention), Decision Register STO-001..STO-008.
--
-- Recording/VOD/retention state is a dedicated, additive model — it never
-- overloads events.status, events.page_state, or events.event_visibility.
-- Local Media Agent finalization (livestream-infra's own SQLite
-- vod_finalizations) and authoritative B2 finalization are represented as
-- explicitly distinct evidence and are never conflated: a non-null
-- b2_object_key alone is never treated as proof of successful B2
-- finalization, and retention never freezes on local finalization alone.
--
-- Cardinality: event_recordings.event_id is UNIQUE (one authoritative row
-- per event), matching the Media Agent's own vod_finalizations model
-- (internal/store/vod.go: UpsertVODFinalized does
-- INSERT ... ON CONFLICT(event_id) DO UPDATE, and its own doc comment states
-- finalization "is always recomputed fresh ... never incrementally patched" —
-- there is no multi-row/history table for finalizations upstream either).
--
-- Retention-override identity: the Baseline's "per-user override" (§16,
-- STO-*) is implemented here as a studio/tenant-account-level override
-- (studio_retention_overrides), consistent with every other account-level
-- setting in this schema (studios.plan_tier, billing, custom domains are all
-- studio-scoped, never scoped to a bare auth.users id that could span
-- multiple studios via studio_members' many-to-many membership). Explicit
-- user decision; approved final interpretation for V1.
--
-- Access model: all five tables here are server/service-role-mediated
-- surfaces. None of them gets a JWT-facing RLS policy, and anon/authenticated
-- hold no table privileges at all. Platform Operations reaches them through
-- requireSuperAdmin()-gated routes on the service-role client, and normal
-- providers only ever see the sanitized toProviderSafeRecordingView()
-- projection from GET /api/events/[eventId]/recording. Every mutation goes
-- through one of the four SECURITY DEFINER RPCs below, each of which pairs
-- its business write with its audit row in the same transaction.

-- =========================================================================
-- 1. event_recordings — one dedicated row per event
-- =========================================================================

CREATE TABLE public.event_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,

  recording_state text NOT NULL DEFAULT 'not_started'
    CHECK (recording_state IN (
      'not_started', 'recording', 'local_finalized', 'b2_finalizing', 'b2_finalized', 'failed'
    )),

  -- Local/session evidence only, mirroring the Media Agent's own
  -- vod_finalizations.finalized_at. Never authoritative on its own.
  local_finalized_at timestamptz,

  -- Non-secret storage identity only — never credentials. A non-null
  -- b2_object_key alone is not evidence of successful finalization; see the
  -- CHECK constraint below and b2_finalized_at.
  b2_object_key text,
  b2_bucket text,

  -- Set only once the VOD has actually, successfully reached the
  -- authoritative B2 store.
  b2_finalized_at timestamptz,

  -- Completeness/integrity verification pass, evidence independent of
  -- b2_finalized_at. Both are required together before retention may freeze.
  integrity_verified_at timestamptz,

  finalization_failure_reason text,

  -- Manual/unverified fallback only in this pass — no verification pipeline
  -- exists yet, so youtube_fallback_verified stays false until real evidence
  -- exists. Never auto-set true.
  youtube_fallback_url text,
  youtube_fallback_verified boolean NOT NULL DEFAULT false,

  -- The frozen retention snapshot (STO-007). Written only by
  -- freeze_event_retention() below, which requires both b2_finalized_at and
  -- integrity_verified_at. retention_frozen_at is deterministically
  -- GREATEST(b2_finalized_at, integrity_verified_at) — the timestamp of
  -- whichever evidence completed last, never the wall-clock time the freeze
  -- function happens to run, so a delayed execution can never silently
  -- shorten the promised retention window. Never recomputed from a live
  -- global/override default after freezing (write-once).
  retention_effective_days integer,
  retention_frozen_at timestamptz,
  retention_expires_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_recordings_b2_finalized_requires_reference CHECK (
    recording_state <> 'b2_finalized'
    OR (b2_object_key IS NOT NULL AND b2_bucket IS NOT NULL AND b2_finalized_at IS NOT NULL)
  ),
  CONSTRAINT event_recordings_youtube_fallback_requires_url CHECK (
    NOT youtube_fallback_verified OR youtube_fallback_url IS NOT NULL
  ),
  CONSTRAINT event_recordings_frozen_requires_b2_and_integrity CHECK (
    retention_frozen_at IS NULL OR (b2_finalized_at IS NOT NULL AND integrity_verified_at IS NOT NULL)
  ),
  CONSTRAINT event_recordings_frozen_fields_consistent CHECK (
    retention_frozen_at IS NULL
    OR (
      retention_effective_days IS NOT NULL AND retention_effective_days > 0
      AND retention_expires_at IS NOT NULL
      AND retention_expires_at > retention_frozen_at
    )
  )
);

-- No separate event_id index: `event_id uuid NOT NULL UNIQUE` already
-- creates event_recordings_event_id_key, which serves every lookup here.

ALTER TABLE public.event_recordings ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies at all for anon/authenticated. RLS enabled with
-- zero policies denies all client row access, including a tenant-scoped
-- SELECT for the owning studio — this table's raw columns (b2_object_key,
-- b2_bucket, integrity_verified_at, finalization internals) are
-- infrastructure metadata that must never reach a normal provider even
-- through direct-query convenience. All access is server-side only: the
-- service-role client for platform/system paths, and the sanitized
-- provider-facing GET /api/events/[eventId]/recording route (requireAdmin +
-- getOwnedEventById + toProviderSafeRecordingView()) for normal providers.

-- Table privileges — defense in depth alongside RLS, NOT a duplicate of it.
-- Supabase's project-level default privileges grant every newly created
-- public-schema table to anon, authenticated, and service_role as
-- `arwdDxtm`. RLS blocks row SELECT/INSERT/UPDATE/DELETE, but TRUNCATE is
-- *not* governed by RLS — it is governed only by the `D` privilege — so the
-- inherited grants are revoked explicitly here instead of being relied on,
-- following the hardening convention migration 0034 established for its own
-- tables. service_role is then re-granted only what the already-implemented
-- server-side code actually needs, and never TRUNCATE.
--
-- The SECURITY DEFINER RPCs below are unaffected by these revokes: they
-- execute as the function owner (postgres), not as service_role.
REVOKE ALL ON TABLE public.event_recordings FROM PUBLIC;
REVOKE ALL ON TABLE public.event_recordings FROM anon;
REVOKE ALL ON TABLE public.event_recordings FROM authenticated;
REVOKE ALL ON TABLE public.event_recordings FROM service_role;
-- Read-only for service_role: src/lib/eventRecording.ts's
-- getEventRecordingState() is the sole direct reader, and it only ever
-- surfaces toProviderSafeRecordingView(). SELECT also covers the composite
-- result rows returned by freeze_event_retention() and
-- apply_event_retention_extension(). Nothing in the repository writes this
-- table yet — the future B2 finalization writer must add its own explicit
-- INSERT/UPDATE grant rather than silently inheriting one here.
GRANT SELECT ON TABLE public.event_recordings TO service_role;

-- =========================================================================
-- 2. platform_retention_policy — true database singleton for the global
--    default (STO-003)
-- =========================================================================

CREATE TABLE public.platform_retention_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Enforces exactly one row: lock_key can only ever be 1, and UNIQUE(lock_key)
  -- makes a second row impossible — a real DB-enforced singleton, not a
  -- documentation convention.
  lock_key integer NOT NULL DEFAULT 1,
  default_retention_days integer NOT NULL DEFAULT 90 CHECK (default_retention_days > 0),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_retention_policy_lock_key_fixed CHECK (lock_key = 1),
  CONSTRAINT platform_retention_policy_singleton UNIQUE (lock_key)
);

INSERT INTO public.platform_retention_policy (default_retention_days)
VALUES (90)
ON CONFLICT (lock_key) DO NOTHING;

ALTER TABLE public.platform_retention_policy ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies at all, exactly like event_recordings above.
-- This is a server/service-role-mediated surface: Platform Operations reads
-- it through GET /api/platform/retention-policy, which is requireSuperAdmin()
-- -gated and uses the service-role client. No direct authenticated Supabase
-- SELECT path is required, so none is created. (A JWT-facing super-admin
-- SELECT policy predicated on public.platform_users cannot work today
-- regardless: migration 0014's platform_users_admin_read/_admin_update
-- policies are self-referencing, so any such subquery raises
-- "infinite recursion detected in policy for relation platform_users". That
-- pre-existing legacy issue is deliberately left to its own separate task
-- and is not worked around here.)
-- The only write path remains the apply_platform_retention_policy_update()
-- RPC below, which also writes the required audit row atomically.

REVOKE ALL ON TABLE public.platform_retention_policy FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_retention_policy FROM anon;
REVOKE ALL ON TABLE public.platform_retention_policy FROM authenticated;
REVOKE ALL ON TABLE public.platform_retention_policy FROM service_role;
-- Read-only for service_role: GET /api/platform/retention-policy is the sole
-- direct reader; SELECT also covers the composite result row returned by
-- apply_platform_retention_policy_update().
GRANT SELECT ON TABLE public.platform_retention_policy TO service_role;

-- =========================================================================
-- 3. studio_retention_overrides — the approved studio-account-level
--    implementation of the Baseline's "per-user override" (STO-*)
-- =========================================================================

CREATE TABLE public.studio_retention_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL UNIQUE REFERENCES public.studios(id) ON DELETE CASCADE,
  retention_days integer NOT NULL CHECK (retention_days > 0),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.studio_retention_overrides ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies at all — server/service-role-mediated only,
-- read through the requireSuperAdmin()-gated
-- GET /api/platform/studios/[studioId]/retention-override. The only write
-- path is apply_studio_retention_override() below (set/update/clear),
-- atomically audited.

REVOKE ALL ON TABLE public.studio_retention_overrides FROM PUBLIC;
REVOKE ALL ON TABLE public.studio_retention_overrides FROM anon;
REVOKE ALL ON TABLE public.studio_retention_overrides FROM authenticated;
REVOKE ALL ON TABLE public.studio_retention_overrides FROM service_role;
GRANT SELECT ON TABLE public.studio_retention_overrides TO service_role;

-- =========================================================================
-- 4. event_retention_extensions — audit trail for Super Admin manual
--    extensions (STO-008)
-- =========================================================================

CREATE TABLE public.event_retention_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  previous_expires_at timestamptz,
  new_expires_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  extended_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_retention_extensions_strictly_later CHECK (
    previous_expires_at IS NULL OR new_expires_at > previous_expires_at
  )
);

CREATE INDEX event_retention_extensions_event_id_idx ON public.event_retention_extensions (event_id);

ALTER TABLE public.event_retention_extensions ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies at all — server/service-role-mediated only. No
-- provider-facing or Platform Operations route reads this history table
-- directly today; the only write path is apply_event_retention_extension()
-- below, atomic with the retention_expires_at update and the
-- platform_audit_log row.

REVOKE ALL ON TABLE public.event_retention_extensions FROM PUBLIC;
REVOKE ALL ON TABLE public.event_retention_extensions FROM anon;
REVOKE ALL ON TABLE public.event_retention_extensions FROM authenticated;
REVOKE ALL ON TABLE public.event_retention_extensions FROM service_role;
-- No service_role grant: nothing in the repository reads or writes this
-- table through PostgREST. apply_event_retention_extension() inserts into it
-- as the function owner. A future history-reading route must add its own
-- explicit SELECT grant rather than inheriting one here.

-- =========================================================================
-- 5. platform_audit_log — general Security/Audit Logs foundation
-- =========================================================================

CREATE TABLE public.platform_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  actor_platform_role text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  reason text,
  -- Generic jsonb columns, but the actual safety mechanism is the
  -- application-layer writer (src/lib/platformAudit.ts) and these RPCs
  -- themselves: only a small allowlisted set of typed action payloads is
  -- ever inserted — never an arbitrary full-row dump, and never secrets,
  -- credentials, tokens, private keys, raw stream keys, or unrelated
  -- private customer data.
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_audit_log_created_at_idx ON public.platform_audit_log (created_at DESC);
CREATE INDEX platform_audit_log_target_idx ON public.platform_audit_log (target_type, target_id);

ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies at all — server/service-role-mediated only, read
-- through the requireSuperAdmin()-gated GET /api/platform/audit-log. No
-- anon/authenticated row access of any kind.

REVOKE ALL ON TABLE public.platform_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_audit_log FROM anon;
REVOKE ALL ON TABLE public.platform_audit_log FROM authenticated;
REVOKE ALL ON TABLE public.platform_audit_log FROM service_role;
-- SELECT for GET /api/platform/audit-log; INSERT for the allowlisted
-- server-side writer src/lib/platformAudit.ts (writeAuditLog), which covers
-- the platform actions that do not go through one of the atomic RPCs below.
-- Deliberately no UPDATE, no DELETE, and no TRUNCATE: audit rows are
-- append-only from the application's side.
GRANT SELECT, INSERT ON TABLE public.platform_audit_log TO service_role;

-- =========================================================================
-- 6. RPCs — atomic business-mutation + audit-evidence pairs
--
-- Pattern matches migrations 0025/0026: a guarded SECURITY DEFINER
-- function, revoked from PUBLIC/anon/authenticated and explicitly granted
-- to service_role, so the intended execution boundary is stated in this
-- migration rather than depending on the project's default ACLs. Each function
-- uses a fixed safe search_path, fully qualified object names, explicit
-- input validation, and row locking (FOR UPDATE) for concurrency-sensitive
-- mutations. For every Super-Admin-initiated RPC, the function itself
-- re-verifies p_actor currently has platform_users.platform_role =
-- 'super_admin' as defense-in-depth, even though route-level
-- requireSuperAdmin() remains the primary authorization boundary.
-- =========================================================================

-- freeze_event_retention: system/finalization-pipeline-initiated (not a
-- person clicking a button), so it does not take or check a Super Admin
-- actor — it is gated purely by being revoked from anon/authenticated and
-- callable only via the service-role connection. Resolves effective days
-- from the studio override first, the global default otherwise. A caller
-- can never inject its own retention period.
CREATE OR REPLACE FUNCTION public.freeze_event_retention(p_event_id uuid)
RETURNS public.event_recordings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.event_recordings%ROWTYPE;
  v_studio_id uuid;
  v_effective_days integer;
  v_frozen_at timestamptz;
BEGIN
  SELECT er.* INTO v_row
  FROM public.event_recordings er
  WHERE er.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_recordings row not found for event %', p_event_id;
  END IF;

  -- Write-once: idempotent no-op if already frozen.
  IF v_row.retention_frozen_at IS NOT NULL THEN
    RETURN v_row;
  END IF;

  IF v_row.recording_state <> 'b2_finalized'
     OR v_row.b2_finalized_at IS NULL
     OR v_row.integrity_verified_at IS NULL THEN
    RAISE EXCEPTION
      'event % is not eligible for retention freeze: recording_state=%, b2_finalized_at=%, integrity_verified_at=%',
      p_event_id, v_row.recording_state, v_row.b2_finalized_at, v_row.integrity_verified_at;
  END IF;

  SELECT e.studio_id INTO v_studio_id FROM public.events e WHERE e.id = p_event_id;
  IF v_studio_id IS NULL THEN
    RAISE EXCEPTION 'event % has no owning studio', p_event_id;
  END IF;

  SELECT sro.retention_days INTO v_effective_days
  FROM public.studio_retention_overrides sro
  WHERE sro.studio_id = v_studio_id;

  IF v_effective_days IS NULL THEN
    SELECT prp.default_retention_days INTO v_effective_days
    FROM public.platform_retention_policy prp
    LIMIT 1;
  END IF;

  IF v_effective_days IS NULL OR v_effective_days <= 0 THEN
    RAISE EXCEPTION 'no valid effective retention days resolved for event %', p_event_id;
  END IF;

  v_frozen_at := GREATEST(v_row.b2_finalized_at, v_row.integrity_verified_at);

  UPDATE public.event_recordings
  SET retention_effective_days = v_effective_days,
      retention_frozen_at = v_frozen_at,
      retention_expires_at = v_frozen_at + (v_effective_days || ' days')::interval,
      updated_at = now()
  WHERE event_id = p_event_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.freeze_event_retention(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.freeze_event_retention(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_event_retention(uuid) TO service_role;

-- apply_event_retention_extension: Super-Admin-initiated. Permitted only
-- once retention is already frozen; the new expiry must be strictly later
-- than the current expiry (never equal or shorter); reason must be
-- non-empty after trimming. The event_recordings update, the
-- event_retention_extensions history row, and the platform_audit_log row
-- are one atomic operation — any failure rolls back all three.
CREATE OR REPLACE FUNCTION public.apply_event_retention_extension(
  p_event_id uuid,
  p_new_expires_at timestamptz,
  p_reason text,
  p_actor uuid
)
RETURNS public.event_recordings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.event_recordings%ROWTYPE;
  v_previous_expires_at timestamptz;
  v_reason text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_users pu
    WHERE pu.user_id = p_actor AND pu.platform_role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'actor % is not an authorized super_admin', p_actor;
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'reason is required for a retention extension';
  END IF;

  SELECT er.* INTO v_row
  FROM public.event_recordings er
  WHERE er.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_recordings row not found for event %', p_event_id;
  END IF;

  IF v_row.retention_frozen_at IS NULL OR v_row.retention_expires_at IS NULL THEN
    RAISE EXCEPTION 'event % retention is not frozen yet; cannot extend', p_event_id;
  END IF;

  IF p_new_expires_at IS NULL OR p_new_expires_at <= v_row.retention_expires_at THEN
    RAISE EXCEPTION 'new expiry must be strictly later than the current expiry for event %', p_event_id;
  END IF;

  v_previous_expires_at := v_row.retention_expires_at;

  INSERT INTO public.event_retention_extensions (event_id, previous_expires_at, new_expires_at, reason, extended_by)
  VALUES (p_event_id, v_previous_expires_at, p_new_expires_at, v_reason, p_actor);

  UPDATE public.event_recordings
  SET retention_expires_at = p_new_expires_at,
      updated_at = now()
  WHERE event_id = p_event_id
  RETURNING * INTO v_row;

  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_platform_role, action, target_type, target_id, reason, before_state, after_state)
  VALUES (
    p_actor, 'super_admin', 'retention_extended', 'event', p_event_id::text, v_reason,
    jsonb_build_object('retentionExpiresAt', v_previous_expires_at),
    jsonb_build_object('retentionExpiresAt', p_new_expires_at)
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_event_retention_extension(uuid, timestamptz, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_event_retention_extension(uuid, timestamptz, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_event_retention_extension(uuid, timestamptz, text, uuid) TO service_role;

-- apply_platform_retention_policy_update: Super-Admin-initiated. Updates the
-- singleton global default and inserts its audit row atomically.
CREATE OR REPLACE FUNCTION public.apply_platform_retention_policy_update(
  p_new_default_days integer,
  p_actor uuid
)
RETURNS public.platform_retention_policy
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.platform_retention_policy%ROWTYPE;
  v_previous_days integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_users pu
    WHERE pu.user_id = p_actor AND pu.platform_role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'actor % is not an authorized super_admin', p_actor;
  END IF;

  IF p_new_default_days IS NULL OR p_new_default_days <= 0 THEN
    RAISE EXCEPTION 'default_retention_days must be a positive integer';
  END IF;

  SELECT prp.* INTO v_row FROM public.platform_retention_policy prp FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_retention_policy singleton row is missing';
  END IF;

  v_previous_days := v_row.default_retention_days;

  UPDATE public.platform_retention_policy
  SET default_retention_days = p_new_default_days,
      updated_by = p_actor,
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_platform_role, action, target_type, target_id, reason, before_state, after_state)
  VALUES (
    p_actor, 'super_admin', 'retention_policy_updated', 'platform_retention_policy', v_row.id::text, NULL,
    jsonb_build_object('defaultRetentionDays', v_previous_days),
    jsonb_build_object('defaultRetentionDays', p_new_default_days)
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_platform_retention_policy_update(integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_platform_retention_policy_update(integer, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_retention_policy_update(integer, uuid) TO service_role;

-- apply_studio_retention_override: Super-Admin-initiated set/update/clear.
-- p_retention_days = NULL clears the override. Returns a small jsonb summary
-- rather than a table row, since "cleared" has no row to return. The
-- override mutation and its platform_audit_log row are atomic.
CREATE OR REPLACE FUNCTION public.apply_studio_retention_override(
  p_studio_id uuid,
  p_retention_days integer,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous_days integer;
  v_action text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_users pu
    WHERE pu.user_id = p_actor AND pu.platform_role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'actor % is not an authorized super_admin', p_actor;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.studios s WHERE s.id = p_studio_id) THEN
    RAISE EXCEPTION 'studio % does not exist', p_studio_id;
  END IF;

  SELECT sro.retention_days INTO v_previous_days
  FROM public.studio_retention_overrides sro
  WHERE sro.studio_id = p_studio_id
  FOR UPDATE;

  IF p_retention_days IS NULL THEN
    v_action := 'studio_retention_override_cleared';
    DELETE FROM public.studio_retention_overrides WHERE studio_id = p_studio_id;
  ELSE
    IF p_retention_days <= 0 THEN
      RAISE EXCEPTION 'retention_days must be a positive integer';
    END IF;
    v_action := CASE WHEN v_previous_days IS NULL
      THEN 'studio_retention_override_set'
      ELSE 'studio_retention_override_updated'
    END;

    INSERT INTO public.studio_retention_overrides (studio_id, retention_days, updated_by)
    VALUES (p_studio_id, p_retention_days, p_actor)
    ON CONFLICT (studio_id) DO UPDATE
      SET retention_days = excluded.retention_days,
          updated_by = excluded.updated_by,
          updated_at = now();
  END IF;

  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_platform_role, action, target_type, target_id, reason, before_state, after_state)
  VALUES (
    p_actor, 'super_admin', v_action, 'studio', p_studio_id::text, NULL,
    jsonb_build_object('retentionDays', v_previous_days),
    jsonb_build_object('retentionDays', p_retention_days)
  );

  RETURN jsonb_build_object('studioId', p_studio_id, 'retentionDays', p_retention_days, 'action', v_action);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_studio_retention_override(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_studio_retention_override(uuid, integer, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_studio_retention_override(uuid, integer, uuid) TO service_role;

-- Note: this migration does not touch events, page_state, event_visibility,
-- the legacy photographers table, or any Restreamer/GrapesJS/portal object.
-- Migration 0019's original (never-applied) column set — vod_ready_at,
-- archive_verified_at, r2_delete_eligible_at, retention_policy_id,
-- media_state — was used only as historical reference for naming/intent and
-- is not revived or copied onto events here.
