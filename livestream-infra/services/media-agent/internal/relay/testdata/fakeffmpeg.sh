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
  fail_until_marker)
    # Simulates a local RTMP source that is not yet readable: fails
    # immediately ("Invalid data found when processing input") until the
    # test creates $FAKE_FFMPEG_READY_MARKER, then behaves like a
    # successfully relaying process until asked to stop.
    if [ -f "$FAKE_FFMPEG_READY_MARKER" ]; then
      trap 'exit 0' TERM
      while true; do
        sleep 1
      done
    fi
    echo "[in#0/flv @ 0x1] Error opening input: Invalid data found when processing input" 1>&2
    exit 1
    ;;
  destination_connection_refused)
    echo "RTMP_Connect0, failed to connect socket. 111 (Connection refused)" 1>&2
    echo "[out#0/flv @ 0x1] Error opening output rtmp://fake.example.invalid/live2/${FAKE_STREAM_KEY_MARKER:-nokey}" 1>&2
    exit 1
    ;;
  destination_output_error)
    echo "[out#0/flv @ 0x1] Error opening output file rtmp://fake.example.invalid/live2/${FAKE_STREAM_KEY_MARKER:-nokey}" 1>&2
    exit 1
    ;;
  unknown_failure)
    echo "fake ffmpeg failure" 1>&2
    exit 1
    ;;
  source_and_destination_failure)
    echo "[in#0/flv @ 0x1] Error opening input: Invalid data found when processing input" 1>&2
    echo "[out#0/flv @ 0x1] Error opening output rtmp://fake.example.invalid/live2/${FAKE_STREAM_KEY_MARKER:-nokey}" 1>&2
    exit 1
    ;;
  run_then_fail_once_then_hang)
    # Simulates a genuine mid-stream failure, distinct from a startup
    # race: runs long enough to count as "genuinely started" before
    # failing on its first invocation, then relays successfully on every
    # invocation after that, tracked via $FAKE_FFMPEG_COUNT_FILE since
    # each restart is a brand new process.
    count=0
    if [ -f "$FAKE_FFMPEG_COUNT_FILE" ]; then
      count=$(cat "$FAKE_FFMPEG_COUNT_FILE")
    fi
    count=$((count + 1))
    echo "$count" > "$FAKE_FFMPEG_COUNT_FILE"
    if [ "$count" -eq 1 ]; then
      sleep 0.3
      exit 1
    fi
    trap 'exit 0' TERM
    while true; do
      sleep 1
    done
    ;;
  *)
    exit 1
    ;;
esac
