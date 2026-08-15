-- YouTube replay-fallback manual Super Admin verification RPC.
--
-- LOCAL DESIGN ONLY as of this commit - NOT applied to the linked Supabase
-- project. Migrations 0035/0036 (applied, post-apply verified) are not
-- modified, and no new column is added: 0035 already defines
-- event_recordings.youtube_fallback_url/youtube_fallback_verified exactly
-- as this RPC needs them, including the existing
-- event_recordings_youtube_fallback_requires_url CHECK (NOT
-- youtube_fallback_verified OR youtube_fallback_url IS NOT NULL), which
-- this RPC always satisfies by writing both fields together.
--
-- Product/security decision this RPC implements (explicit user decision,
-- narrow Milestone N completion carve-out, not the Super Admin Operations
-- Console / Milestone M): a YouTube replay fallback (Baseline STO-005,
-- YTB-008) is verified by manual Super Admin attestation with an audit
-- trail. A provider action must never set youtube_fallback_verified = true.
-- OAuth/API-based YouTube verification (channel ownership, ingest relay,
-- automated availability polling) is explicitly deferred to a future phase
-- and is NOT implemented here - this RPC never calls or simulates the
-- YouTube API.
--
-- Source-of-truth for the candidate URL: the existing provider-authored
-- events.youtube_url column (Baseline YTB-003's manual watch-link model,
-- already written by PATCH /api/events/[eventId]/livestream/youtube). No
-- second "candidate fallback URL" column or authority is introduced. The
-- caller must supply the exact URL it intends to verify, and this RPC
-- requires it to equal the event's current events.youtube_url at the
-- moment of verification - not merely "some URL for this event" - so a
-- stale or cross-event attestation fails closed rather than silently
-- trusting whichever value happens to be in the row.
--
-- Conventions follow 0035/0036 exactly: fixed safe search_path, fully
-- qualified object names, explicit validation, FOR UPDATE row locking,
-- EXECUTE revoked from PUBLIC/anon/authenticated and granted only to
-- service_role. The audit row is written through the existing
-- platform_audit_log table (0035) in the same transaction as the business
-- mutation - no second audit system.

CREATE OR REPLACE FUNCTION public.apply_youtube_fallback_verification(
  p_event_id uuid,
  p_youtube_url text,
  p_actor uuid
)
RETURNS public.event_recordings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_youtube_url text;
  v_url text;
  v_row public.event_recordings%ROWTYPE;
  v_previous_url text;
  v_previous_verified boolean;
BEGIN
  -- Defense in depth: route-level requireSuperAdmin() is the primary
  -- authorization boundary, but the function itself re-verifies, exactly
  -- like every other Super-Admin-initiated RPC in 0035.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_users pu
    WHERE pu.user_id = p_actor AND pu.platform_role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'actor % is not an authorized super_admin', p_actor;
  END IF;

  v_url := btrim(coalesce(p_youtube_url, ''));
  IF v_url = '' THEN
    RAISE EXCEPTION 'youtube_url is required';
  END IF;
  -- Coarse defense-in-depth host check only - the strict validator
  -- (protocol + exact host allowlist) is the route's own
  -- isValidYoutubeWatchUrl(), already enforced before this RPC is ever
  -- called. This is a second, independent gate, not the primary one.
  IF v_url !~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)(/|$)' THEN
    RAISE EXCEPTION 'youtube_url must be a youtube.com or youtu.be URL';
  END IF;

  -- Row-lock the event first so a concurrent PATCH .../livestream/youtube
  -- cannot change events.youtube_url between this read and the comparison
  -- below.
  SELECT e.youtube_url INTO v_event_youtube_url
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % does not exist', p_event_id;
  END IF;

  -- Cross-event/stale-attestation protection: the Super Admin must be
  -- verifying the event's CURRENT provider-supplied watch link, not an
  -- arbitrary or previously-valid URL. If the provider has since changed or
  -- cleared it, this fails closed rather than freezing a mismatched value.
  IF v_event_youtube_url IS NULL OR v_event_youtube_url <> v_url THEN
    RAISE EXCEPTION
      'youtube_url does not match event %''s current provider-supplied watch link',
      p_event_id;
  END IF;

  -- Lazily create the single row, mirroring 0036's
  -- apply_event_recording_transition - a YouTube fallback may be verified
  -- for an event with no recording activity yet. event_id is already
  -- UNIQUE (0035).
  INSERT INTO public.event_recordings (event_id, recording_state)
  VALUES (p_event_id, 'not_started')
  ON CONFLICT (event_id) DO NOTHING;

  SELECT er.* INTO v_row
  FROM public.event_recordings er
  WHERE er.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_recordings row not found for event %', p_event_id;
  END IF;

  v_previous_url := v_row.youtube_fallback_url;
  v_previous_verified := v_row.youtube_fallback_verified;

  UPDATE public.event_recordings
  SET youtube_fallback_url = v_url,
      youtube_fallback_verified = true,
      updated_at = now()
  WHERE event_id = p_event_id
  RETURNING * INTO v_row;

  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_platform_role, action, target_type, target_id, reason, before_state, after_state)
  VALUES (
    p_actor, 'super_admin', 'youtube_fallback_verified', 'event', p_event_id::text, NULL,
    jsonb_build_object('youtubeFallbackUrl', v_previous_url, 'youtubeFallbackVerified', v_previous_verified),
    jsonb_build_object('youtubeFallbackUrl', v_row.youtube_fallback_url, 'youtubeFallbackVerified', v_row.youtube_fallback_verified)
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_youtube_fallback_verification(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_youtube_fallback_verification(uuid, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_youtube_fallback_verification(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.apply_youtube_fallback_verification IS
  'Manual Super Admin attestation only (STO-005/YTB-008 verified YouTube fallback). Never calls or simulates the YouTube API. Requires the supplied URL to equal the event''s current provider-supplied events.youtube_url. Writes youtube_fallback_url/youtube_fallback_verified together with an atomic platform_audit_log row. No new column; 0035 already defines both target fields.';
