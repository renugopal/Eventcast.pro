package health

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHandlerReturnsExpectedShape(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var resp Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON body: %v (raw: %s)", err, rec.Body.String())
	}

	if resp.Status != "ok" {
		t.Errorf("Status = %q, want %q", resp.Status, "ok")
	}
	if resp.Service != ServiceName {
		t.Errorf("Service = %q, want %q", resp.Service, ServiceName)
	}
	if resp.Version == "" {
		t.Error("Version = \"\", want non-empty")
	}
	if resp.Timestamp == "" {
		t.Fatal("Timestamp = \"\", want non-empty")
	}
	if _, err := time.Parse(time.RFC3339, resp.Timestamp); err != nil {
		t.Errorf("Timestamp %q is not RFC3339: %v", resp.Timestamp, err)
	}
}

func TestHandlerRejectsNonGET(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/healthz", nil)
	rec := httptest.NewRecorder()

	Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandlerFieldsAreStableAcrossCalls(t *testing.T) {
	do := func() Response {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		rec := httptest.NewRecorder()
		Handler().ServeHTTP(rec, req)

		var resp Response
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("invalid JSON body: %v", err)
		}
		return resp
	}

	first := do()
	second := do()

	if first.Service != second.Service || first.Version != second.Version {
		t.Errorf("service/version changed between calls: %+v vs %+v", first, second)
	}
}
