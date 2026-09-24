-- ============================================================
-- Migration 0041: media_node_credentials.last_verified_at
--
-- Additive only. Adds one nullable, server-only evidence column recording
-- when a uniquely identified active credential slot last authenticated a
-- Media Agent control-plane request. Purpose: make it provable which of a
-- node's two active slots (migration 0021's two-slot rotation model) the
-- node is actually using, so a credential rotation never has to revoke a
-- slot based on age or assumption.
--
-- No default, no backfill, no index, no RLS/policy/grant change. The
-- table remains service-role-only (migration 0021). Plain ADD COLUMN (not
-- IF NOT EXISTS) is deliberate: this single statement has no retry-split
-- need, and unexpected pre-existing schema should fail visibly rather
-- than silently mask drift.
-- ============================================================

ALTER TABLE public.media_node_credentials
  ADD COLUMN last_verified_at timestamptz NULL;

COMMENT ON COLUMN public.media_node_credentials.last_verified_at IS
  'Time a request on an internal Media Agent route was authenticated by this uniquely identified active credential slot and passed structure checks, node lookup, credential verification, the node rate limit, and the atomic replay-nonce claim. Does not indicate that the downstream handler succeeded; a later business/validation failure does not invalidate the authentication fact. Not set when both slots match the same token. Refreshed at most about once per 5 minutes. Contains no token, digest, or pepper material. Server-only; never returned to clients.';
