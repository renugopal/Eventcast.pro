package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/controlplane"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/metrics"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func envMap(m map[string]string) func(string) string {
	return func(key string) string {
		return m[key]
	}
}

// requiredPathEnv returns the durability-related environment variables
// every successful run()/runHealthCheck() call needs now that the
// database, spool root, and SRS HLS root are required configuration.
func requiredPathEnv(t *testing.T) map[string]string {
	t.Helper()
	base := t.TempDir()
	return map[string]string{
		config.EnvDBPath:     filepath.Join(base, "db", "media-agent.sqlite3"),
		config.EnvSpoolRoot:  filepath.Join(base, "spool"),
		config.EnvSRSHLSRoot: filepath.Join(base, "srs-output"),
	}
}

func withRequiredPaths(t *testing.T, extra map[string]string) map[string]string {
	t.Helper()
	m := requiredPathEnv(t)
	for k, v := range extra {
		m[k] = v
	}
	return m
}

// freeLoopbackAddr reserves an ephemeral loopback port and releases it
// so the code under test can bind it. The tiny window between release
// and rebind is acceptable because tests in this package do not run in
// parallel.
func freeLoopbackAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to reserve loopback port: %v", err)
	}
	addr := l.Addr().String()
	if err := l.Close(); err != nil {
		t.Fatalf("failed to release reserved port: %v", err)
	}
	return addr
}

// waitForHealthz polls GET /healthz until it returns 200, failing the
// test if run() exits early, a non-200 status arrives, or the deadline
// passes.
func waitForHealthz(t *testing.T, addr string, done <-chan error) {
	t.Helper()
	client := &http.Client{Timeout: time.Second}
	url := fmt.Sprintf("http://%s/healthz", addr)
	deadline := time.Now().Add(10 * time.Second)
	for {
		select {
		case err := <-done:
			t.Fatalf("run() returned before shutdown was requested: %v", err)
		default:
		}

		resp, err := client.Get(url)
		if err == nil {
			status := resp.StatusCode
			resp.Body.Close()
			if status == http.StatusOK {
				return
			}
			t.Fatalf("GET /healthz status = %d, want %d", status, http.StatusOK)
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not start serving /healthz: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestRunServesHealthReadyAndShutsDownCleanly(t *testing.T) {
	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(withRequiredPaths(t, map[string]string{
			config.EnvNodeID:   "test-node",
			config.EnvHTTPAddr: addr,
		})), io.Discard)
	}()

	waitForHealthz(t, addr, done)

	resp, err := http.Get(fmt.Sprintf("http://%s/readyz", addr))
	if err != nil {
		t.Fatalf("GET /readyz failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("GET /readyz status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("invalid /readyz JSON: %v", err)
	}
	if body["status"] != "ready" {
		t.Errorf("/readyz status = %v, want %q", body["status"], "ready")
	}

	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run() = %v, want nil after graceful shutdown", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run() did not return after context cancellation")
	}
}

func TestRunFailsFastOnInvalidConfig(t *testing.T) {
	ctx := context.Background()

	err := run(ctx, envMap(map[string]string{}), io.Discard)
	if err == nil {
		t.Fatal("run() expected error for missing required configuration, got nil")
	}
}

func TestRunFailsWhenAddressAlreadyBound(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to occupy a loopback port: %v", err)
	}
	defer l.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	runErr := run(ctx, envMap(withRequiredPaths(t, map[string]string{
		config.EnvNodeID:   "test-node",
		config.EnvHTTPAddr: l.Addr().String(),
	})), io.Discard)
	if runErr == nil {
		t.Fatal("run() expected error when the address is already bound, got nil")
	}
	if ctx.Err() != nil {
		t.Fatal("run() only returned because the test context expired, not because the bind failed")
	}
}

func TestRunImportsAssignmentSeedFile(t *testing.T) {
	base := t.TempDir()
	seedPath := filepath.Join(base, "assignments.json")
	seedBody := `[{
		"ingest_id": "seeded-stream",
		"event_id": "event-seeded",
		"playback_id": "pb-seeded",
		"stream_secret_hash": "` + strings.Repeat("ab", 32) + `",
		"enabled": true,
		"publish_window_start_at": "2020-01-01T00:00:00Z",
		"publish_window_end_at": "2030-01-01T00:00:00Z",
		"config_version": "1"
	}]`
	if err := os.WriteFile(seedPath, []byte(seedBody), 0o600); err != nil {
		t.Fatalf("write seed file: %v", err)
	}

	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(withRequiredPaths(t, map[string]string{
			config.EnvNodeID:             "test-node",
			config.EnvHTTPAddr:           addr,
			config.EnvAssignmentSeedPath: seedPath,
		})), io.Discard)
	}()

	waitForHealthz(t, addr, done)
	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run() = %v, want nil", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run() did not return after context cancellation")
	}
}

