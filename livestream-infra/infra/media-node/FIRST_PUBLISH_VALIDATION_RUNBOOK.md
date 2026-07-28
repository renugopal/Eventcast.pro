# First-Publish Validation Runbook (SRS + Media Agent, Slice 5)

This is a **future, manual staging runbook** for an authorized operator. It
describes an intended procedure; it does not execute or automate anything.
No step in this document was run as part of producing it. Every step that
touches a real node, a real Supabase project, a real encoder, or any other
real system is explicitly labeled **[Requires separate authorization]** and
must not be run without that authorization.

This document contains no real secrets, tokens, project references,
hostnames, credentials, database URLs, internal URLs, or storage URLs.
Everywhere a real value would appear, one of the following placeholders is
used instead:

- `<node-name>`
- `<node-ingest-hostname>`
- `<event-id>`
- `<ingest-id>`
- `<raw-publish-token>`
- `<playback-id>`
- `<r2-public-base-url>`

## Why this ordering

The assignments-polling endpoint does not read or enforce `media_nodes`
node-liveness signals (`status`, `maintenance_mode`, `last_heartbeat_at`) —
confirmed directly in migration `0020_media_agent_assignments.sql`'s own
comment. **There is no heartbeat writer anywhere in this system** (neither
an Admin route nor a Go Media Agent symbol implements one). This means
activating an assignment proves nothing by itself about whether the target
node's Media Agent process is even running, correctly configured, or
reachable from the control plane.

The only locally-observable stand-in for liveness that exists today is a
successful control-plane sync log line
(`"control-plane assignment sync succeeded"`) emitted by that specific
node's own Media Agent process. **This is a temporary liveness proxy, not a
heartbeat** — it only tells you the agent successfully polled at some point
in the past; it does not continuously attest liveness the way a heartbeat
would. Because of this, the steps below deliberately confirm node
liveness *before* activation, not after, so an operator does not activate an
assignment for a node that turns out to be down, misconfigured, or pointed
at the wrong node identifier.

## Procedure

1. **[Requires separate authorization]** Confirm the target node's
   `media_nodes.name` value (`<node-name>`) and that it exactly matches the
   value the intended Go Media Agent process will be started with as
   `EVENTCAST_NODE_ID`. These two values must be byte-identical — the
   assignments-polling endpoint resolves a node by this exact name.

2. **[Requires separate authorization]** Start (or confirm already running)
   that node's Go Media Agent process with `EVENTCAST_CONTROLPLANE_BASE_URL`
   and `EVENTCAST_CONTROLPLANE_NODE_TOKEN` configured. **Before proceeding to
   step 4**, confirm a successful control-plane sync log line from this
   process. Remember: this confirms the agent polled successfully once: it
   is a liveness proxy, not a heartbeat, and it does not guarantee the agent
   is still alive by the time you activate an assignment. Re-check this
   immediately before activating if any meaningful time has passed.

3. **[Requires separate authorization]** Confirm the relevant Supabase
   migrations (`0020_media_agent_assignments.sql`,
   `0021_media_node_auth.sql`) are applied to the real project being used
   for this validation pass. This cannot be verified from local files alone.

4. **[Requires separate authorization]** Create or verify the test event
   (`<event-id>`) and confirm its draft `media_event_assignments` stub row
   exists (`enabled = false`, only `event_id` populated).

   **Required for this first validation pass:** the assignment's
   `youtube_enabled` must remain `false`. The current assignments-polling
   endpoint fails the *entire* request closed (HTTP 503) whenever it would
   need to serve a `youtube_enabled = true` assignment, because no
   secret-store resolver for the raw YouTube stream key exists yet. Do not
   enable YouTube relay for this test.

5. **[Requires separate authorization]** Only now — after step 2's liveness
   check has passed — activate the assignment as operator
   (`POST /internal/media/assignments/{event_id}/activate`). Securely record
   the one-time response.

   **Activation response handling:** the response currently contains an
   `ingestUrl` (embedding `<ingest-id>` in its path) and a one-time raw
   `<raw-publish-token>`. It does **not** currently include `playback_id` —
   that value is generated and persisted by activation but is not returned
   to the operator in this response. See step 6 for how to retrieve it. Do
   not log, paste into chat tools, or otherwise persist the raw token or
   ingest URL anywhere outside this validation pass's own secure notes.

