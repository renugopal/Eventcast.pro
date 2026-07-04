package controlplane

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func testLogger(t *testing.T) *slog.Logger {
	t.Helper()
	return slog.New(slog.NewTextHandler(io.Discard, nil))
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

// fakeClient is a scriptable Client for syncer tests that do not need a
// real HTTP round trip.
type fakeClient struct {
	responses []AssignmentsResponse
	errs      []error
	calls     int
}

func (f *fakeClient) FetchAssignments(ctx context.Context, nodeID string) (AssignmentsResponse, error) {
	i := f.calls
	f.calls++
	if i < len(f.errs) && f.errs[i] != nil {
		return AssignmentsResponse{}, f.errs[i]
	}
	if i < len(f.responses) {
		return f.responses[i], nil
	}
	return AssignmentsResponse{}, errors.New("fakeClient: no scripted response for this call")
}

func defaultSyncerConfig() SyncerConfig {
	return SyncerConfig{
		NodeID:             "node-a",
		RequestTimeout:     time.Second,
		SyncInterval:       time.Hour, // tests drive SyncOnce directly, not the Run loop timing
		BackoffBase:        time.Millisecond,
		BackoffMax:         10 * time.Millisecond,
		StaleWarnAfter:     time.Minute,
		StaleCriticalAfter: 5 * time.Minute,
	}
}

func TestSyncerSyncOnceAppliesAssignmentsAndRecordsSuccess(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	client := &fakeClient{responses: []AssignmentsResponse{{
		ConfigVersion: "v1",
		Assignments:   []store.Assignment{testAssignment("stream-1")},
	}}}

	s := NewSyncer(st, client, nil, defaultSyncerConfig(), testLogger(t))
	if err := s.SyncOnce(ctx); err != nil {
		t.Fatalf("SyncOnce() error: %v", err)
	}

	got, found, err := st.GetAssignment(ctx, "stream-1")
	if err != nil || !found {
		t.Fatalf("GetAssignment() found=%v err=%v", found, err)
	}
	if got.Enabled != true {
		t.Errorf("Enabled = %v, want true", got.Enabled)
	}

	status, err := s.Status(ctx)
	if err != nil {
		t.Fatalf("Status() error: %v", err)
	}
	if status.LastSuccessAt.IsZero() || status.ConfigVersion != "v1" || status.Stale || status.CriticallyStale {
		t.Errorf("status = %+v, want a fresh successful sync", status)
	}
}

func TestSyncerSyncOncePreservesCacheOnFailure(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	client := &fakeClient{errs: []error{errors.New("connection refused")}}

	// Seed one assignment first so we can prove it survives a failed sync.
	if _, err := st.ImportAssignments(ctx, []store.Assignment{testAssignment("stream-1")}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}

	s := NewSyncer(st, client, nil, defaultSyncerConfig(), testLogger(t))
	if err := s.SyncOnce(ctx); err == nil {
		t.Fatal("SyncOnce() expected an error from the failing client, got nil")
	}

	got, found, err := st.GetAssignment(ctx, "stream-1")
	if err != nil || !found {
		t.Fatalf("GetAssignment() found=%v err=%v", found, err)
	}
	if !got.Enabled {
		t.Error("expected the pre-existing cached assignment to survive a failed sync unchanged")
	}

	status, err := s.Status(ctx)
	if err != nil {
		t.Fatalf("Status() error: %v", err)
	}
	if status.ConsecutiveFailures != 1 || status.LastError == "" {
		t.Errorf("status = %+v, want 1 recorded failure with a non-empty error", status)
	}
}

func TestSyncerSyncOnceRevokesDroppedAssignments(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	client := &fakeClient{responses: []AssignmentsResponse{
		{ConfigVersion: "v1", Assignments: []store.Assignment{testAssignment("stream-1"), testAssignment("stream-2")}},
		{ConfigVersion: "v2", Assignments: []store.Assignment{testAssignment("stream-1")}},
	}}

	s := NewSyncer(st, client, nil, defaultSyncerConfig(), testLogger(t))
	if err := s.SyncOnce(ctx); err != nil {
		t.Fatalf("first SyncOnce() error: %v", err)
	}
	if err := s.SyncOnce(ctx); err != nil {
		t.Fatalf("second SyncOnce() error: %v", err)
	}

	got, found, err := st.GetAssignment(ctx, "stream-2")
	if err != nil || !found {
		t.Fatalf("GetAssignment(stream-2) found=%v err=%v", found, err)
	}
	if got.Enabled {
		t.Error("expected stream-2 to be revoked after the second sync omitted it")
	}
}

func TestSyncerUpdatesStreamKeyCache(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	a := testAssignment("stream-1")
	a.YouTubeEnabled = true
	a.YouTubeDestinationBaseURL = "rtmp://a.rtmp.youtube.com/live2"
	a.YouTubeStreamKey = logging.Secret("raw-yt-key")

	client := &fakeClient{responses: []AssignmentsResponse{{ConfigVersion: "v1", Assignments: []store.Assignment{a}}}}
	cache := NewStreamKeyCache()
	s := NewSyncer(st, client, cache, defaultSyncerConfig(), testLogger(t))
	if err := s.SyncOnce(ctx); err != nil {
		t.Fatalf("SyncOnce() error: %v", err)
	}

	key, ok := cache.Get(a.EventID)
	if !ok || key.Reveal() != "raw-yt-key" {
		t.Errorf("cache.Get(%q) = (%v, %v), want (raw-yt-key, true)", a.EventID, key, ok)
	}
}

func TestSyncerStatusReportsStaleAndCriticallyStale(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	cfg := defaultSyncerConfig()
	cfg.StaleWarnAfter = 10 * time.Millisecond
	cfg.StaleCriticalAfter = 20 * time.Millisecond

	if err := st.RecordControlPlaneSyncSuccess(ctx, "v1", time.Now().UTC().Add(-time.Hour)); err != nil {
		t.Fatalf("RecordControlPlaneSyncSuccess() error: %v", err)
	}

	s := NewSyncer(st, &fakeClient{}, nil, cfg, testLogger(t))
	status, err := s.Status(ctx)
	if err != nil {
		t.Fatalf("Status() error: %v", err)
	}
	if !status.Stale || !status.CriticallyStale {
		t.Errorf("status = %+v, want both Stale and CriticallyStale true for an hour-old success", status)
	}
}

func TestSyncerStatusNeverSyncedIsNotStaleBeforeFirstAttempt(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	s := NewSyncer(st, &fakeClient{}, nil, defaultSyncerConfig(), testLogger(t))

	status, err := s.Status(ctx)
	if err != nil {
		t.Fatalf("Status() error: %v", err)
	}
	if status.Stale || status.CriticallyStale {
		t.Errorf("status = %+v, want a node that has never attempted a sync to not be flagged stale", status)
	}
}
