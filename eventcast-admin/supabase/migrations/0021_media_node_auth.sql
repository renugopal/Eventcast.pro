-- ============================================================
-- Migration 0021: Media Agent machine-auth schema (node credentials + replay protection)
--
-- Schema-only. No routes, no verification functions, no rate-limiting
-- code, no cleanup jobs, no UI, no data. This migration creates exactly
-- two service-role-only tables and does not alter public.media_nodes,
-- public.media_event_assignments, public.events, or any other existing
-- table.
--
-- V1 node authentication uses a high-entropy bearer token over mandatory
-- HTTPS. Admin stores only a lowercase-hex HMAC-SHA256(pepper, token)
-- digest - never the raw token. The pepper is a server-only environment
-- secret and is never stored in this schema.
-- ============================================================

-- ============================================================
-- STEP 1: public.media_node_credentials
--
-- Stores only peppered HMAC-SHA256 digests, never raw bearer tokens.
-- Internal, service-role-only.
-- ============================================================

CREATE TABLE public.media_node_credentials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE RESTRICT, not CASCADE: credential rows - including revoked
  -- ones - are retained as security/audit history, so deleting a
  -- media_nodes row must never silently hard-delete that history. Media
  -- nodes should normally be retired via status (see media_nodes.status),
  -- not deleted; any exceptional node deletion must first go through an
  -- explicit credential-history disposition process. Contrast with
  -- media_node_request_nonces below, which stays ON DELETE CASCADE since
  -- nonce rows are temporary replay-protection data, not permanent history.
  media_node_id  uuid NOT NULL REFERENCES public.media_nodes(id) ON DELETE RESTRICT,
  slot           smallint NOT NULL CHECK (slot IN (1, 2)),
  digest         text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz NULL CHECK (revoked_at IS NULL OR revoked_at >= created_at),

  -- Global: two different tokens ever colliding on the same digest is
  -- cryptographically negligible; this is a defense-in-depth safety net
  -- so a duplicate digest surfaces as a constraint violation rather than
  -- an ambiguous "which node does this credential belong to" state.
  CONSTRAINT media_node_credentials_digest_key UNIQUE (digest)
);

-- slot 1 and slot 2 support bounded overlap during credential rotation: a
-- replacement credential can be issued into the other slot and deployed
-- to the node before the old slot's credential is revoked, with no hard
-- cutover outage.
COMMENT ON TABLE public.media_node_credentials IS
  'Internal, service-role-only Media Agent node credential store. Stores only peppered HMAC-SHA256(pepper, token) digests, never raw bearer tokens. slot 1 and slot 2 support bounded overlap during credential rotation. Revoked rows are retained as history, never deleted.';

COMMENT ON COLUMN public.media_node_credentials.digest IS
  'Hex-encoded HMAC-SHA256(pepper, token). Never the raw token; the pepper is a server-only environment secret never stored in this table.';

COMMENT ON COLUMN public.media_node_credentials.revoked_at IS
  'NULL = active. Non-null = revoked. Rows are never hard-deleted; revoked rows are retained as history.';

CREATE INDEX idx_media_node_credentials_media_node_id
  ON public.media_node_credentials (media_node_id);

-- Enforces at most one ACTIVE row per (media_node_id, slot) - and
-- therefore at most two active credentials per node - while any number
-- of historical revoked rows for the same node/slot remain permitted,
-- since this partial index only applies where revoked_at IS NULL.
CREATE UNIQUE INDEX idx_media_node_credentials_active_slot
  ON public.media_node_credentials (media_node_id, slot)
  WHERE revoked_at IS NULL;

-- ============================================================
-- STEP 2: public.media_node_request_nonces
--
-- Provides atomic, multi-instance replay protection: a UNIQUE constraint
-- on (media_node_id, request_id) means an INSERT attempting to reuse a
-- previously-accepted request_id for the same node fails with a
-- constraint conflict, safely and atomically even across concurrent
-- requests hitting different Admin instances. Internal,
-- service-role-only.
-- ============================================================

CREATE TABLE public.media_node_request_nonces (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_node_id  uuid NOT NULL REFERENCES public.media_nodes(id) ON DELETE CASCADE,
  request_id     text NOT NULL CHECK (request_id ~ '^[0-9a-f]{32}$'),
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL CHECK (expires_at > accepted_at),

  CONSTRAINT media_node_request_nonces_node_request_key UNIQUE (media_node_id, request_id)
);

-- request_id follows the Media Agent's current 128-bit lowercase-hex
-- format (client.go's newRequestID(): 16 random bytes, hex-encoded).
COMMENT ON COLUMN public.media_node_request_nonces.request_id IS
  'The Media Agent''s X-EventCast-Request-Id (== X-EventCast-Idempotency-Key for this V1 GET): 128-bit random value, lowercase-hex-encoded, exactly 32 characters.';

COMMENT ON TABLE public.media_node_request_nonces IS
  'Internal, service-role-only replay-protection store. Atomic, multi-instance-safe via UNIQUE (media_node_id, request_id): duplicate acceptance of the same request_id for the same node is rejected by the database itself, not by an application-level check.';

CREATE INDEX idx_media_node_request_nonces_expires_at
  ON public.media_node_request_nonces (expires_at);

-- ============================================================
-- STEP 3: Row Level Security
--
-- Both tables are internal Media Agent machine-auth state, written by a
-- future authenticated, service-role-only internal API - not by end
-- users. RLS is enabled with zero anon/authenticated policies so only
-- the service role (which bypasses RLS) can access these tables until an
-- explicit future ADR defines otherwise. No existing table's RLS is
-- altered by this migration.
-- ============================================================

ALTER TABLE public.media_node_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_node_request_nonces ENABLE ROW LEVEL SECURITY;
