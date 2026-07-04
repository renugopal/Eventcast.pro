-- Production Readiness and Operations (v1.2): durable control-plane sync
-- state, assignment provenance, and explicit VOD-gap operator resolution.

-- Distinguishes a bootstrap/dev seed-file row from one populated by a real
-- control-plane sync, and records when it was last confirmed current, so a
-- stale seed can never be mistaken for fresh control-plane state
-- (09_CLAUDE_CODE_EXECUTION_RULES.md; mission requirement: "Static
-- assignment seeds ... must not silently override fresher control-plane
-- state").
ALTER TABLE cached_event_assignments ADD COLUMN source TEXT NOT NULL DEFAULT 'seed'
    CHECK (source IN ('seed', 'controlplane'));
ALTER TABLE cached_event_assignments ADD COLUMN synced_at TEXT NOT NULL DEFAULT '';

-- Single-row durable record of the control-plane assignment sync's own
-- health, independent of any individual assignment: last success/attempt
-- time, last error, and the control plane's reported config_version. This
-- is what readiness, metrics, and the stale-cache/alert policy read -
-- 03_DATA_MODEL_AND_API_CONTRACTS.md "agent_outbox MUST persist
-- control-plane status messages until acknowledged, allowing the media
-- plane to operate during a temporary control-plane outage" describes the
-- equivalent durability requirement for the sync direction back to the
-- control plane; this table is its counterpart for the pull direction.
CREATE TABLE controlplane_sync_state (
    id                   INTEGER PRIMARY KEY CHECK (id = 1),
    last_attempt_at      TEXT NOT NULL DEFAULT '',
    last_success_at      TEXT NOT NULL DEFAULT '',
    last_error           TEXT NOT NULL DEFAULT '',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    config_version       TEXT NOT NULL DEFAULT '',
    updated_at           TEXT NOT NULL DEFAULT ''
);

-- Explicit VOD-gap state (02_V1_ARCHITECTURE_SPEC.md "VOD finalization":
-- "Finalization MUST wait until all discovered local segment jobs for the
-- event are resolved or an operator explicitly accepts a documented gap").
-- gap_status is independent of status: a VOD can be durably 'finalized'
-- (a valid, playable playlist was published) while its gap_status remains
-- 'pending_review' because it is missing one or more permanently
-- unresolvable segments. 'none' means the finalized playlist is gapless.
ALTER TABLE vod_finalizations ADD COLUMN gap_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vod_finalizations ADD COLUMN gap_status TEXT NOT NULL DEFAULT 'none'
    CHECK (gap_status IN ('none', 'pending_review', 'acknowledged', 'rejected'));
ALTER TABLE vod_finalizations ADD COLUMN gap_resolution_actor TEXT NOT NULL DEFAULT '';
ALTER TABLE vod_finalizations ADD COLUMN gap_resolution_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE vod_finalizations ADD COLUMN gap_resolved_at TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_vod_finalizations_gap_status
    ON vod_finalizations(gap_status)
    WHERE gap_status = 'pending_review';

-- Append-only audit trail for every VOD-gap resolution attempt (accepted
-- or rejected), independent of the current-state columns above so the
-- full history of who resolved what, and when, always survives even if
-- the current resolution is later reasoned about or (in a future
-- version) reopened.
CREATE TABLE vod_gap_audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   TEXT NOT NULL,
    action     TEXT NOT NULL CHECK (action IN ('acknowledge', 'reject')),
    actor      TEXT NOT NULL,
    reason     TEXT NOT NULL DEFAULT '',
    gap_count  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_vod_gap_audit_event
    ON vod_gap_audit(event_id, created_at);
