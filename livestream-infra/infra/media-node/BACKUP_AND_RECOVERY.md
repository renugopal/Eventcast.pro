# Media node backup and recovery

## What is recoverable from R2 without a local backup

Every segment that reached `R2_CONFIRMED` and every published live/VOD manifest and VOD-gap-relevant metadata already lives durably in Cloudflare R2 (`02_V1_ARCHITECTURE_SPEC.md` "R2 object layout"). If a media node's local disk were lost entirely *after* an event's segments were confirmed and its VOD finalized, the finalized recording itself is not lost — R2 still has it. This is the whole point of ADR-006/ADR-007/ADR-010's durability design.

## What is NOT recoverable from R2 and MUST be backed up locally

The Media Agent's local SQLite database (`EVENTCAST_DB_PATH`) is the only durable copy of:

- The assignment cache (`cached_event_assignments`) — which ingest ids are currently authorized, their hashed secrets, publish windows, and (with continuous control-plane sync) the last-synced control-plane state.
- In-flight ingest sessions and the segment upload queue (`ingest_sessions`, `segment_jobs`) — anything not yet `R2_CONFIRMED` has no other durable copy at all.
- Manifest generation history, VOD finalization records **and their VOD-gap resolution/audit trail** (`manifest_generations`, `vod_finalizations`, `vod_gap_audit`) — an operator's documented acknowledge/reject decision on a gap exists only here.
- YouTube relay records and control-plane sync health (`youtube_relays`, `controlplane_sync_state`).

If this database is lost with no backup, an event that had *already reached* `VOD_READY` is still fully recoverable from R2 (rebuild `vod_finalizations` by re-running finalize against the confirmed R2 objects), but any segment still mid-upload, any pending operator gap decision, and the entire assignment cache are gone. **Back up this database regularly** — `compose/backup.sh` automates a consistent copy.

## What is intentionally never backed up

- **The local spool** (`EVENTCAST_SPOOL_ROOT`). Confirmed segments are already durable in R2; unconfirmed ones are protected by the durable queue and startup reconciliation, not by a spool-level backup. Backing up potentially many gigabytes of media that is either already in R2 or about to be uploaded there provides no additional durability per byte of backup storage spent.
- **The optional assignment seed JSON file** (`EVENTCAST_ASSIGNMENT_SEED_PATH`), if used. It may legitimately contain a raw `youtube_stream_key` (`services/media-agent/README.md` "YouTube relay authorization"). `backup.sh` deliberately excludes it so a backup artifact can never contain a real secret; its own durability is the operator's approved secret-management responsibility, and production is expected to move to continuous control-plane sync instead of a local secret-bearing seed file.

## Backup procedure

```bash
cd infra/media-node/compose
./backup.sh /var/backups/eventcast --apply
```

This briefly stops the `media-agent` container (SRS keeps running; any segments it produces during the pause are recovered by startup reconciliation exactly as after any other agent restart), copies the SQLite database directory (main file + WAL + SHM together, so the copy is consistent) to a timestamped destination, and restarts the container. Schedule this via cron/systemd-timer at whatever interval matches the acceptable data-loss window for pending uploads and operator gap decisions (a shorter interval bounds how much in-flight queue state a worst-case loss could affect).

## Restore procedure (production incident)

1. Stop the `media-agent` container.
2. Replace `DB_HOST_DIR`'s contents with the chosen backup's `db/` directory.
3. Start the container; startup reconciliation and migration run automatically.
4. Confirm `GET /readyz` returns `200` and `GET /metrics` shows the expected `media_agent_sessions`/`media_agent_segment_jobs` counts before resuming normal operation.

## Tested restore verification

`compose/restore-test.sh` proves this procedure actually works, using entirely isolated, throwaway temporary data (never production state, per this milestone's explicit requirement):

1. Starts a standalone, temporary media-agent container seeded with one synthetic assignment.
2. Proves an authorized publish succeeds (the assignment cache is populated).
3. Stops the container and copies its database directory (the same operation `backup.sh` performs).
4. Deletes the live database entirely, simulating total data loss.
5. Restores from the copy.
6. Restarts the container **without** the seed file this time, and proves the same publish still succeeds — the only way it can, since nothing reseeds the cache on this second start, is if the restored database genuinely contains the original assignment.

Run it with `./restore-test.sh`; it tears down all of its own containers, networks, images, and temp directories regardless of outcome, and never touches `/opt/eventcast/media-node`.