func TestRunFailsFastOnInvalidAssignmentSeedFile(t *testing.T) {
	base := t.TempDir()
	seedPath := filepath.Join(base, "assignments.json")
	if err := os.WriteFile(seedPath, []byte(`{not valid json`), 0o600); err != nil {
		t.Fatalf("write seed file: %v", err)
	}

	ctx := context.Background()
	err := run(ctx, envMap(withRequiredPaths(t, map[string]string{
		config.EnvNodeID:             "test-node",
		config.EnvAssignmentSeedPath: seedPath,
	})), io.Discard)
	if err == nil {
		t.Fatal("run() expected error for an invalid assignment seed file, got nil")
	}
}

// writeSeedAssignmentFile writes a single-assignment seed JSON file whose
// enabled flag and stream_secret_hash are controlled by the caller, so
// tests can drive an actual on_publish attempt against it.
func writeSeedAssignmentFile(t *testing.T, enabled bool, rawToken string) string {
	t.Helper()
	base := t.TempDir()
	seedPath := filepath.Join(base, "assignments.json")
	body := fmt.Sprintf(`[{
		"ingest_id": "seed-hardening-stream",
		"event_id": "seed-hardening-event",
		"playback_id": "seed-hardening-pb",
		"stream_secret_hash": "%s",
		"enabled": %t,
		"publish_window_start_at": "2020-01-01T00:00:00Z",
		"publish_window_end_at": "2030-01-01T00:00:00Z",
		"config_version": "1"
	}]`, store.HashToken(rawToken), enabled)
	if err := os.WriteFile(seedPath, []byte(body), 0o600); err != nil {
		t.Fatalf("write seed file: %v", err)
	}
	return seedPath
}

func postOnPublish(t *testing.T, addr, rawToken string) map[string]any {
	t.Helper()
	body := fmt.Sprintf(`{"action":"on_publish","stream":"seed-hardening-stream","app":"live","param":"?token=%s"}`, rawToken)
	resp, err := http.Post(fmt.Sprintf("http://%s/internal/srs/on-publish", addr), "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST on-publish failed: %v", err)
	}
	defer resp.Body.Close()
	var parsed map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	return parsed
}

// TestRunSeedAssignmentEnabledIsRejectedByDefault is the core seed-hardening
// regression test: a seed file's enabled: true row must not authorize a
// real publish unless EVENTCAST_ALLOW_SEED_ENABLED_ASSIGNMENTS is set.
func TestRunSeedAssignmentEnabledIsRejectedByDefault(t *testing.T) {
	seedPath := writeSeedAssignmentFile(t, true, "seed-hardening-token")

	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(withRequiredPaths(t, map[string]string{
			config.EnvNodeID:             "test-node",
			config.EnvHTTPAddr:           addr,
			config.EnvAssignmentSeedPath: seedPath,
			// EVENTCAST_ALLOW_SEED_ENABLED_ASSIGNMENTS deliberately unset.
		})), io.Discard)
	}()
	waitForHealthz(t, addr, done)

	parsed := postOnPublish(t, addr, "seed-hardening-token")
	if parsed["code"] == float64(0) {
		t.Error("on_publish succeeded against a seed-sourced enabled=true row with no EVENTCAST_ALLOW_SEED_ENABLED_ASSIGNMENTS opt-in; want rejected")
	}

	cancel()
	<-done
}

// TestRunSeedAssignmentEnabledIsHonoredWithOptIn confirms the dev/test
// opt-in still works: existing seed-based integration tests/fixtures that
// intentionally seed an enabled=true row must not be silently broken.
func TestRunSeedAssignmentEnabledIsHonoredWithOptIn(t *testing.T) {
	seedPath := writeSeedAssignmentFile(t, true, "seed-hardening-token")

	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(withRequiredPaths(t, map[string]string{
			config.EnvNodeID:                      "test-node",
			config.EnvHTTPAddr:                    addr,
			config.EnvAssignmentSeedPath:          seedPath,
			config.EnvAllowSeedEnabledAssignments: "true",
		})), io.Discard)
	}()
	waitForHealthz(t, addr, done)

	parsed := postOnPublish(t, addr, "seed-hardening-token")
	if parsed["code"] != float64(0) {
		t.Errorf("code = %v, want 0 (publish authorized: EVENTCAST_ALLOW_SEED_ENABLED_ASSIGNMENTS=true was set)", parsed["code"])
	}

	cancel()
	<-done
}

