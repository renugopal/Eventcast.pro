-- Livestream Reliability & Operations Package: durable AutoFinalizer
-- eligibility (invariant I1 - never finalize while a stream/session is
-- still legitimately active; finalization is idempotent).
--
-- Two tables with deliberately separate responsibilities:
--
--   event_finalization_intents  what the event should do next (one row per
--                               event). Reactivation and intent creation act
--                               only on this table.
--   event_finalization_claims   a VODFinalizer invocation is running for the
--                               event right now (at most one row per event).
--                               Reactivation NEVER touches this table, so a
--                               cycle bump can never hide a running attempt
--                               from on_publish.
--
-- Intent state:
--   pending     created by revocation / window expiry / operator request
--   finalizing  an attempt holds (or held) a claim for this cycle
--   finalized   the VOD finalizer reported finalized=true for this cycle
--   failed      the last attempt errored; retried after next_attempt_at
--   cancelled   the event became publishable again (reactivation, window
--               extension, new assignment) - never executable; a later
--               End/expiry re-opens it as a fresh 'pending' intent
-- cause: revoked | window_expired | operator
--
-- cycle is a per-event epoch, incremented whenever a new publish cycle
-- begins (reactivation of a pending/failed/finalizing/finalized intent).
-- Every intent completion is a compare-and-set on (event_id, cycle,
-- state='finalizing'), so a superseded attempt can never overwrite the new
-- cycle's state.
--
-- finalized_generation is the finalization-generation fingerprint
-- (internal/upload.FinalizationGeneration) of the segment set published
-- when this intent reached 'finalized'. '' means "no successful
-- finalization recorded for the current intent" - the empty-string-for-
-- absent convention every optional TEXT column in this schema uses. It is
-- cleared whenever the row leaves 'finalized' or is re-opened.
CREATE TABLE event_finalization_intents (
    event_id             TEXT PRIMARY KEY,
    state                TEXT NOT NULL CHECK (state IN ('pending', 'finalizing', 'finalized', 'failed', 'cancelled')),
    cause                TEXT NOT NULL CHECK (cause IN ('revoked', 'window_expired', 'operator')),
    cycle                INTEGER NOT NULL DEFAULT 0,
    intent_at            TEXT NOT NULL,
    attempts             INTEGER NOT NULL DEFAULT 0,
    last_attempt_at      TEXT NOT NULL DEFAULT '',
    next_attempt_at      TEXT NOT NULL DEFAULT '',
    last_error_category  TEXT NOT NULL DEFAULT '',
    last_skip_reason     TEXT NOT NULL DEFAULT '',
    finalized_generation TEXT NOT NULL DEFAULT '',
    finalized_at         TEXT NOT NULL DEFAULT '',
    updated_at           TEXT NOT NULL
);

CREATE INDEX idx_event_finalization_intents_state ON event_finalization_intents (state);

-- A claim is created in the same transaction that moves an intent to
-- 'finalizing', renewed (compare-and-set on claim_token only, so renewal
-- keeps working across a reactivation cycle bump) while the VODFinalizer
-- invocation runs, and deleted only after that invocation has returned.
-- Every row is deleted at agent startup, before SRS callbacks are
-- accepted: a single agent process owns this database, so no claim can
-- outlive the process that created it. lease_until is the crash backstop.
CREATE TABLE event_finalization_claims (
    event_id    TEXT PRIMARY KEY,
    cycle       INTEGER NOT NULL,
    claim_token TEXT NOT NULL,
    lease_until TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    renewed_at  TEXT NOT NULL
);
