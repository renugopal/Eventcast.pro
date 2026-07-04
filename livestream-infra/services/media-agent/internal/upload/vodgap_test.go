package upload

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func newVODGapRequest(t *testing.T, method, eventID, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, "/internal/events/"+eventID+"/vod-gap", strings.NewReader(body))
	req.SetPathValue("event_id", eventID)
	return req
}

func TestVODGapHandlerGetReturnsCurrentState(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1}, 1, "key", 2, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	h := &VODGapHandler{Store: st, Logger: testLogger(t)}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, newVODGapRequest(t, http.MethodGet, "evt1", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var resp vodGapResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.GapCount != 2 || resp.GapStatus != store.VODGapPendingReview {
		t.Errorf("got %+v, want GapCount=2 GapStatus=pending_review", resp)
	}
}

func TestVODGapHandlerGetUnknownEventReturns404(t *testing.T) {
	st := openTestStore(t)
	h := &VODGapHandler{Store: st, Logger: testLogger(t)}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, newVODGapRequest(t, http.MethodGet, "no-such-event", ""))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestVODGapHandlerPostAcknowledge(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1}, 1, "key", 1, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	h := &VODGapHandler{Store: st, Logger: testLogger(t)}
	rec := httptest.NewRecorder()
	body := `{"action":"acknowledge","actor":"operator-1","reason":"reviewed field recording, gap confirmed acceptable"}`
	h.ServeHTTP(rec, newVODGapRequest(t, http.MethodPost, "evt1", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var resp vodGapResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.GapStatus != store.VODGapAcknowledged || resp.GapResolutionActor != "operator-1" {
		t.Errorf("got %+v, want acknowledged by operator-1", resp)
	}
}

func TestVODGapHandlerPostRejectsMissingActor(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1}, 1, "key", 1, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	h := &VODGapHandler{Store: st, Logger: testLogger(t)}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, newVODGapRequest(t, http.MethodPost, "evt1", `{"action":"acknowledge","actor":"","reason":"x"}`))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for a missing actor", rec.Code)
	}
}

func TestVODGapHandlerPostRejectsInvalidAction(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1}, 1, "key", 1, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	h := &VODGapHandler{Store: st, Logger: testLogger(t)}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, newVODGapRequest(t, http.MethodPost, "evt1", `{"action":"delete_everything","actor":"x","reason":"y"}`))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for an invalid action", rec.Code)
	}
}

func TestVODGapHandlerPostConflictingResolution(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1}, 1, "key", 1, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	h := &VODGapHandler{Store: st, Logger: testLogger(t)}
	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, newVODGapRequest(t, http.MethodPost, "evt1", `{"action":"acknowledge","actor":"op1","reason":"ok"}`))
	if rec1.Code != http.StatusOK {
		t.Fatalf("first resolution status = %d, want 200", rec1.Code)
	}

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, newVODGapRequest(t, http.MethodPost, "evt1", `{"action":"reject","actor":"op2","reason":"changed mind"}`))
	if rec2.Code != http.StatusConflict {
		t.Errorf("second (conflicting) resolution status = %d, want 409", rec2.Code)
	}
}

func TestVODGapHandlerMethodNotAllowed(t *testing.T) {
	st := openTestStore(t)
	h := &VODGapHandler{Store: st, Logger: testLogger(t)}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, newVODGapRequest(t, http.MethodDelete, "evt1", ""))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}