func TestRunHealthCheckSucceedsAgainstHealthyServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	addr := strings.TrimPrefix(server.URL, "http://")
	err := runHealthCheck(envMap(withRequiredPaths(t, map[string]string{
		config.EnvNodeID:   "test-node",
		config.EnvHTTPAddr: addr,
	})))
	if err != nil {
		t.Fatalf("runHealthCheck() = %v, want nil", err)
	}
}

func TestRunHealthCheckFailsOnNonOKStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	addr := strings.TrimPrefix(server.URL, "http://")
	err := runHealthCheck(envMap(withRequiredPaths(t, map[string]string{
		config.EnvNodeID:   "test-node",
		config.EnvHTTPAddr: addr,
	})))
	if err == nil {
		t.Fatal("runHealthCheck() expected error for non-200 status, got nil")
	}
}

func TestRunHealthCheckFailsWhenServerUnreachable(t *testing.T) {
	err := runHealthCheck(envMap(withRequiredPaths(t, map[string]string{
		config.EnvNodeID:   "test-node",
		config.EnvHTTPAddr: freeLoopbackAddr(t),
	})))
	if err == nil {
		t.Fatal("runHealthCheck() expected error for unreachable server, got nil")
	}
}

func TestRunHealthCheckFailsFastOnInvalidConfig(t *testing.T) {
	err := runHealthCheck(envMap(map[string]string{}))
	if err == nil {
		t.Fatal("runHealthCheck() expected error for missing required configuration, got nil")
	}
}

func TestRunExposesMetricsEndpoint(t *testing.T) {
	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(withRequiredPaths(t, map[string]string{
			config.EnvNodeID:   "test-node",
			config.EnvHTTPAddr: addr,
		})), io.Discard)
	}()
	waitForHealthz(t, addr, done)

	resp, err := http.Get(fmt.Sprintf("http://%s/metrics", addr))
	if err != nil {
		t.Fatalf("GET /metrics failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /metrics status = %d, want 200", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read /metrics body: %v", err)
	}
	out := string(body)
	for _, want := range []string{
		"media_agent_db_healthy",
		"media_agent_process_uptime_seconds",
		"media_agent_controlplane_enabled",
		"media_agent_sessions",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("expected /metrics output to contain %q, got:\n%s", want, out)
		}
	}

	cancel()
	<-done
}

// TestCollectMetricsResetsSessionsAndRelaysToZeroAfterStateTransitions
// reproduces the field-test defect directly against collectMetrics (not
// through a full run(), since exercising a real YouTube relay needs
// ffmpeg): an active session and a running relay must both be reported,
// and once the session disconnects and the relay stops, the very next
// scrape must show both back at zero rather than stuck at their last
// nonzero reading (setByLabel's replacement, Gauge.SetGroup, is what
// makes this work - see internal/metrics/metrics.go).
func TestCollectMetricsResetsSessionsAndRelaysToZeroAfterStateTransitions(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "media-agent.sqlite3"), 5*time.Second)
	if err != nil {
		t.Fatalf("store.Open() error: %v", err)
	}
	defer st.Close()

	reg := metrics.NewRegistry()
	sink := metrics.NewSink(reg)
	var reconcileLastRunAt atomic.Int64
	var shuttingDown atomic.Bool
	collect := collectMetrics(st, config.Config{}, nil, sink, time.Now(), &reconcileLastRunAt, &shuttingDown)

	now := time.Now().UTC()
	session, err := st.CreateSession(ctx, "evt1", "ingest1", "pb-1", now)
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	if err := st.UpsertRelayStarting(ctx, "evt1", session.ID, now); err != nil {
		t.Fatalf("UpsertRelayStarting() error: %v", err)
	}
	if err := st.MarkRelayRunning(ctx, session.ID, now); err != nil {
		t.Fatalf("MarkRelayRunning() error: %v", err)
	}

	collect(ctx)
	var buf strings.Builder
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, `media_agent_sessions{status="active"} 1`) {
		t.Fatalf("expected an active session, got:\n%s", out)
	}
	if !strings.Contains(out, `media_agent_youtube_relays{status="running"} 1`) {
		t.Fatalf("expected a running relay, got:\n%s", out)
	}

	if err := st.MarkDisconnected(ctx, session.ID, store.EndReasonUnpublish, time.Now().UTC()); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}
	if err := st.MarkRelayStopped(ctx, session.ID, time.Now().UTC()); err != nil {
		t.Fatalf("MarkRelayStopped() error: %v", err)
	}

	collect(ctx)
	buf.Reset()
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out = buf.String()
	if !strings.Contains(out, `media_agent_sessions{status="active"} 0`) {
		t.Errorf("expected active sessions reset to 0 after disconnect, got:\n%s", out)
	}
	if !strings.Contains(out, `media_agent_youtube_relays{status="running"} 0`) {
		t.Errorf("expected running relays reset to 0 after stop, got:\n%s", out)
	}
}

