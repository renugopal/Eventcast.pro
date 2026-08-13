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

// The B2 booleans are informational, not readiness requirements. They must
// stay OUT of Checks, whose contract (asserted by TestReadinessHandlerAllPass)
// is that every entry must be true - otherwise a legitimately disabled
// archival subsystem would look like a failing check to monitoring.
func TestReadinessB2StatusIsInformationalAndOutsideChecks(t *testing.T) {
	checks := ReadinessChecks{
		Database:          func(ctx context.Context) error { return nil },
		SpoolWritable:     func(ctx context.Context) error { return nil },
		AssignmentCache:   func(ctx context.Context) error { return nil },
		ControlPlaneCache: func(ctx context.Context) error { return nil },
	}

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	// Configured but archival deliberately switched off - the normal
	// production posture before the connectivity test is approved.
	ReadinessHandlerWithB2(checks, B2Status{Configured: true, ArchivalEnabled: false}).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: disabled B2 archival must never make a node unready", rec.Code, http.StatusOK)
	}

	var resp ReadinessResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	for name := range resp.Checks {
		if strings.HasPrefix(name, "b2_") {
			t.Errorf("B2 status leaked into Checks as %q", name)
		}
	}
	if resp.B2 == nil {
		t.Fatal("B2 status missing from the response")
	}
	if !resp.B2.Configured || resp.B2.ArchivalEnabled {
		t.Errorf("B2 = %+v, want Configured=true ArchivalEnabled=false", *resp.B2)
	}
}

// The plain handler keeps its original response shape for existing consumers.
func TestReadinessHandlerOmitsB2WhenNotProvided(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	ReadinessHandler(ReadinessChecks{}).ServeHTTP(rec, req)

	if strings.Contains(rec.Body.String(), `"b2"`) {
		t.Errorf("plain ReadinessHandler emitted a b2 field: %s", rec.Body.String())
	}
}
