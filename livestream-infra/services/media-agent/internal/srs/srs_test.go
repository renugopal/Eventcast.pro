package srs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

type testEnv struct {
	handlers  *Handlers
	buf       *bytes.Buffer
	store     *store.Store
	hlsRoot   string
	spoolRoot string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	dir := t.TempDir()
	hlsRoot := filepath.Join(dir, "srs-output")
	spoolRoot := filepath.Join(dir, "spool")
	if err := os.MkdirAll(hlsRoot, 0o750); err != nil {
		t.Fatalf("mkdir hls root: %v", err)
	}

	st, err := store.Open(context.Background(), filepath.Join(dir, "media-agent.sqlite3"), time.Second)
	if err != nil {
		t.Fatalf("store.Open() error: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	var buf bytes.Buffer
	logger := logging.New(&buf, slog.LevelDebug)

	return &testEnv{
		handlers:  &Handlers{Store: st, HLSRoot: hlsRoot, SpoolRoot: spoolRoot, Logger: logger},
		buf:       &buf,
		store:     st,
		hlsRoot:   hlsRoot,
		spoolRoot: spoolRoot,
	}
}

// seedAssignment imports a valid, wide-window assignment and returns the
// token that authorizes it.
func (e *testEnv) seedAssignment(t *testing.T, ingestID string, mutate func(a *store.Assignment)) string {
	t.Helper()
	token := "token-for-" + ingestID
	now := time.Now().UTC()
	a := store.Assignment{
		IngestID:             ingestID,
		EventID:              "event-" + ingestID,
		PlaybackID:           "pb-" + ingestID,
		SecretTokenHash:      store.HashToken(token),
		Enabled:              true,
		PublishWindowStartAt: now.Add(-time.Hour),
		PublishWindowEndAt:   now.Add(time.Hour),
		ConfigVersion:        "1",
		UpdatedAt:            now,
	}
	if mutate != nil {
		mutate(&a)
	}
	if _, err := e.store.ImportAssignments(context.Background(), []store.Assignment{a}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}
	return token
}

func publishBody(stream, token string) string {
	return fmt.Sprintf(`{"action":"on_publish","stream":%q,"app":"live","param":"?token=%s"}`, stream, token)
}

func hlsBody(stream, file string, seqNo int) string {
	return fmt.Sprintf(`{"action":"on_hls","stream":%q,"app":"live","file":%q,"duration":4.0,"seq_no":%d}`, stream, file, seqNo)
}

func unpublishBody(stream string) string {
	return fmt.Sprintf(`{"action":"on_unpublish","stream":%q,"app":"live"}`, stream)
}

func doRequest(t *testing.T, h http.Handler, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON response: %v (raw: %s)", err, rec.Body.String())
	}
	return rec, resp
}

func writeSourceFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o640); err != nil {
		t.Fatalf("write source file: %v", err)
	}
}

// --- on_publish ---------------------------------------------------------

func TestOnPublishAcceptsValidCredential(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)

	rec, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if resp["code"] != float64(0) {
		t.Errorf("code = %v, want 0", resp["code"])
	}

	if strings.Contains(env.buf.String(), token) {
		t.Fatal("secret token leaked into log output")
	}
}