func TestRunControlPlaneSyncPopulatesAssignmentsAndAuthorizesPublish(t *testing.T) {
	mock := controlplane.NewMockServer("node-token-abc")
	now := time.Now().UTC()
	mock.SetAssignments("v1", []store.Assignment{{
		IngestID:             "cp-stream",
		EventID:              "cp-event",
		PlaybackID:           "cp-pb",
		SecretTokenHash:      store.HashToken("cp-secret"),
		Enabled:              true,
		PublishWindowStartAt: now.Add(-time.Hour),
		PublishWindowEndAt:   now.Add(time.Hour),
		ConfigVersion:        "1",
	}})
	srv := httptest.NewServer(mock.Handler())
	defer srv.Close()

	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(withRequiredPaths(t, map[string]string{
			config.EnvNodeID:                "test-node",
			config.EnvHTTPAddr:              addr,
			config.EnvControlPlaneBaseURL:   srv.URL,
			config.EnvControlPlaneNodeToken: "node-token-abc",
		})), io.Discard)
	}()
	waitForHealthz(t, addr, done)

	body := fmt.Sprintf(`{"action":"on_publish","stream":"cp-stream","app":"live","param":"?token=cp-secret"}`)
	resp, err := http.Post(fmt.Sprintf("http://%s/internal/srs/on-publish", addr), "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST on-publish failed: %v", err)
	}
	defer resp.Body.Close()
	var parsed map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	if parsed["code"] != float64(0) {
		t.Errorf("code = %v, want 0 (publish authorized via control-plane-synced assignment)", parsed["code"])
	}

	cancel()
	<-done
}

