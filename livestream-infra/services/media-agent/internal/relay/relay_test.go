package relay

import (
	"bytes"
	"context"
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
