# supabase/migrations

Control-plane schema migrations for the media pipeline: `media_nodes`, `events` (extended fields), `stream_sessions`, `media_jobs`, and `event_state_transitions`. Field-level requirements are defined in `../../03_DATA_MODEL_AND_API_CONTRACTS.md` ("Required control-plane entities").

Migrations here are additive only. An already-applied migration must never be edited (`../../09_CLAUDE_CODE_EXECUTION_RULES.md`, "Database rules"). Supabase stores business and aggregate media state only — it must never receive one row per HLS segment; per-segment state belongs in the media node's local SQLite database (`services/media-agent`).

The actual SQL lives in the application repo, not here: this directory documents it for the architecture pack.

## Active migration sequence (Media Agent control-plane slice)

The controlled, safe-to-apply sequence for this slice is:

1. `0018_wishes_auto_studio.sql` — unrelated Wishes `studio_id` auto-derivation trigger; independent of the Media Agent schema below.
2. `0019_livestream_control_plane.sql` — **intentional no-op supersession marker.** The original design described below (media_nodes, stream_sessions, media_jobs, event_state_transitions, and additive `events` columns) was never applied to the production remote database and has been superseded by `0020`/`0021`. The active file now makes no schema or data changes at all, so a standard sequential migration runner can record version 0019 and continue safely to 0020 without recreating an incompatible `media_nodes` shape. **Operators must not apply the archived original SQL** preserved at `eventcast-admin/supabase/superseded-migrations/0019_livestream_control_plane.original.sql` — that file exists purely as historical design documentation.
3. `0020_media_agent_assignments.sql` — creates the actual, reconciled `public.media_nodes` and `public.media_event_assignments`.
4. `0021_media_node_auth.sql` — creates `public.media_node_credentials` and `public.media_node_request_nonces`; depends on `0020`'s `media_nodes`.

**Stop-and-reconcile condition:** if any environment is found to already contain `stream_sessions`, `media_jobs`, `event_state_transitions`, or a `media_nodes` table matching the original (wider) 0019 shape described below, migration application must stop immediately for manual reconciliation — do not attempt to auto-resolve this by applying either version of 0019.

## Migration file (historical design — see "Active migration sequence" above for current status)

`eventcast-admin/supabase/migrations/0019_livestream_control_plane.sql` originally held the design described in this section — first control-plane schema migration (Phase 0, Task 5). Additive only: no `DROP`, no destructive `ALTER`, no renamed/removed columns. Uses `TEXT` + `CHECK` for all state enums (consistent with the majority of prior migrations in that directory, e.g. `0008_stream_alerts.sql`, `0009_deployment_status.sql`, `0014_platform_roles.sql`) rather than `CREATE TYPE ... AS ENUM`, so no new Postgres enum types are introduced. **This design was never applied and the active migration file no longer contains it** — it is preserved only at `eventcast-admin/supabase/superseded-migrations/0019_livestream_control_plane.original.sql` for historical reference; the rest of this document describes that archived design as originally authored.

## Schema purpose

- **`media_nodes`** — one row per media node (Hetzner host running SRS + the Media Agent). Tracks health/capacity so the scheduler can pick an assignable node. `status` and `maintenance_mode` gate new assignments per ADR-014; `hard_stream_limit` / `active_stream_count` enforce the V1 ten-stream-per-node safety limit.
- **`events` (extended)** — adds the livestream fields required by `03_DATA_MODEL_AND_API_CONTRACTS.md`: `playback_id` (opaque, unlisted-discovery identifier, ADR-020), `ingest_id`/`stream_secret_hash` (publish authorization), `assigned_media_node_id` (current node assignment), `media_state` (the lifecycle state machine from `02_V1_ARCHITECTURE_SPEC.md` "Event lifecycle"), publish/schedule windows, YouTube relay flags (ADR-012), and the VOD/archive/retention timestamps that gate cleanup (ADR-009, ADR-010, ADR-023).
- **`stream_sessions`** — one row per accepted publisher connection. A reconnect always creates a new row; an existing session is never reopened or have its identity mutated.
- **`media_jobs`** — aggregate per-event jobs only (`finalize_vod`, `create_mp4`, `archive_to_wasabi`, `restore_to_r2`, `delete_r2_hot_copy`). Never one row per HLS segment.
- **`event_state_transitions`** — append-only audit log of every `media_state` change. A `BEFORE UPDATE OR DELETE` trigger (`trg_event_state_transitions_no_update`) enforces append-only at the database level, not just by convention.

## Table relationships

```
media_nodes  <── assigned_media_node_id ── events
media_nodes  <── media_node_id (ON DELETE RESTRICT) ── stream_sessions ── event_id (ON DELETE CASCADE) ──> events
media_nodes  <── worker_node_id (ON DELETE RESTRICT) ── media_jobs ── event_id (ON DELETE CASCADE) ──> events
events       <── event_id (ON DELETE CASCADE) ── event_state_transitions
```

`stream_sessions`/`media_jobs` use `ON DELETE RESTRICT` toward `media_nodes` because nodes are decommissioned via `status = 'retired'`, not row deletion — a historical session/job record should never silently lose its node reference. `assigned_media_node_id` on `events` uses `ON DELETE SET NULL` since that column reflects current assignment, not history.

