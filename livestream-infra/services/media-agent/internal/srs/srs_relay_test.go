package srs

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/relay"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// fakeFFmpegPath resolves and chmods the shared test-only ffmpeg
// stand-in defined alongside internal/relay's own tests, so this
// package's tests exercise the real relay.Supervisor rather than a
// second, divergent mock implementation.
func fakeFFmpegPath(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs(filepath.Join("..", "relay", "testdata", "fakeffmpeg.sh"))
	if err != nil {
		t.Fatalf("resolve fake ffmpeg path: %v", err)
	}
	if err := os.Chmod(abs, 0o755); err != nil {
		t.Fatalf("chmod fake ffmpeg script: %v", err)
	}
	return abs
}

func newTestEnvWithRelay(t *testing.T) *testEnv {
	t.Helper()
	env := newTestEnv(t)

	sup := relay.New(env.store, relay.Config{
		FFmpegPath: fakeFFmpegPath(t), RestartMaxAttempts: 3,
		RestartBackoffBase: 5 * time.Millisecond, RestartBackoffMax: 20 * time.Millisecond, ShutdownTimeout: 2 * time.Second,
	}, env.handlers.Logger)
	t.Cleanup(sup.Shutdown)

	env.handlers.Relay = sup
	env.handlers.YouTubeSourceRTMPBaseURL = "rtmp://127.0.0.1:1935"
	env.handlers.YouTubeStreamKeys = map[string]logging.Secret{}
	return env
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

func TestOnPublishStartsRelayWhenAssignmentEnablesYouTube(t *testing.T) {
	env := newTestEnvWithRelay(t)
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "hang_until_term")

	token := env.seedAssignment(t, "teststream", func(a *store.Assignment) {
		a.YouTubeEnabled = true
		a.YouTubeDestinationBaseURL = "rtmp://fake.example.invalid/live2"
		a.YouTubeStreamKey = "test-key"
	})
	env.handlers.YouTubeStreamKeys["event-teststream"] = logging.Secret("test-key")

	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if resp["code"] != float64(0) {
		t.Fatalf("on_publish response = %v, want code 0", resp)
	}

	sess, found, err := env.store.FindMostRecentByIngestID(context.Background(), "teststream")
	if err != nil || !found {
		t.Fatalf("FindMostRecentByIngestID() found=%v err=%v", found, err)
	}
	waitForRelayStatus(t, env.store, sess.ID, store.RelayRunning, 2*time.Second)
}

func TestOnPublishDoesNotStartRelayWhenAssignmentDisablesYouTube(t *testing.T) {
	env := newTestEnvWithRelay(t)
	token := env.seedAssignment(t, "teststream", nil) // YouTubeEnabled defaults to false

	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if resp["code"] != float64(0) {
		t.Fatalf("on_publish response = %v, want code 0", resp)
	}

	sess, found, err := env.store.FindMostRecentByIngestID(context.Background(), "teststream")
	if err != nil || !found {
		t.Fatalf("FindMostRecentByIngestID() found=%v err=%v", found, err)
	}
	if _, found, err := env.store.GetRelayBySessionID(context.Background(), sess.ID); err != nil || found {
		t.Errorf("expected no relay record when the assignment does not enable YouTube: found=%v err=%v", found, err)
	}
}

func TestOnUnpublishStopsRelay(t *testing.T) {
	env := newTestEnvWithRelay(t)
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "hang_until_term")

	token := env.seedAssignment(t, "teststream", func(a *store.Assignment) {
		a.YouTubeEnabled = true
		a.YouTubeDestinationBaseURL = "rtmp://fake.example.invalid/live2"
		a.YouTubeStreamKey = "test-key"
	})
	env.handlers.YouTubeStreamKeys["event-teststream"] = logging.Secret("test-key")

	doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	sess, found, err := env.store.FindMostRecentByIngestID(context.Background(), "teststream")
	if err != nil || !found {
		t.Fatalf("FindMostRecentByIngestID() found=%v err=%v", found, err)
	}
	waitForRelayStatus(t, env.store, sess.ID, store.RelayRunning, 2*time.Second)

	doRequest(t, env.handlers.OnUnpublish(), unpublishBody("teststream"))
	waitForRelayStatus(t, env.store, sess.ID, store.RelayStopped, 2*time.Second)
}

// TestRelayFailureDoesNotAffectOnHLS proves ADR-012 isolation at the
// handler-wiring level: even with YouTube relay enabled and actively
// failing (bounded restarts exhausted), on_hls segment capture -
// EventCast's primary pipeline - is entirely unaffected.
func TestRelayFailureDoesNotAffectOnHLS(t *testing.T) {
	env := newTestEnvWithRelay(t)
	t.Setenv("FAKE_FFMPEG_BEHAVIOR", "immediate_fail")

	token := env.seedAssignment(t, "teststream", func(a *store.Assignment) {
		a.YouTubeEnabled = true
		a.YouTubeDestinationBaseURL = "rtmp://fake.example.invalid/live2"
		a.YouTubeStreamKey = "test-key"
	})
	env.handlers.YouTubeStreamKeys["event-teststream"] = logging.Secret("test-key")

	doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	sess, found, err := env.store.FindMostRecentByIngestID(context.Background(), "teststream")
	if err != nil || !found {
		t.Fatalf("FindMostRecentByIngestID() found=%v err=%v", found, err)
	}
	waitForRelayStatus(t, env.store, sess.ID, store.RelayFailed, 3*time.Second)

	srcFile := filepath.Join(env.hlsRoot, "live", "teststream", "1700000000-1.ts")
	writeSourceFile(t, srcFile, "segment data")

	_, resp := doRequest(t, env.handlers.OnHLS(), hlsBody("teststream", srcFile, 1))
	if resp["code"] != float64(0) {
		t.Fatalf("on_hls response = %v, want code 0 (relay failure must not affect segment capture)", resp)
	}
}
