-- ============================================================
-- Migration 0034: Analytics + Support + Notifications foundation
--
-- Delivery package: Analytics + Provider operational/support/auth
-- capabilities (Baseline V2.1 Milestones J and L). Purely additive. Does
-- not modify any existing table's existing columns, does not touch any
-- existing policy on events/wishes/guest_photos/page_views (0003/0022/
-- 0028/0031/0032 remain exactly as applied), and does not touch
-- media_event_assignments (0020) or studios/studio_members (0001).
--
-- Four independent additions, kept in one migration because they are one
-- coherent feature package per this repository's execution-granularity
-- rule, not because they are relied on by each other:
--
--   1. public.page_views.visitor_id — nullable, additive column. An opaque
--      browser-generated first-party random identifier (never IP-based,
--      never a fingerprint, never an ad identifier), added by the
--      browser-side page-view tracker going forward. Existing rows keep
--      visitor_id = NULL forever; they are never backfilled with a
--      fabricated identity. Real "unique visitors" can only be counted
--      from the point this column started being populated onward — the
--      analytics UI must say so rather than implying full historical
--      coverage.
--
--   2. public.event_audience_heartbeats — a new, narrowly-scoped table
--      for EventCast-private-stream player-session heartbeats (Baseline
--      ANA-003), written ONLY through the SECURITY DEFINER RPC
--      public.record_event_audience_heartbeat(). See STEP 2 for the full
--      trust model.
--
--   3. public.support_tickets / public.support_ticket_messages — minimal
--      tenant-owned Support Ticket capability (Baseline SUP-001/SUP-002).
--      Authenticated, studio-scoped READ only; every mutation goes through
--      the server API routes' privileged client. No anonymous policy of
--      any kind.
--
--   4. public.notifications — in-app Notification Center foundation
--      (Baseline NOT-001). Authenticated, studio-scoped SELECT plus a
--      column-scoped mark-read UPDATE. Creation is server-only.
--
-- ── Pre-apply review corrections (applied to this file in place) ──────────
-- A pre-apply security review of the first draft of this migration found
-- four defects, all corrected below rather than deferred to a later
-- migration (0034 remains the single migration for this package):
--
--   A. The original design gave anon/authenticated a direct INSERT policy
--      on event_audience_heartbeats gated only on event eligibility. That
--      accepted unlimited forged rows at any frequency, and the analytics
--      aggregation converts row count directly into watch time — so a
--      guest could manufacture arbitrary Current/Peak/Unique viewer and
--      watch-time figures. Direct INSERT is now revoked entirely and
--      replaced by a bucketed SECURITY DEFINER RPC (STEP 2).
--   B. That same policy could never have succeeded anyway: RLS on a table
--      referenced inside a policy expression is applied for the *calling*
--      role, and public.media_event_assignments (0020) has RLS enabled
--      with zero anon/authenticated policies, so the eligibility EXISTS
--      always returned zero rows. Performing that check inside a definer
--      function is what makes it both correct and enforceable.
--   C. support_tickets.event_id had no database-level guarantee that the
--      linked event belongs to the ticket's own studio. Now enforced by a
--      trigger that also covers the service-role write path used by the
--      API routes (STEP 5).
--   D. The Support author/creator foreign keys cascaded from auth.users,
--      so deleting one Auth user hard-deleted whole tickets and punched
--      holes in surviving message threads. Now nullable ON DELETE SET NULL.
--
-- LOCAL FILE ONLY. Not applied by this authoring step. Applying it (via
-- `supabase db push` or any other path) requires a separate, explicit
-- approval and pre-apply review, per this repository's standing rule that
-- remote migration application is always its own hard boundary.
-- ============================================================

BEGIN;

-- ── Guard: refuse to run against an unexpected schema/policy state ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'page_state'
  ) THEN
    RAISE EXCEPTION 'public.events.page_state is missing; this migration requires 0029 to be applied first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_event_visibility_check'
      AND pg_get_constraintdef(oid) ILIKE '%unlisted%'
  ) THEN
    RAISE EXCEPTION 'events_event_visibility_check does not yet allow unlisted; this migration requires 0031 to be applied first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'media_event_assignments'
  ) THEN
    RAISE EXCEPTION 'public.media_event_assignments is missing; this migration requires 0020 to be applied first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'page_views'
  ) THEN
    RAISE EXCEPTION 'public.page_views is missing; refusing an unexpected schema state';
  END IF;
