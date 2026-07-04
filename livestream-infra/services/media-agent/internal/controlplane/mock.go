package controlplane

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// MockServer is a deterministic, in-memory implementation of the
// documented control-plane assignments contract (see client.go's package
// comment), used by integration tests and local/dev Compose stacks that
// need a working control plane without a real one. It is never used in
// production - it exists precisely because "the exact endpoint contract
// is absent" upstream and this package must not guess a production URL
// or secret format.
//
// It also exposes a small admin surface (under /__mock__/) so a test can
// deterministically drive control-plane behavior: replacing the
// assignment set (simulating a rotation or revocation) and toggling a
// simulated outage (returning 503 to every real assignments request,
// simulating "temporary control-plane outage").
type MockServer struct {
	mu            sync.Mutex
	requiredToken string
	configVersion string
	assignments   []store.Assignment
	failing       bool
}

// NewMockServer returns a MockServer. If requiredToken is non-empty,
// every /internal/media/nodes/*/assignments request must present it as
// "Authorization: Bearer <requiredToken>"; the admin surface never
// requires it, since it exists only for a test harness's own use.
func NewMockServer(requiredToken string) *MockServer {
	return &MockServer{requiredToken: requiredToken}
}

// SetAssignments replaces the assignment set the mock serves, along with
// the config_version reported in the response envelope.
func (m *MockServer) SetAssignments(configVersion string, assignments []store.Assignment) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configVersion = configVersion
	m.assignments = assignments
}

// SetFailing toggles a simulated control-plane outage: while true, every
// assignments request receives HTTP 503.
func (m *MockServer) SetFailing(failing bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failing = failing
}

// Handler returns the mock's http.Handler, ready to be wrapped by
// httptest.NewServer in tests or served directly by cmd/controlplane-mock
// in a Compose stack.
func (m *MockServer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /internal/media/nodes/{node_id}/assignments", m.handleAssignments)
	mux.HandleFunc("POST /__mock__/assignments", m.handleSetAssignments)
	mux.HandleFunc("POST /__mock__/fail", m.handleSetFailing)
	mux.HandleFunc("GET /__mock__/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	return mux
}

func (m *MockServer) handleAssignments(w http.ResponseWriter, r *http.Request) {
	if m.requiredToken != "" {
		want := "Bearer " + m.requiredToken
		if r.Header.Get("Authorization") != want {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	m.mu.Lock()
	failing := m.failing
	configVersion := m.configVersion
	assignments := m.assignments
	m.mu.Unlock()

	if failing {
		http.Error(w, "simulated control-plane outage", http.StatusServiceUnavailable)
		return
	}

	resp := AssignmentsResponse{
		ConfigVersion: configVersion,
		GeneratedAt:   time.Now().UTC(),
		Assignments:   assignments,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func (m *MockServer) handleSetAssignments(w http.ResponseWriter, r *http.Request) {
	var body AssignmentsResponse
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxResponseBytes)).Decode(&body); err != nil {
		http.Error(w, "malformed JSON body", http.StatusBadRequest)
		return
	}
	m.SetAssignments(body.ConfigVersion, body.Assignments)
	w.WriteHeader(http.StatusNoContent)
}

func (m *MockServer) handleSetFailing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Failing bool `json:"failing"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		http.Error(w, "malformed JSON body", http.StatusBadRequest)
		return
	}
	m.SetFailing(body.Failing)
	w.WriteHeader(http.StatusNoContent)
}
