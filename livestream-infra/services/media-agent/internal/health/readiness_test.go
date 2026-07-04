package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadinessHandlerAllPass(t *testing.T) {
	checks := ReadinessChecks{
		Database:        func(ctx context.Context) error { return nil },
		SpoolWritable:   func(ctx context.Context) error { return nil },
		AssignmentCache: func(ctx context.Context) error { return nil },
	}

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	ReadinessHandler(checks).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp ReadinessResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	if resp.Status != "ready" {
		t.Errorf("Status = %q, want %q", resp.Status, "ready")
	}
	for name, ok := range resp.Checks {
		if !ok {
			t.Errorf("check %q = false, want true", name)
		}
	}
}

func TestReadinessHandlerOneFailureIsNotReady(t *testing.T) {
	checks := ReadinessChecks{
		Database:        func(ctx context.Context) error { return errors.New("db down") },
		SpoolWritable:   func(ctx context.Context) error { return nil },
		AssignmentCache: func(ctx context.Context) error { return nil },
	}

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	ReadinessHandler(checks).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}

	var resp ReadinessResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	if resp.Status != "not_ready" {
		t.Errorf("Status = %q, want %q", resp.Status, "not_ready")
	}
	if resp.Checks["database"] {
		t.Error("checks[database] = true, want false")
	}
	if !resp.Checks["spool_writable"] || !resp.Checks["assignment_cache"] {
		t.Error("unrelated checks must still report their own true result")
	}

	if rec.Body.Len() == 0 {
		t.Fatal("empty readiness body")
	}
	raw := rec.Body.String()
	if containsAny(raw, "db down", "/var/lib", "secret", "token") {
		t.Errorf("readiness body leaked internal detail: %s", raw)
	}
}

func TestReadinessHandlerNilChecksPassByDefault(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	ReadinessHandler(ReadinessChecks{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d for all-nil checks", rec.Code, http.StatusOK)
	}
}

func TestReadinessHandlerRejectsNonGET(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/readyz", nil)
	rec := httptest.NewRecorder()
	ReadinessHandler(ReadinessChecks{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func containsAny(s string, substrs ...string) bool {
	for _, sub := range substrs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