func TestOnPublishRejectsUnknownIngestID(t *testing.T) {
	env := newTestEnv(t)
	rec, resp := doRequest(t, env.handlers.OnPublish(), publishBody("unknown-stream", "any-token"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (SRS rejections are HTTP 200 with a non-zero code)", rec.Code, http.StatusOK)
	}
	if resp["code"] == float64(0) {
		t.Error("code = 0, want non-zero for an unknown ingest id")
	}
	if resp["error"] != "ASSIGNMENT_MISMATCH" {
		t.Errorf("error = %v, want ASSIGNMENT_MISMATCH", resp["error"])
	}
}

func TestOnPublishRejectsDisabledAssignment(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", func(a *store.Assignment) { a.Enabled = false })

	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if resp["code"] == float64(0) {
		t.Error("code = 0, want non-zero for a disabled assignment")
	}
	if resp["error"] != "AUTH_INVALID" {
		t.Errorf("error = %v, want AUTH_INVALID", resp["error"])
	}
}

func TestOnPublishRejectsExpiredWindow(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", func(a *store.Assignment) {
		a.PublishWindowStartAt = time.Now().Add(-2 * time.Hour)
		a.PublishWindowEndAt = time.Now().Add(-time.Hour)
	})

	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if resp["code"] == float64(0) {
		t.Error("code = 0, want non-zero after the publish window has closed")
	}
	if resp["error"] != "PUBLISH_WINDOW_CLOSED" {
		t.Errorf("error = %v, want PUBLISH_WINDOW_CLOSED", resp["error"])
	}
}

func TestOnPublishRejectsBeforeWindow(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", func(a *store.Assignment) {
		a.PublishWindowStartAt = time.Now().Add(time.Hour)
		a.PublishWindowEndAt = time.Now().Add(2 * time.Hour)
	})

	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if resp["code"] == float64(0) {
		t.Error("code = 0, want non-zero before the publish window opens")
	}
	if resp["error"] != "PUBLISH_WINDOW_CLOSED" {
		t.Errorf("error = %v, want PUBLISH_WINDOW_CLOSED", resp["error"])
	}
}

func TestOnPublishRejectsInvalidToken(t *testing.T) {
	env := newTestEnv(t)
	env.seedAssignment(t, "teststream", nil)

	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", "wrong-token"))
	if resp["code"] == float64(0) {
		t.Error("code = 0, want non-zero for an invalid token")
	}
	if resp["error"] != "AUTH_INVALID" {
		t.Errorf("error = %v, want AUTH_INVALID", resp["error"])
	}
}

func TestOnPublishRejectsMissingToken(t *testing.T) {
	env := newTestEnv(t)
	env.seedAssignment(t, "teststream", nil)

	body := `{"action":"on_publish","stream":"teststream","app":"live"}`
	_, resp := doRequest(t, env.handlers.OnPublish(), body)
	if resp["error"] != "AUTH_INVALID" {
		t.Errorf("error = %v, want AUTH_INVALID for a missing token", resp["error"])
	}
}

func TestOnPublishRejectsConflictingActivePublisher(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)

	_, first := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if first["code"] != float64(0) {
		t.Fatalf("first publish rejected: %v", first)
	}

	_, second := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if second["code"] == float64(0) {
		t.Error("code = 0, want non-zero for a conflicting active publisher")
	}
	if second["error"] != "DUPLICATE_PUBLISHER" {
		t.Errorf("error = %v, want DUPLICATE_PUBLISHER", second["error"])
	}
}

func TestOnPublishAllowsReconnectAfterUnpublish(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)

	_, first := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if first["code"] != float64(0) {
		t.Fatalf("first publish rejected: %v", first)
	}
	firstSession, found, err := env.store.FindMostRecentByIngestID(context.Background(), "teststream")
	if err != nil || !found {
		t.Fatalf("FindMostRecentByIngestID() after first publish: found=%v err=%v", found, err)
	}

	_, unpub := doRequest(t, env.handlers.OnUnpublish(), unpublishBody("teststream"))
	if unpub["code"] != float64(0) {
		t.Fatalf("unpublish rejected: %v", unpub)
	}

	_, second := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if second["code"] != float64(0) {
		t.Fatalf("reconnect publish rejected: %v", second)
	}
	secondSession, found, err := env.store.FindMostRecentByIngestID(context.Background(), "teststream")
	if err != nil || !found {
		t.Fatalf("FindMostRecentByIngestID() after reconnect: found=%v err=%v", found, err)
	}

	if secondSession.ID == firstSession.ID {
		t.Error("reconnect must create a new session identity, not reopen the old one")
	}
	if secondSession.Status != store.SessionActive {
		t.Errorf("reconnect session status = %q, want %q", secondSession.Status, store.SessionActive)
	}
}

