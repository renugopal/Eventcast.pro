package relay

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// fakeFFmpegPath returns the absolute, executable path to the
// test-only fake ffmpeg script, chmod'ing it itself rather than relying
// on git to have preserved the executable bit through checkout.
func fakeFFmpegPath(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs(filepath.Join("testdata", "fakeffmpeg.sh"))
	if err != nil {
		t.Fatalf("resolve fake ffmpeg path: %v", err)
	}
	if err := os.Chmod(abs, 0o755); err != nil {
		t.Fatalf("chmod fake ffmpeg script: %v", err)
	}
	return abs
}

func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "media-agent.sqlite3"), 5*time.Second)
	if err != nil {
		t.Fatalf("store.Open() error: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func waitForRelayStatus(t *testing.T, st *store.Store, sessionID, want string, timeout time.Duration) store.RelayRecord {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var last store.RelayRecord
	for time.Now().Before(deadline) {
		rec, found, err := st.GetRelayBySessionID(context.Background(), sessionID)
		if err != nil {
			t.Fatalf("GetRelayBySessionID() error: %v", err)
		}
		if found {
			last = rec
			if rec.Status == want {
				return rec
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for session %s relay status %q, last observed: %+v", sessionID, want, last)
	return store.RelayRecord{}
}

func TestSupervisorStartsAndCleanlyStops(t *testing.T) {
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 3,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
	}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))

	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "hang_until_term")

	target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	waitForRelayStatus(t, st, "sess1", store.RelayRunning, 2*time.Second)

	sup.Stop("sess1")
	rec := waitForRelayStatus(t, st, "sess1", store.RelayStopped, 2*time.Second)
	if rec.RestartCount != 0 {
		t.Errorf("RestartCount = %d, want 0 for a clean stop", rec.RestartCount)
	}
}

func TestSupervisorIsIdempotentOnDuplicateStart(t *testing.T) {
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 3,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
	}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "hang_until_term")

	target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("first Start() error: %v", err)
	}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("second Start() error: %v", err)
	}

	waitForRelayStatus(t, st, "sess1", store.RelayRunning, 2*time.Second)
	sup.Shutdown()
}

func TestSupervisorRestartsThenFailsAfterBudgetExhausted(t *testing.T) {
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 2,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
	}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "immediate_fail")

	target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	rec := waitForRelayStatus(t, st, "sess1", store.RelayFailed, 3*time.Second)
	if rec.RestartCount < 1 {
		t.Errorf("RestartCount = %d, want >= 1", rec.RestartCount)
	}
	if rec.LastError == "" {
		t.Error("expected a non-empty last_error after the restart budget is exhausted")
	}
}

// TestSupervisorRetriesDuringStartupRaceWithoutConsumingRestartBudget
// reproduces the field-test defect: ffmpeg fails immediately several
// times because the local SRS source is not yet readable right after
// on_publish, then becomes readable a little later. None of those early
// failures should have spent the restart budget.
func TestSupervisorRetriesDuringStartupRaceWithoutConsumingRestartBudget(t *testing.T) {
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 3,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
		SourceReadyTimeout: 2 * time.Second, SourceReadyMinRunDuration: 200 * time.Millisecond, SourceReadyRetryInterval: 15 * time.Millisecond,
	}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))

	marker := filepath.Join(t.TempDir(), "ready")
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "fail_until_marker")
	t.Setenv("FAKE_FFMPEG_READY_MARKER", marker)

	target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Let several fast, uncounted failures happen before the source
	// becomes readable.
	time.Sleep(150 * time.Millisecond)
	if err := os.WriteFile(marker, []byte("ready"), 0o644); err != nil {
		t.Fatalf("write ready marker: %v", err)
	}

	rec := waitForRelayStatus(t, st, "sess1", store.RelayRunning, 2*time.Second)
	if rec.RestartCount != 0 {
		t.Errorf("RestartCount = %d, want 0: fast failures before the source became ready must not spend the restart budget", rec.RestartCount)
	}

	sup.Shutdown()
}