END;
$$;

-- ============================================================
-- STEP 1: page_views.visitor_id
-- ============================================================

ALTER TABLE public.page_views
  ADD COLUMN IF NOT EXISTS visitor_id text NULL;

COMMENT ON COLUMN public.page_views.visitor_id IS
  'Opaque browser-generated first-party random identifier (localStorage), added going forward only. NULL on every row inserted before this column existed — never backfilled with a fabricated identity. Not IP-based, not a fingerprint, not an advertising identifier.';

-- Also the first index on page_views (event_id, ...) in this schema: the
-- existing per-event analytics scan and get_public_event_view_count (0016)
-- currently have only the country index and the primary key to work with.
CREATE INDEX IF NOT EXISTS idx_page_views_event_visitor
  ON public.page_views (event_id, visitor_id);

-- No policy change: page_views_insert_policy (0003, unchanged by 0022/0032)
-- already allows any anon/authenticated INSERT with a valid event_id; it
-- does not enumerate columns, so it already covers this new nullable one.

-- ============================================================
-- STEP 2: public.event_audience_heartbeats
--
-- Trust model (corrections A and B above):
--
--   * Nothing except the SECURITY DEFINER RPC below ever inserts here.
--     anon and authenticated hold no INSERT/UPDATE/DELETE privilege at
--     all, so there is no direct request-spam surface to rate-limit.
--   * The RPC computes the heartbeat bucket from *database* time. The
--     client cannot supply, backdate, or fabricate a timestamp.
--   * A unique index on (event_id, session_id, bucket_started_at) plus
--     ON CONFLICT DO NOTHING means one playback session can contribute at
--     most one accepted row per heartbeat interval no matter how many
--     times it calls. Replaying the same call 10 000 times in one interval
--     adds exactly zero additional watch time.
--   * Event eligibility (Published + Public/Unlisted + not archived + an
--     *enabled* media_event_assignments row) is checked inside the definer
--     function, which is the only way the assignment check can work at
--     all: media_event_assignments is service-role-only by design (0020).
--   * There is no anonymous SELECT. Only the owning studio's members may
--     read raw rows.
--
-- Honest scope: viewer_id is a privacy-safe browser/player identity, not
-- proof of a unique human. A determined attacker can still mint fresh
-- viewer/session identifiers. This design deliberately stops trivial
-- request-spam inflation without fingerprinting, IP identity, or any
-- external rate-limiting service; the Analytics UI must describe these
-- figures as measured player sessions, never as verified unique people.
-- ============================================================