// --- on_hls --------------------------------------------------------------

func TestOnHLSCapturesSegmentAndRecordsQueueRow(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	if _, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token)); resp["code"] != float64(0) {
		t.Fatalf("publish rejected: %v", resp)
	}

	srcFile := filepath.Join(env.hlsRoot, "live", "teststream", "1700000000-1.ts")
	writeSourceFile(t, srcFile, "segment-bytes")

	rec, resp := doRequest(t, env.handlers.OnHLS(), hlsBody("teststream", srcFile, 1))
	if rec.Code != http.StatusOK || resp["code"] != float64(0) {
		t.Fatalf("on_hls rejected: status=%d resp=%v", rec.Code, resp)
	}

	jobs, err := env.store.ListSegmentsByStatus(context.Background(), store.SegmentQueued)
	if err != nil {
		t.Fatalf("ListSegmentsByStatus() error: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("len(jobs) = %d, want 1", len(jobs))
	}
	if _, err := os.Stat(jobs[0].SpoolPath); err != nil {
		t.Errorf("captured spool file missing: %v", err)
	}
}

func TestOnHLSDuplicateCallbackIsIdempotent(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))

	srcFile := filepath.Join(env.hlsRoot, "live", "teststream", "1700000000-1.ts")
	writeSourceFile(t, srcFile, "segment-bytes")

	if _, resp := doRequest(t, env.handlers.OnHLS(), hlsBody("teststream", srcFile, 1)); resp["code"] != float64(0) {
		t.Fatalf("first on_hls rejected: %v", resp)
	}
	if _, resp := doRequest(t, env.handlers.OnHLS(), hlsBody("teststream", srcFile, 1)); resp["code"] != float64(0) {
		t.Fatalf("duplicate on_hls rejected: %v", resp)
	}

	jobs, err := env.store.ListSegmentsByStatus(context.Background(), store.SegmentQueued)
	if err != nil {
		t.Fatalf("ListSegmentsByStatus() error: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("len(jobs) = %d after a duplicate callback, want 1", len(jobs))
	}
}

func TestOnHLSConcurrentDuplicateCallbacksCreateExactlyOneRecord(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))

	srcFile := filepath.Join(env.hlsRoot, "live", "teststream", "1700000000-1.ts")
	writeSourceFile(t, srcFile, "segment-bytes")

	const attempts = 6
	var wg sync.WaitGroup
	codes := make(chan float64, attempts)
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, resp := doRequest(t, env.handlers.OnHLS(), hlsBody("teststream", srcFile, 1))
			codes <- resp["code"].(float64)
		}()
	}
	wg.Wait()
	close(codes)

	for c := range codes {
		if c != 0 {
			t.Errorf("concurrent on_hls callback returned code = %v, want 0", c)
		}
	}

	jobs, err := env.store.ListSegmentsByStatus(context.Background(), store.SegmentQueued)
	if err != nil {
		t.Fatalf("ListSegmentsByStatus() error: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("len(jobs) = %d after %d concurrent duplicate callbacks, want 1", len(jobs), attempts)
	}

	entries, err := os.ReadDir(filepath.Dir(jobs[0].SpoolPath))
	if err != nil {
		t.Fatalf("read spool session dir: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("spool session dir has %d files, want 1 (no duplicate captures)", len(entries))
	}
}

func TestOnHLSRejectsWhenNoSessionExists(t *testing.T) {
	env := newTestEnv(t)
	srcFile := filepath.Join(env.hlsRoot, "live", "teststream", "1700000000-1.ts")
	writeSourceFile(t, srcFile, "segment-bytes")

	_, resp := doRequest(t, env.handlers.OnHLS(), hlsBody("teststream", srcFile, 1))
	if resp["code"] == float64(0) {
		t.Error("code = 0, want non-zero when no session is on record for the stream")
	}
}

func TestOnHLSRejectsPathOutsideHLSRoot(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))

	outside := filepath.Join(filepath.Dir(env.hlsRoot), "outside.ts")
	writeSourceFile(t, outside, "not allowed")

	_, resp := doRequest(t, env.handlers.OnHLS(), hlsBody("teststream", outside, 1))
	if resp["code"] == float64(0) {
		t.Error("code = 0, want non-zero for a file path outside the configured HLS root")
	}
}

