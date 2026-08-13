-- Backblaze B2 authoritative VOD archival: durable per-event archive and
-- control-plane report state.
--
-- One authoritative row per event, matching the cardinality
-- vod_finalizations already establishes (event_id PRIMARY KEY) and the
-- control plane's own event_recordings.event_id UNIQUE. This is a work and
-- outbox record, not a history table: it always describes the newest
-- finalization generation that must be archived, converging forward if a
-- late segment causes re-finalization.
--
-- Deliberately holds no credential, no endpoint, and no secret of any kind
-- - only non-secret storage identity (bucket name and object key) plus
-- evidence. The archiver's byte source is the local spool, so nothing here
-- needs to describe how to reach B2.
CREATE TABLE b2_archives (
    event_id             TEXT PRIMARY KEY,

    -- The finalization generation this row is about. Written by the
    -- enqueue path from FinalizationGeneration(); an archive completed for
    -- an older generation is stale by definition once this changes.
    generation           TEXT NOT NULL,

    -- pending   : enqueued, archival not yet completed for `generation`
    -- archiving : an archival pass is in flight (treated as pending after a
    --             restart - archival is idempotent, so redoing it is safe)
    -- archived  : every segment object and the playlist are present in B2
    --             and passed post-PUT size/metadata verification
    -- failed    : the last pass failed; retried after next_attempt_at
    state                TEXT NOT NULL DEFAULT 'pending'
                             CHECK (state IN ('pending', 'archiving', 'archived', 'failed')),

    -- Non-secret storage identity of the archived generation.
    bucket               TEXT NOT NULL DEFAULT '',
    playlist_key         TEXT NOT NULL DEFAULT '',
    object_count         INTEGER NOT NULL DEFAULT 0,

    -- JSON array of the distinct playback ids the finalized segment set
    -- covers. This is the provenance the control plane compares against the
    -- event's complete activation history before allowing an
    -- Event-authoritative transition.
    covered_playback_ids TEXT NOT NULL DEFAULT '',

    -- Mirrors vod_finalizations' authoritative gap semantics exactly. No
    -- new gap vocabulary is introduced here.
    gap_count            INTEGER NOT NULL DEFAULT 0,
    gap_status           TEXT NOT NULL DEFAULT 'none'
                             CHECK (gap_status IN ('none', 'pending_review', 'acknowledged', 'rejected')),

    -- Strong BYTE-INTEGRITY verification, which is strictly stronger than
    -- "archived". Presence in B2 plus matching size and our own sha256 user
    -- metadata proves the object is there and self-consistent; it does not
    -- prove B2's stored bytes hash to that value. Whether the real
    -- Backblaze S3 endpoint accepts and enforces x-amz-checksum-sha256 is
    -- unproven, so this stays 0 on every production path until an isolated
    -- connectivity test settles it. Retention freeze depends on this, and
    -- therefore correctly cannot occur yet.
    strong_verified      INTEGER NOT NULL DEFAULT 0 CHECK (strong_verified IN (0, 1)),

    -- Local finalization evidence, carried to the control plane as source
    -- evidence only. Authoritative b2/integrity timestamps are assigned
    -- server-side and never taken from this node.
    local_finalized_at   TEXT NOT NULL DEFAULT '',
    archived_at          TEXT NOT NULL DEFAULT '',

    archive_attempts     INTEGER NOT NULL DEFAULT 0,
    next_attempt_at      TEXT NOT NULL DEFAULT '',
    last_error           TEXT NOT NULL DEFAULT '',

    -- Durable report outbox. reported_generation/reported_state record what
    -- the control plane has actually acknowledged, so a lost response is
    -- safe to retry (the transition RPC is idempotent) and a generation the
    -- control plane declined to adopt can be settled instead of retried
    -- forever.
    reported_generation  TEXT NOT NULL DEFAULT '',
    reported_state       TEXT NOT NULL DEFAULT '',
    reported_at          TEXT NOT NULL DEFAULT '',
    report_attempts      INTEGER NOT NULL DEFAULT 0,
    next_report_at       TEXT NOT NULL DEFAULT '',
    report_last_error    TEXT NOT NULL DEFAULT '',

    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
);

-- Drives the archival worker's "what needs work now" scan.
CREATE INDEX idx_b2_archives_state_next_attempt ON b2_archives(state, next_attempt_at);

-- Drives the reporter's "what still needs acknowledgement" scan.
CREATE INDEX idx_b2_archives_next_report ON b2_archives(next_report_at);