func TestIsStartupSourceNotReady(t *testing.T) {
	tests := []struct {
		name       string
		diagnostic string
		want       bool
	}{
		{
			name:       "input processing failure is eligible",
			diagnostic: "ffmpeg exited: Invalid data found when processing input",
			want:       true,
		},
		{
			name:       "input opening failure is eligible",
			diagnostic: "ffmpeg exited: Error opening input: Invalid data found when processing input",
			want:       true,
		},
		{
			name:       "destination connection refused is not eligible",
			diagnostic: "ffmpeg exited: RTMP_Connect0, failed to connect socket. 111 (Connection refused) [out#0/flv] Error opening output",
			want:       false,
		},
		{
			name:       "output opening failure is not eligible",
			diagnostic: "ffmpeg exited: [out#0/flv] Error opening output file",
			want:       false,
		},
		{
			name:       "unknown failure is not eligible",
			diagnostic: "ffmpeg exited: exit status 1",
			want:       false,
		},
		{
			name:       "output failure takes precedence over source-like text",
			diagnostic: "Invalid data found when processing input [out#0/flv] Error opening output",
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isStartupSourceNotReady(errors.New(tt.diagnostic)); got != tt.want {
				t.Errorf("isStartupSourceNotReady() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSupervisorDestinationFailuresConsumeRestartBudget(t *testing.T) {
	tests := []struct {
		name     string
		behavior string
	}{
		{name: "connection refused", behavior: "destination_connection_refused"},
		{name: "error opening output", behavior: "destination_output_error"},
		{name: "unknown diagnostic", behavior: "unknown_failure"},
		{name: "output takes precedence over source-like text", behavior: "source_and_destination_failure"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			st := openTestStore(t)
			sup := New(st, Config{
				FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 2,
				RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
				SourceReadyTimeout: 2 * time.Second, SourceReadyMinRunDuration: time.Second, SourceReadyRetryInterval: 10 * time.Millisecond,
			}, slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))

			t.Setenv("FAKE_FFMPEG_BEHAVIOR", tt.behavior)
			target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
				DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
			if err := sup.Start(context.Background(), target); err != nil {
				t.Fatalf("Start() error: %v", err)
			}

			rec := waitForRelayStatus(t, st, "sess1", store.RelayFailed, time.Second)
			if rec.RestartCount != 1 {
				t.Errorf("RestartCount = %d, want 1", rec.RestartCount)
			}
			if !strings.Contains(logs.String(), "restart budget exhausted") {
				t.Errorf("logs did not contain terminal restart-budget message: %s", logs.String())
			}
		})
	}
}

// TestSupervisorFallsBackToCountedRestartsAfterGracePeriodExpires proves
// the startup-race allowance is bounded: a source that never becomes
// readable must still eventually exhaust the restart budget and report
// permanent failure, not retry forever for free.
func TestSupervisorFallsBackToCountedRestartsAfterGracePeriodExpires(t *testing.T) {
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 2,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
		SourceReadyTimeout: 40 * time.Millisecond, SourceReadyMinRunDuration: 200 * time.Millisecond, SourceReadyRetryInterval: 10 * time.Millisecond,
	}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))

	marker := filepath.Join(t.TempDir(), "never-created")
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "fail_until_marker")
	t.Setenv("FAKE_FFMPEG_READY_MARKER", marker)

	target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	rec := waitForRelayStatus(t, st, "sess1", store.RelayFailed, 3*time.Second)
	if rec.RestartCount < 1 {
		t.Errorf("RestartCount = %d, want >= 1: once the grace period expires, a still-unready source must count against the restart budget and eventually report permanent failure", rec.RestartCount)
	}
}

// TestSupervisorRecoversAfterTransientMidStreamFailure exercises the
// pre-existing counted-restart recovery path (distinct from the startup
// race): a failure that happens well after ffmpeg was genuinely running
// must count against the restart budget and still let the relay recover
// to running on the next attempt.
func TestSupervisorRecoversAfterTransientMidStreamFailure(t *testing.T) {
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 5,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
		SourceReadyTimeout: 2 * time.Second, SourceReadyMinRunDuration: 100 * time.Millisecond, SourceReadyRetryInterval: 10 * time.Millisecond,
	}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))

	countFile := filepath.Join(t.TempDir(), "count")
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "run_then_fail_once_then_hang")
	t.Setenv("FAKE_FFMPEG_COUNT_FILE", countFile)

	target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// The first invocation runs past SourceReadyMinRunDuration before
	// failing, so it must count as a real restart; wait specifically for
	// the *post-recovery* running state (RestartCount >= 1), not just any
	// "running" observation (the first invocation is also briefly
	// "running" before it fails).
	deadline := time.Now().Add(3 * time.Second)
	var rec store.RelayRecord
	for time.Now().Before(deadline) {
		r, found, err := st.GetRelayBySessionID(context.Background(), "sess1")
		if err != nil {
			t.Fatalf("GetRelayBySessionID() error: %v", err)
		}
		if found && r.Status == store.RelayRunning && r.RestartCount >= 1 {
			rec = r
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if rec.RestartCount < 1 {
		t.Fatal("timed out waiting for the relay to recover to running after a counted restart")
	}

	sup.Shutdown()
}

// TestSupervisorCleanStopDuringStartupRace proves Stop remains prompt
// even while the supervisor is still inside the uncounted startup-race
// retry loop, instead of waiting out the whole grace window.
func TestSupervisorCleanStopDuringStartupRace(t *testing.T) {
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 3,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
		SourceReadyTimeout: 10 * time.Second, SourceReadyMinRunDuration: 200 * time.Millisecond, SourceReadyRetryInterval: 20 * time.Millisecond,
	}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))

	marker := filepath.Join(t.TempDir(), "never-created")
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "fail_until_marker")
	t.Setenv("FAKE_FFMPEG_READY_MARKER", marker)

	target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	time.Sleep(80 * time.Millisecond) // let a few uncounted retries happen
	sup.Stop("sess1")

	rec := waitForRelayStatus(t, st, "sess1", store.RelayStopped, 2*time.Second)
	if rec.RestartCount != 0 {
		t.Errorf("RestartCount = %d, want 0 for a clean stop during the startup race", rec.RestartCount)
	}
}