## Important constraints

- `media_nodes.status` restricted to `provisioning | healthy | degraded | unavailable | retired`; partial index `idx_media_nodes_assignable` supports "healthy nodes outside maintenance mode" scheduler queries.
- `events.media_state` restricted to the exact lifecycle vocabulary in `02_V1_ARCHITECTURE_SPEC.md`: `scheduled, ready, live, interrupted, ending, finalizing, vod_ready, archiving, archived, cancelled`. `event_state_transitions.from_state`/`to_state` use the same vocabulary so the audit log can never record an undefined state.
- `stream_sessions.status` restricted to `starting | active | disconnected | finalized | failed`; `r2_confirmed_count <= segment_count` is enforced by a `CHECK`.
- `media_jobs.type` restricted to the five required job types; `media_jobs.status` restricted to `queued | running | paused | retry_wait | succeeded | failed_recoverable | cancelled`; `media_jobs.last_error_code` restricted (when not null) to the exact error-category list in `03_DATA_MODEL_AND_API_CONTRACTS.md` ("Error model").
- `events.scheduled_end_at > scheduled_start_at` and `events.publish_window_end_at > publish_window_start_at` are enforced (when both bounds are present) via named `CHECK` constraints added through a `DO $$ ... EXCEPTION WHEN duplicate_object` block, since PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`.
- `events.playback_id` and `events.ingest_id` are `UNIQUE` (nulls allowed for pre-existing rows).
- No secrets are stored: `stream_secret_hash` is a hash, and `youtube_secret_reference` is a pointer into the approved secret store, never a raw credential.

## RLS

RLS is enabled on all four new/existing tables. **No new anon/authenticated policies were added** for `media_nodes`, `stream_sessions`, `media_jobs`, or `event_state_transitions`: these are internal control-plane tables written by the Media Agent / internal API via the service role (`03_DATA_MODEL_AND_API_CONTRACTS.md`, "Internal control-plane API"), and the governing documents do not define a studio-facing read/write permission model for node internals, session telemetry, job state, or the audit log. Per `09_CLAUDE_CODE_EXECUTION_RULES.md` ("do not invent user-facing permissions"), access is left service-role-only until an explicit ADR defines a studio-facing view (the existing `events` RLS policies from `0003_rls_policies.sql` are untouched and continue to apply to the base table).

## Rollback considerations

This migration is purely additive, so rollback is straightforward but must be explicit (no down-migration is defined, consistent with the rest of this migration directory):

- New tables (`media_nodes`, `stream_sessions`, `media_jobs`, `event_state_transitions`) can be dropped without affecting any pre-existing table.
- New `events` columns can be dropped individually; none replace or rename an existing column, so dropping them cannot break code that hasn't yet been written against them.
- The `event_state_transitions` append-only trigger and its function should be dropped before dropping the table, though `DROP TABLE` would remove both regardless.
- Because nothing here is consumed by application code yet (Phase 0), rollback carries no data-loss risk beyond the control-plane rows themselves.

## Validation commands

Runtime execution was **deferred** in this task (no Supabase CLI or dev database was available locally, and the workflow forbids installing tooling or touching the GCP VM/production). When a dev database is available, validate with:

```bash
supabase db lint                         # static lint against the migration
supabase db reset                        # replay all migrations 0001..0021 from scratch
                                          # (0019 now replays as a no-op; media_nodes is
                                          # actually created by 0020, not 0019)
supabase db diff --schema public         # confirm no drift after applying
```

Then functionally verify:

```sql
-- Confirm the lifecycle vocabulary round-trips
insert into events (id, studio_id, slug, title) values (...) returning media_state; -- expect 'scheduled'

-- Confirm append-only enforcement
update event_state_transitions set reason_code = 'x' where id = '...'; -- expect exception

-- Confirm FK integrity
select conname, conrelid::regclass, confrelid::regclass from pg_constraint where conrelid::regclass::text in
  ('media_nodes','stream_sessions','media_jobs','event_state_transitions');
```

## Known Phase 0 limitations

- Existing rows in `events` backfill to `media_state = 'scheduled'` and `auto_end_grace_seconds = 10800` by column default; this is not necessarily historically accurate for already-completed events. A follow-up data migration/backfill should set correct historical `media_state` (e.g. `archived`) before this column is relied upon for production filtering.
- No studio-facing RLS read policy exists yet for stream/session/job status (see "RLS" above) — any admin dashboard surfacing this data must read through the internal API (service role) rather than a client-side Supabase query, until a signed-off ADR adds one.
- `retention_policy_id` is a bare identifier column; no `retention_policies` table is defined in the approved data model, so this migration does not invent one.
- This migration does not create the SQLite local schema (`cached_event_assignments`, `ingest_sessions`, `segment_jobs`, `manifest_generations`, `youtube_relays`, `archive_jobs`, `agent_outbox`) — that is Media Agent scope (`services/media-agent`), not Supabase.
- Runtime migration execution against a real Postgres instance is deferred; only static SQL review was performed (see the Task 5 commit report for details).