-- Server-side heartbeat bucket. STABLE (not IMMUTABLE) because date_part
-- on timestamptz is timezone-dependent; it is used as a column default and
-- inside the RPC, never in an index expression. Left with its default
-- EXECUTE grant on purpose: it reads no data, it only floors a timestamp,
-- and revoking it would break the column default for privileged writers.
CREATE OR REPLACE FUNCTION public.event_audience_heartbeat_bucket(p_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.to_timestamp(
    (pg_catalog.floor(pg_catalog.date_part('epoch', p_at) / 20) * 20)::double precision
  );
$$;

COMMENT ON FUNCTION public.event_audience_heartbeat_bucket(timestamptz) IS
  'Floors a server timestamp to the 20-second EventCast heartbeat interval. Must stay in sync with HEARTBEAT_INTERVAL_MS in the player script and HEARTBEAT_INTERVAL_SECONDS in the analytics route.';

CREATE TABLE IF NOT EXISTS public.event_audience_heartbeats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- Opaque, browser-generated UUIDs. viewer_id persists per browser
  -- (localStorage) across sessions; session_id is regenerated every time
  -- EventCast-private playback genuinely starts, so total watch time can
  -- be derived per play session rather than per browser tab lifetime.
  -- Typed uuid rather than free text so a malformed or padded identifier
  -- is rejected by the type system before it can reach the table.
  viewer_id  uuid NOT NULL,
  session_id uuid NOT NULL,
  -- Server-assigned, authoritative. The client never supplies a timestamp.
  -- bucket_started_at is what watch time is derived from; created_at is
  -- kept as the exact arrival instant for troubleshooting only.
  bucket_started_at timestamptz NOT NULL
                      DEFAULT public.event_audience_heartbeat_bucket(now()),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_audience_heartbeats IS
  'Raw EventCast-private-stream player-session heartbeat pings (Baseline ANA-003), written only via public.record_event_audience_heartbeat(). At most one accepted row per (event, session, 20-second bucket). Aggregated into current/peak/total-viewer and watch-time figures by authenticated application code at read time — no separate aggregate table. viewer_id is a privacy-safe browser/player identity, not a verified unique person.';

-- Serves the newest-first per-event fetch the analytics route performs.
CREATE INDEX IF NOT EXISTS idx_event_audience_heartbeats_event_bucket
  ON public.event_audience_heartbeats (event_id, bucket_started_at DESC);

-- The cadence guarantee itself, and the per-session grouping index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_audience_heartbeats_session_bucket
  ON public.event_audience_heartbeats (event_id, session_id, bucket_started_at);

ALTER TABLE public.event_audience_heartbeats ENABLE ROW LEVEL SECURITY;

-- No INSERT policy for anon or authenticated, and no table-level INSERT
-- privilege either (see the REVOKE below) — the RPC is the only writer.
-- No UPDATE/DELETE policy: heartbeats are append-only from every caller.
-- Any future retention/cleanup job runs as the service role, which
-- bypasses RLS entirely and needs no policy here.
DROP POLICY IF EXISTS event_audience_heartbeats_select_policy ON public.event_audience_heartbeats;
CREATE POLICY event_audience_heartbeats_select_policy ON public.event_audience_heartbeats
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      JOIN public.studio_members AS member_row
        ON member_row.studio_id = event_row.studio_id
      WHERE event_row.id = event_audience_heartbeats.event_id
        AND member_row.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.event_audience_heartbeats FROM anon;
REVOKE ALL ON TABLE public.event_audience_heartbeats FROM authenticated;
GRANT SELECT ON TABLE public.event_audience_heartbeats TO authenticated;

-- The single sanctioned write path. SECURITY DEFINER with a fail-closed
-- empty search_path and fully-qualified references throughout.
CREATE OR REPLACE FUNCTION public.record_event_audience_heartbeat(
  p_event_id   uuid,
  p_viewer_id  uuid,
  p_session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bucket   timestamptz;
  v_inserted uuid;
BEGIN
  IF p_event_id IS NULL OR p_viewer_id IS NULL OR p_session_id IS NULL THEN
    RETURN false;
  END IF;

  -- Guest playback eligibility: exactly the three-part expression used by
  -- the guest-engagement child policies (0032), plus the enabled-assignment
  -- condition the public Worker uses to decide whether a live HLS URL
  -- exists at all. Both reads happen as the definer, so the caller never
  -- needs (and never gets) SELECT on service-role-only assignment state.
  IF NOT EXISTS (
    SELECT 1
    FROM public.events AS event_row
    WHERE event_row.id = p_event_id
      AND event_row.page_state = 'published'
      AND event_row.event_visibility IN ('public', 'unlisted')
      AND event_row.archived_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.media_event_assignments AS assignment_row
    WHERE assignment_row.event_id = p_event_id
      AND assignment_row.enabled = true
  ) THEN
    RETURN false;
  END IF;

  v_bucket := public.event_audience_heartbeat_bucket(pg_catalog.now());

  INSERT INTO public.event_audience_heartbeats (event_id, viewer_id, session_id, bucket_started_at)
  VALUES (p_event_id, p_viewer_id, p_session_id, v_bucket)
  ON CONFLICT (event_id, session_id, bucket_started_at) DO NOTHING
  RETURNING id INTO v_inserted;

  -- true  = a new bucket was recorded
  -- false = ineligible event, or this session already counted for this
  --         interval (a retry, a duplicate tab, or deliberate spam)
  RETURN v_inserted IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.record_event_audience_heartbeat(uuid, uuid, uuid) IS
  'Records at most one EventCast player heartbeat per (event, session, 20-second server bucket). Returns whether a new bucket was accepted; never returns heartbeat rows. Verifies Published + Public/Unlisted + not-archived + enabled media assignment internally.';

REVOKE ALL ON FUNCTION public.record_event_audience_heartbeat(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_event_audience_heartbeat(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_event_audience_heartbeat(uuid, uuid, uuid) FROM authenticated;
-- anon is the role the public event page actually runs as; authenticated
-- covers a logged-in provider previewing their own live page. Nothing else.
GRANT EXECUTE ON FUNCTION public.record_event_audience_heartbeat(uuid, uuid, uuid) TO anon, authenticated;

-- ============================================================
-- STEP 3: shared same-studio event-linkage guard
--
-- Used by support_tickets and notifications, both of which carry an
-- optional event_id. Implemented as a trigger rather than an RLS WITH
-- CHECK so the guarantee also holds for the privileged server client the
-- API routes use (the service role bypasses RLS). The routes' existing
-- getOwnedEventById validation stays exactly as it is — this is the
-- database-level backstop underneath it, not a replacement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_event_belongs_to_studio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.events AS event_row
    WHERE event_row.id = NEW.event_id
      AND event_row.studio_id = NEW.studio_id
  ) THEN
    RAISE EXCEPTION 'linked event must belong to the same studio'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_event_belongs_to_studio() IS
  'BEFORE INSERT/UPDATE trigger guard: a row carrying an optional event_id may only reference an event owned by that row''s own studio_id. Definer-scoped so the check is authoritative regardless of the writer''s RLS visibility.';

-- ============================================================
-- STEP 4: Support Tickets
--
-- Authenticated, studio-scoped READ only. Every mutation (create, reply,
-- close) goes through the server API routes' privileged client, which
-- already proves ownership via requireAdmin + getOwnedSupportTicketById /
-- getOwnedEventById. Direct authenticated INSERT/UPDATE/DELETE privilege
-- is therefore revoked outright rather than left as a second, weaker
-- mutation surface that would bypass those route-level validations.
--
-- Any studio member (any role) may act on their own studio's tickets:
-- this repository has no existing product decision restricting Support to
-- owner/admin the way Partner mutation is (0030), so none is invented here.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id          uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  -- Nullable: a general ticket has no event; an Urgent Live Support ticket
  -- created from the Event Live surface carries the originating event.
  -- ON DELETE SET NULL so deleting an event never erases support history.
  event_id           uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  -- Nullable ON DELETE SET NULL, not CASCADE: deleting an Auth user must
  -- never delete the studio's ticket (which would cascade on to every
  -- message in the thread). The ticket survives with an unknown author.
  created_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  subject            text NOT NULL CHECK (length(btrim(subject)) > 0),
  category           text NOT NULL DEFAULT 'general'
                        CHECK (category IN ('general', 'urgent_live')),
  status             text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'closed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz NULL
);

COMMENT ON TABLE public.support_tickets IS
  'Minimal tenant-owned Support Ticket capability (Baseline SUP-001/SUP-002). Read-only to authenticated studio members; all mutation is server-mediated. Platform-side operational handling of these tickets is Milestone M (Super Admin Operations Console) and is not implemented by this table alone.';

CREATE INDEX IF NOT EXISTS idx_support_tickets_studio_created
  ON public.support_tickets (studio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_event
  ON public.support_tickets (event_id)
  WHERE event_id IS NOT NULL;

DROP TRIGGER IF EXISTS support_tickets_event_studio_match ON public.support_tickets;
CREATE TRIGGER support_tickets_event_studio_match
  BEFORE INSERT OR UPDATE OF event_id, studio_id ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_belongs_to_studio();

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  -- Nullable ON DELETE SET NULL for the same reason as the ticket creator:
  -- deleting an Auth user must not punch holes in a surviving thread.
  author_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  body            text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_created
  ON public.support_ticket_messages (ticket_id, created_at);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- No anonymous policy of any kind on either table — Support is an
-- authenticated Provider Console capability, not guest-facing.
DROP POLICY IF EXISTS support_tickets_select_policy ON public.support_tickets;
CREATE POLICY support_tickets_select_policy ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (studio_id IN (SELECT studio_id FROM public.studio_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS support_ticket_messages_select_policy ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_select_policy ON public.support_ticket_messages
  FOR SELECT
  TO authenticated
  USING (
    ticket_id IN (
      SELECT id FROM public.support_tickets
      WHERE studio_id IN (SELECT studio_id FROM public.studio_members WHERE user_id = auth.uid())
    )
  );

REVOKE ALL ON TABLE public.support_tickets FROM anon;
REVOKE ALL ON TABLE public.support_tickets FROM authenticated;
GRANT SELECT ON TABLE public.support_tickets TO authenticated;

REVOKE ALL ON TABLE public.support_ticket_messages FROM anon;
REVOKE ALL ON TABLE public.support_ticket_messages FROM authenticated;
GRANT SELECT ON TABLE public.support_ticket_messages TO authenticated;

-- ============================================================
-- STEP 5: In-app Notification Center
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id         uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  event_id          uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  severity          text NOT NULL DEFAULT 'info'
                      CHECK (severity IN ('info', 'warning', 'critical')),
  notification_type text NOT NULL CHECK (length(btrim(notification_type)) > 0),
  title             text NOT NULL CHECK (length(btrim(title)) > 0),
  body              text NULL,
  -- Caller-constructed dedup key (e.g. "support_reply:<ticket_id>" or
  -- "stream_disconnect:<event_id>:<hour_bucket>"). NULL means "no dedup
  -- requested" — most notifications are fine to always insert.
  dedup_key         text NULL,
  read_at           timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'In-app Notification Center foundation (Baseline NOT-001). Rows are written only by trusted server-side code (service-role client bypasses RLS — no anon/authenticated INSERT policy or privilege exists). Providers may read their own studio''s rows and mark them read; no other field is mutable by a provider. Represents only real stored in-app notifications; never a claim that an outbound WhatsApp/SMS/email channel delivered anything.';

CREATE INDEX IF NOT EXISTS idx_notifications_studio_created
  ON public.notifications (studio_id, created_at DESC);

-- Dedup mechanism (Baseline NOT-004): a caller that wants "at most one of
-- this exact notification" builds a stable dedup_key and INSERTs with
-- ON CONFLICT (studio_id, dedup_key) DO NOTHING. Rows with dedup_key = NULL
-- are never deduplicated against each other or anything else.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_studio_dedup_key
  ON public.notifications (studio_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

DROP TRIGGER IF EXISTS notifications_event_studio_match ON public.notifications;
CREATE TRIGGER notifications_event_studio_match
  BEFORE INSERT OR UPDATE OF event_id, studio_id ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_belongs_to_studio();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_policy ON public.notifications;
CREATE POLICY notifications_select_policy ON public.notifications
  FOR SELECT
  TO authenticated
  USING (studio_id IN (SELECT studio_id FROM public.studio_members WHERE user_id = auth.uid()));

-- Mark-read is the only provider mutation. The row policy proves studio
-- ownership; the column-scoped GRANT below is what makes it impossible to
-- rewrite title/body/severity/dedup_key/studio_id/event_id — an RLS policy
-- alone cannot restrict which columns an UPDATE touches.
DROP POLICY IF EXISTS notifications_update_policy ON public.notifications;
CREATE POLICY notifications_update_policy ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (studio_id IN (SELECT studio_id FROM public.studio_members WHERE user_id = auth.uid()))
  WITH CHECK (studio_id IN (SELECT studio_id FROM public.studio_members WHERE user_id = auth.uid()));

REVOKE ALL ON TABLE public.notifications FROM anon;
REVOKE ALL ON TABLE public.notifications FROM authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;

-- Deliberately no INSERT policy or privilege for anon or authenticated:
-- notifications are produced only by trusted server-side code using the
-- service-role client, which bypasses RLS. A future Support/operational
-- producer calls the shared helper in src/lib/notifications.ts rather than
-- inserting directly from a studio-facing route.

COMMIT;