// TestSupervisorGivesEachReconnectedSessionAFreshGraceWindow reproduces
// "the second relay" scenario from the field test: a publisher
// reconnects (a brand new ingest session, and therefore a brand new
// relay Start call) after its first session's relay already exhausted
// its restart budget and failed. The new session's relay must get its
// own independent grace window and restart budget, not inherit the
// first session's exhausted state.
func TestSupervisorGivesEachReconnectedSessionAFreshGraceWindow(t *testing.T) {
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 2,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
		SourceReadyTimeout: 30 * time.Millisecond, SourceReadyMinRunDuration: 200 * time.Millisecond, SourceReadyRetryInterval: 5 * time.Millisecond,
	}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))

	neverMarker := filepath.Join(t.TempDir(), "never")
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "fail_until_marker")
	t.Setenv("FAKE_FFMPEG_READY_MARKER", neverMarker)

	firstTarget := Target{EventID: "evt1", SessionID: "sess-first", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), firstTarget); err != nil {
		t.Fatalf("first Start() error: %v", err)
	}
	waitForRelayStatus(t, st, "sess-first", store.RelayFailed, 2*time.Second)

	// The publisher reconnects: a new ingest session begins, and this
	// time the local source becomes readable well within a fresh grace
	// window.
	readyMarker := filepath.Join(t.TempDir(), "ready")
	if err := os.WriteFile(readyMarker, []byte("ready"), 0o644); err != nil {
		t.Fatalf("write ready marker: %v", err)
	}
	t.Setenv("FAKE_FFMPEG_READY_MARKER", readyMarker)

	secondTarget := Target{EventID: "evt1", SessionID: "sess-second", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret("test-key")}
	if err := sup.Start(context.Background(), secondTarget); err != nil {
		t.Fatalf("second Start() error: %v", err)
	}
	rec := waitForRelayStatus(t, st, "sess-second", store.RelayRunning, 2*time.Second)
	if rec.RestartCount != 0 {
		t.Errorf("RestartCount = %d, want 0: a reconnected session's relay must start with its own fresh restart budget", rec.RestartCount)
	}

	sup.Shutdown()
}

func TestSupervisorNeverLogsTheRawStreamKey(t *testing.T) {
	var buf bytes.Buffer
	st := openTestStore(t)
	sup := New(st, Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 1,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
	}, slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	const secretMarker = "SECRET_MARKER_MUST_NEVER_APPEAR_XYZ123"
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "immediate_fail")
	t.Setenv("FAKE_STREAM_KEY_MARKER", secretMarker)

	target := Target{EventID: "evt1", SessionID: "sess1", SourceURL: "rtmp://127.0.0.1:1935/live/ingest1",
		DestinationBaseURL: "rtmp://fake.example.invalid/live2", StreamKey: logging.Secret(secretMarker)}
	if err := sup.Start(context.Background(), target); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	waitForRelayStatus(t, st, "sess1", store.RelayFailed, 3*time.Second)
	sup.Shutdown()

	rec, found, err := st.GetRelayBySessionID(context.Background(), "sess1")
	if err != nil || !found {
		t.Fatalf("GetRelayBySessionID() found=%v err=%v", found, err)
	}
	if strings.Contains(rec.LastError, secretMarker) {
		t.Errorf("last_error leaked the secret marker: %q", rec.LastError)
	}
	if strings.Contains(buf.String(), secretMarker) {
		t.Errorf("logs leaked the secret marker:\n%s", buf.String())
	}
}

func TestSanitizeRedactsRTMPURLs(t *testing.T) {
	in := "ffmpeg exited: exit status 1 (stderr: Output #0, flv, to 'rtmp://a.rtmp.youtube.com/live2/abc123secret': error)"
	got := sanitize(in)
	if strings.Contains(got, "abc123secret") {
		t.Errorf("sanitize() did not redact the secret: %q", got)
	}
	if !strings.Contains(got, "[REDACTED_RTMP_URL]") {
		t.Errorf("sanitize() did not include the redaction placeholder: %q", got)
	}
}

func TestBoundedBufferRetainsOnlyTheTail(t *testing.T) {
	b := newBoundedBuffer(10)
	if _, err := b.Write([]byte("0123456789ABCDEF")); err != nil {
		t.Fatalf("Write() error: %v", err)
	}
	if got := b.String(); got != "6789ABCDEF" {
		t.Errorf("String() = %q, want the last 10 bytes %q", got, "6789ABCDEF")
	}
}