6. **[Requires separate authorization — database-administrator-only]**
   Retrieve `<playback-id>` for `<event-id>` via a direct, read-only
   Supabase query against `media_event_assignments`.

   This is a **temporary staging workaround only**, not the permanent
   operating model:
   - It must be performed only by someone with legitimate, already-granted
     direct database access (e.g., a DBA or engineer using the Supabase SQL
     editor or an authorized service-role-scoped script), never by an
     ordinary operator running a studio UI action.
   - Service-role credentials, a direct Postgres connection string, or any
     internal query capability must never be embedded in, proxied through,
     exposed to, or made reachable from browser code, studio UI, an
     ordinary-operator-facing tool, or any client-side tooling.
   - This step exists only because the activation response does not yet
     return `playback_id` (see step 5). The intended permanent fix is a
     dedicated, non-secret, operator-facing retrieval path — explicitly
     deferred and not part of this slice. Do not treat direct SQL access as
     a long-term substitute for that.

7. **[Requires separate authorization]** Configure the encoder exactly as:

   - **OBS or Kiloview Server:** `rtmp://<node-ingest-hostname>/live`
   - **OBS or Kiloview Stream Key:** `<ingest-id>?token=<raw-publish-token>`

   This matches the documented V1 protocol convention (`02_V1_ARCHITECTURE_SPEC.md`
   "Protocols": the encoder-facing stream key uses the form
   `<ingest_id>?token=<secret>`) and the fixed RTMP application name (`live`)
   the Media Agent's SRS configuration and YouTube-relay source URL both
   assume.

8. **[Requires separate authorization]** Before publishing, confirm — within
   one control-plane sync interval (default 30 seconds, plus backoff if the
   first attempt after activation fails) — that the target node's Media
   Agent log shows the newly enabled assignment was applied (an "applied"
   count greater than zero in a subsequent sync log line, or the ingest id
   otherwise becoming recognized).

9. **[Requires separate authorization]** Begin publishing. Confirm SRS's
   `on_publish` callback was accepted in the Media Agent's logs. Confirm no
   raw publish token appears in any log line anywhere in this pass — the
   Media Agent's callback handler is designed to log only the ingest id and
   event id, never the token or its hash.

10. **[Requires separate authorization]** Confirm `on_hls` segment capture
    and R2 upload progress in the Media Agent's logs/metrics.

11. **[Requires separate authorization]** Confirm live-manifest
    availability by fetching
    `<r2-public-base-url>/events/<playback-id>/live/index.m3u8` **directly**
    (not through the public event page). The active public event renderer
    (`workers/render-event-page`) still serves playback exclusively from
    `event.restreamer_hls_url` (Restreamer) and must not be changed during
    this slice — so this manifest URL cannot yet be checked through the live
    site, only directly against R2.

12. **[Requires separate authorization]** Load the manifest URL from step 11
    in a standalone HLS-capable player (not the public event page) and
    confirm playback.

13. **[Requires separate authorization]** Stop publishing. Confirm SRS's
    `on_unpublish` callback closed the session in the Media Agent's logs.
    Confirm no event/VOD finalization was triggered as a side effect (out of
    scope for this validation pass).

## Explicitly excluded from this runbook

- Any change to Restreamer or any active Restreamer runtime route.
- Any change to the public event-page playback path.
- YouTube relay validation (blocked by step 4's `youtube_enabled = false`
  requirement until a secret-store resolver exists).
- B2 (or Wasabi) finalization/archival validation — unimplemented either
  way; a separate future concern.
- Any heartbeat implementation — this system has none; step 2's sync-log
  check is an explicit, documented proxy, not a replacement.
- Production deployment of any kind.
- Applying or modifying any Supabase migration.

## Result — Gate 10B (2026-07-29)

An equivalent first-publish validation completed successfully against the
deployed Linode stack, using an automated synthetic FFmpeg publisher in place
of a real encoder (steps 7/9 above were performed by that publisher rather
than manual OBS/Kiloview configuration). All other stages of the procedure —
activation, encoder-facing credential handling, publish, and HLS output —
were exercised end-to-end and passed.

This result does not supersede the procedure above, which remains the
governing steps for any future first-publish attempt using a real encoder.
No raw publish URL, token, or other credential is recorded here or in the
full evidence record. See
[`../../CURRENT_STATE.md`](../../CURRENT_STATE.md)'s "Gate 10B — first
end-to-end RTMP-to-HLS validation (2026-07-29)" section for identifiers,
root cause, evidence, and cleanup detail.
