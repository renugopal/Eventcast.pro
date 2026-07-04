# Real-provider validation (Cloudflare R2, YouTube)

## Status as of this milestone

This mission checked the approved secret mechanism (the persistent deployment's `/opt/eventcast/media-node/app/compose/.env` on `eventcast-server-new`) for real Cloudflare R2 or YouTube credentials before doing anything else provider-specific. It contains only `EVENTCAST_NODE_ID` and `EVENTCAST_LOG_LEVEL` — no R2 endpoint/keys, no Wasabi credentials, and no YouTube stream key. **No real R2 or YouTube credentials were available anywhere this mission was authorized to look**, so per this mission's explicit instruction, real-provider validation is documented here as a precise, minimal operator procedure rather than skipped silently or blocked on.

Everything this milestone's automated behavior needed from an S3-compatible object store was validated against the real MinIO container already used by `infra/media-node/compose/media-delivery-integration-test.sh` (a real HTTP S3-compatible service, not a mock) — see that script and `services/media-agent/README.md` "Implemented (v1.2 media delivery, DVR/VOD, and relay)". `internal/upload.R2Client` is a thin, provider-agnostic AWS SDK v2 wrapper; nothing in it is MinIO-specific, so this coverage is a faithful proxy for R2 behavior at the API level. What only a real R2 account can additionally confirm — custom-domain cache behavior, `r2.dev` avoidance, live-manifest cache-bypass headers — is exactly the scope of the procedure below.

## Cloudflare R2 validation procedure (run once real credentials are available)

Prerequisite: an R2 bucket, a least-privilege access key/secret for that bucket only, and a configured custom domain, all supplied through the approved secret mechanism (never pasted into a shell history or committed file).

```bash
# 1. Uniquely-prefixed isolated test, using the real Media Agent binary
#    against the real endpoint - not a new script, the same R2Client this
#    milestone ships.
RUN_ID="r2-validate-$(date -u +%Y%m%dT%H%M%SZ)"
export EVENTCAST_R2_ENDPOINT="https://<accountid>.r2.cloudflarestorage.com"
export EVENTCAST_R2_REGION=auto
export EVENTCAST_R2_BUCKET="<real-bucket>"
export EVENTCAST_R2_ACCESS_KEY_ID="<least-privilege-key>"
export EVENTCAST_R2_SECRET_ACCESS_KEY="<secret>"          # never echo this
export EVENTCAST_R2_OBJECT_PREFIX="validation/${RUN_ID}/"  # confines every object this run touches

# 2. Run the existing media-delivery integration test but point it at the
#    real endpoint instead of the script's own MinIO container by
#    overriding the compose overlay's R2_* variables to the values above
#    (do not modify the script; export the same variable names it already
#    passes through to the media-agent container's environment).

# 3. Manually confirm, using the AWS CLI or `aws s3api` pointed at the
#    same endpoint/credentials, that only objects under the
#    "validation/${RUN_ID}/" prefix exist from this test:
aws --endpoint-url "$EVENTCAST_R2_ENDPOINT" s3api list-objects-v2 \
  --bucket "$EVENTCAST_R2_BUCKET" --prefix "validation/${RUN_ID}/"

# 4. Confirm HEAD on a produced segment object returns the expected
#    content-type (video/MP2T) and custom metadata (sha256/event/session/
#    sequence/duration) - internal/upload.Worker already sets these; this
#    step is only confirming R2 itself preserves them, which is an R2-side
#    behavior no MinIO run can confirm.
aws --endpoint-url "$EVENTCAST_R2_ENDPOINT" s3api head-object \
  --bucket "$EVENTCAST_R2_BUCKET" --key "validation/${RUN_ID}/events/<playback_id>/media/<session_id>/<file>.ts"

# 5. Through the real Cloudflare custom domain (never r2.dev), confirm:
#    - the live manifest response has Cache-Control: no-store (or a
#      tested edge TTL <= 1s) and does not return a stale/negatively
#      cached 404 (02_V1_ARCHITECTURE_SPEC.md "Cloudflare delivery and
#      cache policy", ADR-021)
#    - an immutable segment response has a long max-age/immutable
#      Cache-Control
curl -sI "https://<custom-domain>/events/<playback_id>/live/index.m3u8"
curl -sI "https://<custom-domain>/events/<playback_id>/media/<session_id>/<file>.ts"

# 6. Delete ONLY this run's own objects - never anything outside the
#    "validation/${RUN_ID}/" prefix, and never any other prefix in the
#    bucket:
aws --endpoint-url "$EVENTCAST_R2_ENDPOINT" s3api list-objects-v2 \
  --bucket "$EVENTCAST_R2_BUCKET" --prefix "validation/${RUN_ID}/" \
  --query 'Contents[].Key' --output text | \
  xargs -n1 -I{} aws --endpoint-url "$EVENTCAST_R2_ENDPOINT" s3api delete-object \
  --bucket "$EVENTCAST_R2_BUCKET" --key "{}"
```

Do not run step 6 with a bare prefix-less bucket delete, a lifecycle rule change, or any command that could touch an object outside `validation/${RUN_ID}/`. Never print `EVENTCAST_R2_SECRET_ACCESS_KEY` to the terminal, a log file, or a CI artifact.

## YouTube relay validation procedure

This milestone's automated integration test (`media-delivery-integration-test.sh`, step 9 in its own header comment) already validates the full relay lifecycle — start, running, stop, and bounded-restart-then-failed on an unreachable destination — against a real local RTMP sink (a second pinned SRS instance acting as the receiving endpoint), proving `internal/relay.Supervisor`'s ffmpeg stream-copy, secret redaction, and ADR-012 isolation from primary HLS end to end. No disposable YouTube test stream key was available through the approved secret mechanism for this mission, so real-YouTube-endpoint validation is documented here rather than attempted with an invented key.

When an approved disposable YouTube test stream key is available:

```bash
# Use a real (but disposable/unlisted, never a production channel) YouTube
# stream key, supplied only through the approved secret mechanism.
YOUTUBE_TEST_KEY="<disposable-key>"                 # never echo or log this
YOUTUBE_TEST_DESTINATION="rtmp://a.rtmp.youtube.com/live2"

# Seed exactly one assignment (see any *-integration-test.sh script's
# assignments.json construction for the exact shape) with:
#   "youtube_enabled": true,
#   "youtube_destination_base_url": "<YOUTUBE_TEST_DESTINATION>",
#   "youtube_stream_key": "<YOUTUBE_TEST_KEY>"
# in an isolated temp directory, never the persistent config path.

# Publish a short synthetic stream (a few minutes) to the seeded ingest
# id, then in YouTube Studio's live dashboard for that disposable
# stream/channel, confirm the stream is received and use "Stop stream"
# there (or simply stop the test publish) - never leave a disposable test
# stream live longer than needed to confirm reception.

# Confirm the Media Agent's own logs show "relay running" and, after
# stopping, "relay stopped" for that session, and that
# YOUTUBE_TEST_KEY never appears in any log line (grep the full log
# output for the raw key string and expect zero matches).
```

Do not persist `YOUTUBE_TEST_KEY` anywhere beyond the single isolated seed file used for this manual validation session, and delete that seed file afterward.

## Conclusion

Real Cloudflare R2 and real YouTube endpoint validation are explicitly deferred per this mission's own instructions ("If real R2 credentials are unavailable, do not block the mission and do not invent credentials" / "Otherwise retain the validated local RTMP sink proof and document the exact controlled field-validation procedure"). Nothing about this deferral blocks release readiness: the MinIO-backed and local-RTMP-sink-backed automated proofs already exercise the identical provider-agnostic client code paths (`internal/upload.R2Client`, `internal/relay.Supervisor`) that would run against the real providers.
