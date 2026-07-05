# 08 — Operations Runbook

## Before an event

Confirm that the event is assigned to a healthy node, the publishing window is correct, the stream key is enabled, disk capacity is sufficient, R2 uploads are healthy, the Media Agent queue is empty or current, the live-manifest cache bypass is active, and the node is not in maintenance mode. Verify the encoder profile and perform a short private publish test when operationally possible.

For a YouTube-enabled event, verify that the secret reference resolves and the destination is scheduled. Do not expose or paste the key into logs or tickets.

## Start of live

The event enters LIVE only after a valid publisher is accepted and completed segments begin reaching R2. Confirm ingest bitrate, codec profile, local segment age, R2 confirmation lag, live manifest age, player playback, and YouTube relay status when enabled.

A running RTMP socket without new HLS segments is not considered healthy.

## During live

Watch active stream count, upload backlog, disk free space, segment errors, player fatal errors, and network utilization. Archive jobs should remain paused or throttled when the node is near configured live-workload thresholds.

Do not restart SRS or the Media Agent during a healthy event merely to apply noncritical changes. Defer updates until the node has no assigned critical stream.

## Manual End Live

Manual End Live changes the event to ENDING and prevents the event from being considered indefinitely live. The system waits for the publisher to stop or enforces the configured ending policy, then observes the quiet period before finalization.

Do not delete local files or revoke storage access while FINALIZING. Confirm VOD_READY and playback before communicating completion.

VOD finalization itself is an explicit step in the current Media Agent build, not a timer this service runs on its own: the control plane's scheduled-end-plus-grace-period and manual-End-Live decisions are both expected to call the same seam, `POST /internal/events/{event_id}/finalize` on the event's assigned node, rather than the Media Agent finalizing anything on its own initiative. Until that control-plane caller exists, an operator performs this step directly once the encoder has stopped and the event is confirmed complete: `curl -X POST -H "Authorization: Bearer $EVENTCAST_OPERATOR_API_TOKEN" http://<node-host>:8085/internal/events/<event_id>/finalize`. The call is idempotent and safe to repeat - an event that is not yet eligible (a session is still open, or a segment has not resolved) returns HTTP 202 with `finalized: false` and a human-readable reason rather than an error. Only treat the event as VOD_READY once a repeat call reports `finalized: true`.

## Publisher disconnected

Confirm whether the encoder and field network are still operating. The system should mark the event INTERRUPTED but preserve all media. Allow the encoder to reconnect with the same key while the event is still valid. A new session and HLS discontinuity are expected.

Do not finalize solely because of a short disconnect. Use manual End Live only when the operator knows the event is complete.

## R2 upload lag

If local segments continue but R2 lag grows, verify credentials, provider status, DNS, route, and node network. Do not force the public playlist to advance. Ensure disk space can absorb the backlog. Pause archive and other nonessential transfer jobs.

After recovery, confirm that queue age decreases, playlist advances in order, and no object is missing. If lag threatens disk safety, stop assigning new events and escalate before deleting any unconfirmed data.

## R2 outage

During an outage, the system intentionally retains local media and stops the playlist at the last confirmed object. Viewer playback may stall. Preserve the spool and queue. Do not switch to an untested direct-origin path during a live incident.

When R2 recovers, allow the durable queue to resume. Validate object count, playlist order, and player recovery. Document the provider incident and the maximum backlog.

## Media Agent failure

Check service status, logs, SQLite integrity, disk availability, and configuration. Restart only the agent first. It must reconcile the spool and resume jobs. If SQLite is damaged, preserve the database and spool before repair; never initialize a blank queue over existing media without a recovery scan.

## SRS failure

Restart SRS with the same persistent staging mount. The encoder must reconnect. Expect a new session and discontinuity. Confirm that previously captured files remain in the Media Agent durable spool, that the agent still owns the event, and that no existing R2 keys are overwritten.

## Node failure

Events not yet started may be reassigned to another healthy node and given the alternate ingest URL. An active RTMP event cannot be assumed to migrate seamlessly. Contact the field operator to switch to a backup destination when available.

After node recovery, preserve and reconcile its spool before reassigning new events. Segments created before the failure may still require upload.

## Disk pressure

At warning level, stop new assignments and pause archive/MP4 jobs. At critical level, investigate backlog and reclaim only files that satisfy documented deletion rules. Never delete pending or unverified segments. For an event that requires Wasabi archival, routine local-spool cleanup remains blocked until archive verification; using the emergency override requires operator approval, a validated complete R2 VOD, a critical alert, and an incident audit record.

If safe cleanup is insufficient, explicitly stop lower-priority future work and declare the node degraded. Data correctness has priority over hiding the incident.

## YouTube relay failure

Confirm EventCast HLS first. If primary playback is healthy, treat the incident as secondary. Check destination key validity, YouTube status, FFmpeg error category, and outbound connectivity. Restart the relay within policy. Do not restart SRS solely to repair YouTube.

## Archive failure

Leave the R2 copy intact. Correct credentials, network, or destination issues and resume the idempotent job. The event remains VOD_READY but not ARCHIVED. R2 cleanup must remain blocked.

## Restore from Wasabi

Create a restore job to a new or empty R2 event prefix. Copy the archive manifest first, then required objects, verify key set, size, and metadata, publish the VOD playlist last, and test playback through the production domain. Only then mark the VOD restored.

## Deployment and rollback

Deploy to a canary node with no critical event. Validate health, callback authorization, sample ingest, R2 upload, and playback. Roll one production node at a time. Do not deploy simultaneously to all nodes.

Rollback restores the previous pinned images and configuration while preserving spool and SQLite data. Database migrations must have a tested backward or forward recovery plan before rollout.

## Incident record

Every serious incident must record event IDs, node, software/config versions, timeline, customer impact, provider status, media lost or preserved, recovery actions, and preventive change. Never include raw stream keys or storage secrets.


## Stale or missing live manifest

Check the production custom-domain response headers and Cloudflare cache status. Confirm that live manifest paths bypass cache and that a prior 404 has not been negatively cached. Purge only the affected manifest URL when necessary; do not purge immutable segment prefixes as a routine response. Verify the R2 object directly through the S3 API before changing the uploader or playlist state.
