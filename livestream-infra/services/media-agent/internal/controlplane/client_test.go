package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
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
