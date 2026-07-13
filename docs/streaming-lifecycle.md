# Streaming Lifecycle

The lifecycle of a live event from ingest to VOD, on the target stack. The
**locked decision** is that the legacy **Restreamer** stack is replaced by
**SRS + Media Agent**. This document describes the target lifecycle; it changes
no streaming code.

## Components (target)

- **SRS** — the media server handling RTMP/stream ingest and delivery.
- **Media Agent** — the controller/worker that manages a stream's lifecycle
  (start/stop, recording, and handoff to finalized storage).
- **Restreamer** — **legacy**, being retired. New work targets SRS + Media Agent.

## Lifecycle stages (target)

1. **Provision** — an event is prepared for live; ingest endpoint/keys are
   allocated for SRS. (The event contract already carries YouTube relay fields
   such as `youtube_broadcast_id` / `youtube_stream_key` where applicable — see
   [event-contract.md](event-contract.md).)
2. **Live ingest** — the source publishes to SRS; the Media Agent observes the
   session.
3. **Deliver** — viewers receive the live stream.
4. **Record** — the session is captured; working artifacts live in **R2** (hot
   path) per [media-processing.md](media-processing.md).
5. **Finalize** — on end, the recording is finalized and written to **B2** as the
   authoritative VOD copy for V1.
6. **VOD** — the event's `vod_link` surfaces the finalized recording for replay.

## State transitions

The authoritative set of stream states and their transitions is `TBD` and should
be documented from the Media Agent implementation as it lands — not invented
here. At minimum the lifecycle distinguishes: pre-live, live, ending, and
finalized/VOD.

## Migration from Restreamer

- New events run on SRS + Media Agent.
- Restreamer components are retired once the new stack covers the full lifecycle
  above (Phase 5 in [implementation-plan.md](implementation-plan.md)).
- Any Restreamer-specific config, scripts, or references become legacy on
  cutover and are removed in a separate, reviewed change.

## Open items

- Concrete SRS ingest/delivery topology — **TBD** (document from infra).
- Media Agent state machine — **TBD** (document from implementation).
- Concurrency / capacity targets — **TBD** (not invented here).
- Reconnect / failover behaviour — **TBD**.