// TestRunRestartPreservesControlPlaneSyncedAssignmentAcrossColdSyncFailure
// proves durability across a real process restart, not just an in-run
// SyncOnce failure: a first run() successfully syncs one assignment from a
// real control-plane mock, shuts down cleanly, and a second run() against
// the SAME database file - but now pointed at an unreachable control plane
// - must still authorize a publish using that last-known-good, disk-backed
// assignment.
func TestRunRestartPreservesControlPlaneSyncedAssignmentAcrossColdSyncFailure(t *testing.T) {
	base := t.TempDir()
	envBase := map[string]string{
		config.EnvNodeID:     "test-node",
		config.EnvDBPath:     filepath.Join(base, "db", "media-agent.sqlite3"),
		config.EnvSpoolRoot:  filepath.Join(base, "spool"),
		config.EnvSRSHLSRoot: filepath.Join(base, "srs-output"),
	}

	mock := controlplane.NewMockServer("node-token-abc")
	now := time.Now().UTC()
	mock.SetAssignments("v1", []store.Assignment{{
		IngestID:             "restart-stream",
		EventID:              "restart-event",
		PlaybackID:           "restart-pb",
		SecretTokenHash:      store.HashToken("restart-secret"),
		Enabled:              true,
		PublishWindowStartAt: now.Add(-time.Hour),
		PublishWindowEndAt:   now.Add(time.Hour),
		ConfigVersion:        "1",
	}})
	srv := httptest.NewServer(mock.Handler())
	defer srv.Close()

	// First run: real control plane reachable, syncs the assignment, then
	// shuts down cleanly (simulating a normal stop, not a crash).
	addr1 := freeLoopbackAddr(t)
	ctx1, cancel1 := context.WithCancel(context.Background())
	env1 := map[string]string{}
	for k, v := range envBase {
		env1[k] = v
	}
	env1[config.EnvHTTPAddr] = addr1
	env1[config.EnvControlPlaneBaseURL] = srv.URL
	env1[config.EnvControlPlaneNodeToken] = "node-token-abc"

	done1 := make(chan error, 1)
	go func() { done1 <- run(ctx1, envMap(env1), io.Discard) }()
	waitForHealthz(t, addr1, done1)
	cancel1()
	select {
	case err := <-done1:
		if err != nil {
			t.Fatalf("first run() = %v, want nil", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("first run() did not shut down after context cancellation")
	}

	// Second run: same DB file (the "restart"), but the control plane is now
	// unreachable. Startup sync must fail non-fatally and the agent must
	// still authorize a publish using the assignment persisted to disk by
	// the first run.
	addr2 := freeLoopbackAddr(t)
	ctx2, cancel2 := context.WithCancel(context.Background())
	env2 := map[string]string{}
	for k, v := range envBase {
		env2[k] = v
	}
	env2[config.EnvHTTPAddr] = addr2
	env2[config.EnvControlPlaneBaseURL] = "http://127.0.0.1:1" // reserved, connection refused
	env2[config.EnvControlPlaneNodeToken] = "node-token-abc"

	done2 := make(chan error, 1)
	go func() { done2 <- run(ctx2, envMap(env2), io.Discard) }()
	waitForHealthz(t, addr2, done2)

	body := `{"action":"on_publish","stream":"restart-stream","app":"live","param":"?token=restart-secret"}`
	resp, err := http.Post(fmt.Sprintf("http://%s/internal/srs/on-publish", addr2), "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST on-publish failed: %v", err)
	}
	defer resp.Body.Close()
	var parsed map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	if parsed["code"] != float64(0) {
		t.Errorf("code = %v, want 0 (last-known-good, disk-persisted assignment from before restart should still authorize publish despite the control plane being unreachable on this run)", parsed["code"])
	}

	cancel2()
	<-done2
}

func TestRunOperatorEndpointsRequireToken(t *testing.T) {
	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(withRequiredPaths(t, map[string]string{
			config.EnvNodeID:            "test-node",
			config.EnvHTTPAddr:          addr,
			config.EnvR2Endpoint:        "http://127.0.0.1:1", // never dialed; auth rejects first
			config.EnvR2Bucket:          "test-bucket",
			config.EnvR2AccessKeyID:     "test-key",
			config.EnvR2SecretAccessKey: "test-secret",
			config.EnvOperatorAPIToken:  "operator-secret",
		})), io.Discard)
	}()
	waitForHealthz(t, addr, done)

	resp, err := http.Post(fmt.Sprintf("http://%s/internal/events/evt1/finalize", addr), "application/json", nil)
	if err != nil {
		t.Fatalf("POST finalize failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("finalize without a token: status = %d, want 401", resp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("http://%s/internal/events/evt1/finalize", addr), nil)
	req.Header.Set("Authorization", "Bearer operator-secret")
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("authenticated POST finalize failed: %v", err)
	}
	resp2.Body.Close()
	if resp2.StatusCode == http.StatusUnauthorized {
		t.Error("finalize with the correct token was still rejected as unauthorized")
	}

	cancel()
	<-done
}

func TestRunRateLimitsSRSCallbacks(t *testing.T) {
	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(withRequiredPaths(t, map[string]string{
			config.EnvNodeID:         "test-node",
			config.EnvHTTPAddr:       addr,
			config.EnvRateLimitRPS:   "1",
			config.EnvRateLimitBurst: "1",
		})), io.Discard)
	}()
	waitForHealthz(t, addr, done)

	url := fmt.Sprintf("http://%s/internal/srs/on-publish", addr)
	body := `{"action":"on_publish","stream":"unknown","app":"live","param":"?token=x"}`

	resp1, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("first request failed: %v", err)
	}
	resp1.Body.Close()
	if resp1.StatusCode != http.StatusOK {
		t.Fatalf("first request status = %d, want 200 (within burst)", resp1.StatusCode)
	}

	resp2, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("second request failed: %v", err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusTooManyRequests {
		t.Errorf("second immediate request status = %d, want 429 (burst exhausted)", resp2.StatusCode)
	}

	cancel()
	<-done
}
