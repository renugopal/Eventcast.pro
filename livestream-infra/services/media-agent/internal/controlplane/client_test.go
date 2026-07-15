package controlplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func testAssignment(ingestID string) store.Assignment {
	now := time.Now().UTC()
	return store.Assignment{
		IngestID:             ingestID,
		EventID:              "event-" + ingestID,
		PlaybackID:           "pb-" + ingestID,
		SecretTokenHash:      store.HashToken("secret-" + ingestID),
		Enabled:              true,
		PublishWindowStartAt: now.Add(-time.Hour),
		PublishWindowEndAt:   now.Add(time.Hour),
		ConfigVersion:        "1",
	}
}

func TestHTTPClientFetchAssignmentsSuccess(t *testing.T) {
	mock := NewMockServer("node-token-123")
	mock.SetAssignments("v1", []store.Assignment{testAssignment("stream-1")})
	srv := httptest.NewServer(mock.Handler())
	defer srv.Close()

	client := NewHTTPClient(srv.URL, logging.Secret("node-token-123"), srv.Client())
	resp, err := client.FetchAssignments(context.Background(), "node-a")
	if err != nil {
		t.Fatalf("FetchAssignments() error: %v", err)
	}
	if resp.ConfigVersion != "v1" || len(resp.Assignments) != 1 {
		t.Errorf("got %+v, want config_version=v1 with 1 assignment", resp)
	}
	if resp.Assignments[0].IngestID != "stream-1" {
		t.Errorf("IngestID = %q, want stream-1", resp.Assignments[0].IngestID)
	}
}

func TestHTTPClientFetchAssignmentsRejectsWrongToken(t *testing.T) {
	mock := NewMockServer("correct-token")
	srv := httptest.NewServer(mock.Handler())
	defer srv.Close()

	client := NewHTTPClient(srv.URL, logging.Secret("wrong-token"), srv.Client())
	if _, err := client.FetchAssignments(context.Background(), "node-a"); err == nil {
		t.Fatal("FetchAssignments() expected error for an incorrect token, got nil")
	}
}

func TestHTTPClientFetchAssignmentsSurfacesOutage(t *testing.T) {
	mock := NewMockServer("")
	mock.SetFailing(true)
	srv := httptest.NewServer(mock.Handler())
	defer srv.Close()

	client := NewHTTPClient(srv.URL, "", srv.Client())
	if _, err := client.FetchAssignments(context.Background(), "node-a"); err == nil {
		t.Fatal("FetchAssignments() expected error during a simulated outage, got nil")
	}
}

func TestHTTPClientFetchAssignmentsRespectsContextTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := NewHTTPClient(srv.URL, "", srv.Client())
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := client.FetchAssignments(ctx, "node-a"); err == nil {
		t.Fatal("FetchAssignments() expected a context-deadline error, got nil")
	}
}

func TestHTTPClientFetchAssignmentsNeverLeaksTokenInError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer srv.Close()

	secretToken := "super-secret-node-credential-xyz"
	client := NewHTTPClient(srv.URL, logging.Secret(secretToken), srv.Client())
	_, err := client.FetchAssignments(context.Background(), "node-a")
	if err == nil {
		t.Fatal("expected an error for a 500 response")
	}
	if strings.Contains(err.Error(), secretToken) {
		t.Errorf("error message leaked the node token: %v", err)
	}
}

// nodeAuthHeaderContractFixture is the subset of
// testdata/node_auth_header_contract.json this test actually consumes. That
// fixture is shared, byte-for-byte, with
// eventcast-admin/tests/security/media-agent-node-auth.test.ts — it is the
// single documented source of truth for the header-shape contract, so
// neither language's test hardcodes its own independent copy of these
// rules. Only the fields this file uses are modeled here; unknown JSON keys
// (including the whole "examples" array, which only the TypeScript side
// drives) are ignored by encoding/json, so a change to fields the Go side
// doesn't need never breaks this parse.
type nodeAuthHeaderContractFixture struct {
	RequiredHeaders []string `json:"required_headers"`
	StructuralRules struct {
		RequestIDPattern     string `json:"request_id_pattern"`
		TimestampToleranceMs int64  `json:"timestamp_tolerance_ms"`
	} `json:"structural_rules"`
}

