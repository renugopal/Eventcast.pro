#!/bin/sh
# Test-only stand-in for ffmpeg, used by relay_test.go. Behavior is
# controlled entirely by $FAKE_FFMPEG_BEHAVIOR (never by arguments,
# mirroring how this package treats real ffmpeg's arguments as opaque).
# It writes a line to stderr containing a fake rtmp destination URL so
# tests can confirm Supervisor redacts it before logging.

echo "Output #0, flv, to 'rtmp://fake.example.invalid/live2/${FAKE_STREAM_KEY_MARKER:-nokey}': fake banner" 1>&2

case "$FAKE_FFMPEG_BEHAVIOR" in
  immediate_success)
    exit 0
    ;;
  immediate_fail)
    exit 1
    ;;
  hang_until_term)
    trap 'exit 0' TERM
    while true; do
      sleep 1
    done
    ;;
  *)
    exit 1
    ;;
esac
