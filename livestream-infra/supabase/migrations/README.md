# supabase/migrations

Control-plane schema migrations for the media pipeline: `media_nodes`, `events` (extended fields), `stream_sessions`, `media_jobs`, and `event_state_transitions`. Field-level requirements are defined in `../../03_DATA_MODEL_AND_API_CONTRACTS.md` ("Required control-plane entities").

Migrations here are additive only. An already-applied migration must never be edited (`../../09_CLAUDE_CODE_EXECUTION_RULES.md`, "Database rules"). Supabase stores business and aggregate media state only — it must never receive one row per HLS segment; per-segment state belongs in the media node's local SQLite database (`services/media-agent`).

No migrations exist yet — placeholder created during the Phase 0 repository baseline.