// loadNodeAuthHeaderContractFixture reads the shared fixture from this
// package's testdata directory (the standard Go convention: "go test" sets
// the working directory to the package directory, so this relative path
// resolves without any build-config change).
func loadNodeAuthHeaderContractFixture(t *testing.T) nodeAuthHeaderContractFixture {
	t.Helper()
	data, err := os.ReadFile("testdata/node_auth_header_contract.json")
	if err != nil {
		t.Fatalf("read shared node-auth header contract fixture: %v", err)
	}
	var fixture nodeAuthHeaderContractFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse shared node-auth header contract fixture: %v", err)
	}
	return fixture
}

// TestHTTPClientFetchAssignmentsMatchesSharedHeaderContract is an
// independent protocol-conformance check, not an integration test: it
// proves only that the real, unmodified client.go implementation
// (NewHTTPClient/FetchAssignments) emits a request that is structurally
// compatible with the documented shared fixture
// (testdata/node_auth_header_contract.json) — the same fixture
// eventcast-admin's media-agent-node-auth.test.ts drives the real
// TypeScript validateMediaAgentAuthStructure through. It does not
// reimplement, and does not prove anything about, TypeScript authorization
// decisions, HMAC credential-digest verification, replay-nonce storage,
// rate limiting, Supabase-backed database behavior, or integration with a
// real deployed Admin route over a real network (see the fixture's own
// "scope" field). The httptest.Server below is the same in-process,
// loopback-only test double already used by every other test in this file
// — it only captures the real outgoing request for inspection; it never
// makes an authorization decision.
func TestHTTPClientFetchAssignmentsMatchesSharedHeaderContract(t *testing.T) {
	fixture := loadNodeAuthHeaderContractFixture(t)

	var (
		mu         sync.Mutex
		gotHeaders http.Header
		gotPath    string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotHeaders = r.Header.Clone()
		gotPath = r.URL.Path
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(AssignmentsResponse{
			ConfigVersion: "v1",
			GeneratedAt:   time.Now().UTC(),
		})
	}))
	defer srv.Close()

	const nodeID = "fixture-contract-node"
	const testToken = "fixture-only-node-token-for-header-contract-test"

	client := NewHTTPClient(srv.URL, logging.Secret(testToken), srv.Client())
	observedBefore := time.Now().UTC()
	if _, err := client.FetchAssignments(context.Background(), nodeID); err != nil {
		t.Fatalf("FetchAssignments() error: %v", err)
	}
	observedAfter := time.Now().UTC()

	mu.Lock()
	headers := gotHeaders
	path := gotPath
	mu.Unlock()

	for _, name := range fixture.RequiredHeaders {
		if headers.Get(name) == "" {
			t.Errorf("real client request is missing required header %q", name)
		}
	}

	requestID := headers.Get("X-EventCast-Request-Id")
	requestIDPattern, err := regexp.Compile(fixture.StructuralRules.RequestIDPattern)
	if err != nil {
		t.Fatalf("fixture request_id_pattern does not compile: %v", err)
	}
	if !requestIDPattern.MatchString(requestID) {
		t.Errorf("generated X-EventCast-Request-Id does not satisfy the fixture-defined shape %q", fixture.StructuralRules.RequestIDPattern)
	}

	if headers.Get("X-EventCast-Idempotency-Key") != requestID {
		t.Error("X-EventCast-Idempotency-Key does not exactly equal the generated X-EventCast-Request-Id")
	}

	if headers.Get("X-EventCast-Node-Id") != nodeID {
		t.Error("X-EventCast-Node-Id header does not match the node id the real client was asked to fetch assignments for")
	}
	if !strings.Contains(path, "/nodes/"+nodeID+"/assignments") {
		t.Errorf("request path %q does not contain the expected node id segment", path)
	}

	ts := headers.Get("X-EventCast-Timestamp")
	parsedTS, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		t.Fatalf("X-EventCast-Timestamp %q does not parse as RFC3339: %v", ts, err)
	}
	tolerance := time.Duration(fixture.StructuralRules.TimestampToleranceMs) * time.Millisecond
	if parsedTS.Before(observedBefore.Add(-tolerance)) || parsedTS.After(observedAfter.Add(tolerance)) {
		t.Error("X-EventCast-Timestamp is outside the fixture-defined tolerance relative to test observation time")
	}

	auth := headers.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		t.Error("Authorization header does not use the expected Bearer form")
	} else if strings.TrimPrefix(auth, "Bearer ") != testToken {
		t.Error("Authorization header's bearer token does not match the configured test token")
	}
}