func TestOnHLSRejectsMissingSourceFile(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))

	missing := filepath.Join(env.hlsRoot, "live", "teststream", "does-not-exist.ts")
	_, resp := doRequest(t, env.handlers.OnHLS(), hlsBody("teststream", missing, 1))
	if resp["code"] == float64(0) {
		t.Error("code = 0, want non-zero when the source file does not exist")
	}
	if resp["error"] != "SPOOL_FILE_MISSING" {
		t.Errorf("error = %v, want SPOOL_FILE_MISSING", resp["error"])
	}
}

// --- on_unpublish ----------------------------------------------------------

func TestOnUnpublishClosesSession(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))

	rec, resp := doRequest(t, env.handlers.OnUnpublish(), unpublishBody("teststream"))
	if rec.Code != http.StatusOK || resp["code"] != float64(0) {
		t.Fatalf("on_unpublish rejected: status=%d resp=%v", rec.Code, resp)
	}

	sess, found, err := env.store.FindMostRecentByIngestID(context.Background(), "teststream")
	if err != nil {
		t.Fatalf("FindMostRecentByIngestID() error: %v", err)
	}
	if !found {
		t.Fatal("session not found")
	}
	if sess.Status != store.SessionDisconnected {
		t.Errorf("Status = %q, want %q", sess.Status, store.SessionDisconnected)
	}
}

func TestOnUnpublishUnknownStreamIsNoop(t *testing.T) {
	env := newTestEnv(t)
	rec, resp := doRequest(t, env.handlers.OnUnpublish(), unpublishBody("never-published"))
	if rec.Code != http.StatusOK || resp["code"] != float64(0) {
		t.Fatalf("on_unpublish for unknown stream = status=%d resp=%v, want 200/code:0 (idempotent no-op)", rec.Code, resp)
	}
}

// --- shared transport-level behavior (unchanged from Phase 0/1) ----------

func TestHandlerRejectsNonPOST(t *testing.T) {
	env := newTestEnv(t)
	req := httptest.NewRequest(http.MethodGet, "/internal/srs/on-publish", nil)
	rec := httptest.NewRecorder()

	env.handlers.OnPublish().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
	if allow := rec.Header().Get("Allow"); allow != http.MethodPost {
		t.Errorf("Allow header = %q, want %q", allow, http.MethodPost)
	}
}

func TestHandlerRejectsMalformedJSON(t *testing.T) {
	env := newTestEnv(t)
	req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-publish", strings.NewReader(`{"action":`))
	rec := httptest.NewRecorder()

	env.handlers.OnPublish().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	var resp errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON error body: %v (raw: %s)", err, rec.Body.String())
	}
	if resp.Error == "" {
		t.Error("Error = \"\", want non-empty")
	}
}

func TestHandlerRejectsOversizedBody(t *testing.T) {
	env := newTestEnv(t)
	oversized := `{"action":"on_publish","stream":"` + strings.Repeat("a", MaxCallbackBodyBytes+1) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-publish", strings.NewReader(oversized))
	rec := httptest.NewRecorder()

	env.handlers.OnPublish().ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusRequestEntityTooLarge, rec.Body.String())
	}
}

func TestHandlerRejectsMissingRequiredFields(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"missing action", `{"stream":"teststream"}`},
		{"missing stream", `{"action":"on_publish"}`},
		{"empty object", `{}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := newTestEnv(t)
			req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-publish", strings.NewReader(tc.body))
			rec := httptest.NewRecorder()

			env.handlers.OnPublish().ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}
