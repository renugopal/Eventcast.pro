// Package controlplane implements the Media Agent's side of continuous
// control-plane assignment synchronization
// (03_DATA_MODEL_AND_API_CONTRACTS.md "Assignment synchronization": "the
// node periodically pulls assignments and stores a local cache").
//
// The exact production control-plane endpoint contract (base URL, auth
// token format, and response schema) is not specified anywhere in this
// repository's architecture documentation. Rather than guess a
// production shape, this package documents and implements one concrete,
// versioned contract (see AssignmentsResponse below) against which the
// real control plane can be built or adapted, together with a
// deterministic mock server (mock.go) usable for local development and
// integration tests without any real control-plane deployment.
//
// Documented contract:
//
//	GET {base_url}/internal/media/nodes/{node_id}/assignments
//	Headers:
//	  Authorization: Bearer <rotatable node credential>
//	  X-EventCast-Node-Id: <node_id>
//	  X-EventCast-Request-Id: <unique per-request UUID>
//	  X-EventCast-Timestamp: <RFC3339 request time>
//	  X-EventCast-Idempotency-Key: <same as Request-Id for this read-only GET>
//	Response 200 (application/json):
//	  {
//	    "config_version": "<opaque string, e.g. a monotonic counter or ETag>",
//	    "generated_at": "<RFC3339>",
//	    "assignments": [ { ...store.Assignment JSON shape... }, ... ]
//	  }
//
// "assignments" MUST be this node's complete current set: an ingest_id
// previously returned but now absent is treated by the syncer as revoked
// (internal/store.ApplyControlPlaneAssignments). A non-2xx response, a
// network error, or a response exceeding maxResponseBytes is a sync
// failure; the durable local cache and last-known-good state are left
// untouched (internal/controlplane.Syncer).
package controlplane

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/telemetry"
)

// maxResponseBytes bounds how much of a control-plane response this
// client will read, protecting against an unbounded or misbehaving
// response body regardless of what the (untrusted, network-reachable)
// control-plane endpoint returns.
const maxResponseBytes = 8 << 20 // 8 MiB

// AssignmentsResponse is the documented response body for
// GET /internal/media/nodes/{node_id}/assignments (see package doc).
type AssignmentsResponse struct {
	ConfigVersion string             `json:"config_version"`
	GeneratedAt   time.Time          `json:"generated_at"`
	Assignments   []store.Assignment `json:"assignments"`
}

// Client fetches the current assignment set for one media node from the
// control plane. Implementations must be bounded by ctx's deadline and
// must never log the credential used to authenticate the request.
type Client interface {
	FetchAssignments(ctx context.Context, nodeID string) (AssignmentsResponse, error)
}

// HTTPClient is the production Client implementation, documented in the
// package comment above.
type HTTPClient struct {
	// BaseURL is the control-plane origin, e.g. "https://control.eventcast.pro".
	BaseURL string
	// NodeToken authenticates every request as this node via a Bearer
	// token. It is a rotatable credential, never a stream secret.
	NodeToken logging.Secret
	// HTTPClient performs the request. Its Timeout, if set, is a hard
	// backstop in addition to ctx's deadline (both are respected: the
	// request fails as soon as either elapses).
	HTTPClient *http.Client
}

// NewHTTPClient returns an HTTPClient with a default *http.Client if
// httpClient is nil.
func NewHTTPClient(baseURL string, nodeToken logging.Secret, httpClient *http.Client) *HTTPClient {
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	return &HTTPClient{BaseURL: baseURL, NodeToken: nodeToken, HTTPClient: httpClient}
}

// FetchAssignments implements Client.
func (c *HTTPClient) FetchAssignments(ctx context.Context, nodeID string) (AssignmentsResponse, error) {
	url := strings.TrimSuffix(c.BaseURL, "/") + "/internal/media/nodes/" + nodeID + "/assignments"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return AssignmentsResponse{}, fmt.Errorf("controlplane: build request: %w", err)
	}
	requestID, err := newRequestID()
	if err != nil {
		return AssignmentsResponse{}, fmt.Errorf("controlplane: generate request id: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.NodeToken.Reveal())
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-EventCast-Node-Id", nodeID)
	req.Header.Set("X-EventCast-Request-Id", requestID)
	req.Header.Set("X-EventCast-Idempotency-Key", requestID)
	req.Header.Set("X-EventCast-Timestamp", time.Now().UTC().Format(time.RFC3339))

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		// err may embed the request URL but never the Authorization
		// header or token; net/http does not include request headers in
		// its error values.
		return AssignmentsResponse{}, fmt.Errorf("controlplane: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return AssignmentsResponse{}, fmt.Errorf("controlplane: read response: %w", err)
	}
	if len(body) > maxResponseBytes {
		return AssignmentsResponse{}, fmt.Errorf("controlplane: response exceeded %d bytes", maxResponseBytes)
	}

	if resp.StatusCode != http.StatusOK {
		return AssignmentsResponse{}, fmt.Errorf("controlplane: unexpected status %d", resp.StatusCode)
	}

	var parsed AssignmentsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return AssignmentsResponse{}, fmt.Errorf("controlplane: parse response: %w", err)
	}
	return parsed, nil
}

// RecordingStateReport is the node's evidence about one event's recording
// lifecycle, sent to
// POST {base_url}/internal/media/nodes/{node_id}/recordings/{event_id}.
//
// It carries evidence only. It deliberately does NOT carry
// retention days, retention expiry, or authoritative b2/integrity
// timestamps: retention is resolved solely by the control plane's own
// freeze_event_retention(), and the authoritative timestamps are assigned
// server-side from acceptance time, so a delayed or replayed report can
// start retention later but never earlier.
//
// The reporting node's identity is NOT a field here. It is proven by the
// node authentication headers below and resolved server-side, so a body
// value could never be used to impersonate another node.
type RecordingStateReport struct {
	State                  string `json:"state"`
	FinalizationGeneration string `json:"finalization_generation"`
	// LocalFinalizedAt is source evidence about this node's own local
	// finalization - never treated as an authoritative B2 timestamp.
	LocalFinalizedAt string `json:"local_finalized_at,omitempty"`
	B2ObjectKey      string `json:"b2_object_key,omitempty"`
	B2Bucket         string `json:"b2_bucket,omitempty"`
	// Gap facts are always sent explicitly for a finalization-bearing
	// state: an omitted gap count must never be readable as "no gaps".
	GapCount  int    `json:"gap_count"`
	GapStatus string `json:"gap_status"`
	// StrongIntegrityVerified stays false on every production path until an
	// isolated connectivity test proves a real byte-integrity mechanism.
	StrongIntegrityVerified bool `json:"strong_integrity_verified"`
	// CoveredPlaybackIDs is the distinct playback-identity provenance of
	// the finalized segment set, compared server-side against the event's
	// complete activation history before any Event-authoritative
	// transition.
	CoveredPlaybackIDs []string `json:"covered_playback_ids,omitempty"`
	FailureReason      string   `json:"failure_reason,omitempty"`
}

// RecordingReportResponse is the control plane's acknowledgement.
//
// FinalizationGeneration echoes the generation the control plane now holds
// as authoritative. When it differs from the generation the node just
// reported, the node's generation was not adopted - the reporter settles
// that report instead of retrying it forever.
type RecordingReportResponse struct {
	RecordingState         string `json:"recording_state"`
	FinalizationGeneration string `json:"finalization_generation"`
	EventAuthoritative     bool   `json:"event_authoritative"`
}

// RecordingReporterClient is the node-authenticated write side of the
// control plane. It is a separate interface from Client rather than an
// added method, so the existing assignment-sync mock and its tests are
// untouched and a component that only syncs assignments cannot
// accidentally gain the ability to report recording state.
type RecordingReporterClient interface {
	ReportRecordingState(ctx context.Context, nodeID, eventID string, report RecordingStateReport) (RecordingReportResponse, error)
}

// ReportRecordingState implements RecordingReporterClient.
//
// It reuses the exact authentication envelope FetchAssignments builds -
// the same rotatable node bearer credential, node id, per-request id,
// timestamp, and idempotency key - so the control plane applies one
// machine-auth scheme to both directions. The operator provisioning secret
// is never used here: this is node-originated, not operator-originated.
//
// Any non-200 is a failure and never mutates local state; the caller
// retries. That is safe because the control-plane transition is idempotent,
// so a lost response is indistinguishable from a lost request and both
// resolve correctly on retry.
func (c *HTTPClient) ReportRecordingState(ctx context.Context, nodeID, eventID string, report RecordingStateReport) (RecordingReportResponse, error) {
	url := strings.TrimSuffix(c.BaseURL, "/") + "/internal/media/nodes/" + nodeID + "/recordings/" + eventID

	payload, err := json.Marshal(report)
	if err != nil {
		return RecordingReportResponse{}, fmt.Errorf("controlplane: encode recording report: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return RecordingReportResponse{}, fmt.Errorf("controlplane: build recording report request: %w", err)
	}
	requestID, err := newRequestID()
	if err != nil {
		return RecordingReportResponse{}, fmt.Errorf("controlplane: generate request id: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.NodeToken.Reveal())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-EventCast-Node-Id", nodeID)
	req.Header.Set("X-EventCast-Request-Id", requestID)
	req.Header.Set("X-EventCast-Idempotency-Key", requestID)
	req.Header.Set("X-EventCast-Timestamp", time.Now().UTC().Format(time.RFC3339))

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return RecordingReportResponse{}, fmt.Errorf("controlplane: recording report request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return RecordingReportResponse{}, fmt.Errorf("controlplane: read recording report response: %w", err)
	}
	if len(body) > maxResponseBytes {
		return RecordingReportResponse{}, fmt.Errorf("controlplane: recording report response exceeded %d bytes", maxResponseBytes)
	}
	if resp.StatusCode != http.StatusOK {
		return RecordingReportResponse{}, fmt.Errorf("controlplane: recording report unexpected status %d", resp.StatusCode)
	}

	var parsed RecordingReportResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return RecordingReportResponse{}, fmt.Errorf("controlplane: parse recording report response: %w", err)
	}
	return parsed, nil
}

// TelemetryReport is the node's push payload for
// POST {base_url}/internal/media/nodes/{node_id}/telemetry
// (Livestream Technical Telemetry + Media Node Health Reporting).
//
// Node and Streams are EPHEMERAL/current-state: a failed or partially
// rejected report is never retried for these two fields, because the
// next scheduled report tick supersedes them anyway - there is no stale
// value worth redelivering.
//
// EndedSessions is DIFFERENT: each entry is a durable, one-time session
// summary (see internal/telemetry.SessionEndedTelemetry). A session must
// remain locally pending - and be resent on a later tick - until its
// session id appears in the response's AcceptedSessionIDs. The caller
// (internal/telemetry.Reporter) tracks this via the existing durable
// ingest_sessions row itself (a new telemetry_reported_at column, local
// SQLite migration 0006), never a separate queue: nothing here is lost
// to a network failure or a partial acceptance, and nothing here is
// ever marked delivered on the strength of "the HTTP call returned 200"
// alone - only on explicit per-session acknowledgement. Session-level
// deduplication on the control-plane side must be based on the durable
// session id itself (a future UNIQUE(session_id) + ON CONFLICT DO
// NOTHING there), never on this request's rotating idempotency key,
// since a retried session legitimately travels under a new request id
// each tick.
//
// The reporting node's identity is NOT a field here, for the same reason
// as RecordingStateReport: it is proven by the node authentication
// headers below and resolved server-side.
type TelemetryReport struct {
	Node          telemetry.NodeHeartbeat            `json:"node"`
	Streams       []telemetry.StreamTelemetry        `json:"streams,omitempty"`
	EndedSessions []telemetry.SessionEndedTelemetry  `json:"ended_sessions,omitempty"`
}

// TelemetryReportResponse is the control plane's acknowledgement.
//
// AcceptedSessionIDs is the authoritative acknowledgement for
// EndedSessions: the caller marks ONLY these session ids as durably
// reported (ingest_sessions.telemetry_reported_at). Any session id sent
// in the request but absent here - including every session id when the
// whole request fails - is left pending and resent on the next tick.
// A session id that was actually a duplicate retry of an already-durable
// row (control-plane ON CONFLICT DO NOTHING) MUST still appear here, so
// the caller stops resending it - "accepted" means "this session id is
// now durably present control-plane-side", not "this call just inserted
// it for the first time".
//
// AcceptedStreamEventIDs is informational only (Streams carries no retry
// state to update).
type TelemetryReportResponse struct {
	AcceptedStreamEventIDs []string `json:"accepted_stream_event_ids"`
	AcceptedSessionIDs     []string `json:"accepted_session_ids"`
}

// TelemetryReporterClient is the node-authenticated write side of the
// control plane for technical telemetry and node health reporting. A
// separate interface from Client and RecordingReporterClient, following
// the same pattern, so a component that only needs one capability cannot
// accidentally gain another.
type TelemetryReporterClient interface {
	ReportTelemetry(ctx context.Context, nodeID string, report TelemetryReport) (TelemetryReportResponse, error)
}

// ReportTelemetry implements TelemetryReporterClient. It reuses the exact
// authentication envelope FetchAssignments/ReportRecordingState build -
// same rotatable node bearer credential, node id, per-request id,
// timestamp, and idempotency key.
//
// A non-200 (or a network failure) returns an error and a zero-value
// TelemetryReportResponse (empty AcceptedSessionIDs) - the caller's own
// durable ingest_sessions state is what makes that safe: every
// EndedSessions entry from this call simply stays unreported and is
// retried on a later tick, exactly as if this call had never happened.
func (c *HTTPClient) ReportTelemetry(ctx context.Context, nodeID string, report TelemetryReport) (TelemetryReportResponse, error) {
	url := strings.TrimSuffix(c.BaseURL, "/") + "/internal/media/nodes/" + nodeID + "/telemetry"

	payload, err := json.Marshal(report)
	if err != nil {
		return TelemetryReportResponse{}, fmt.Errorf("controlplane: encode telemetry report: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return TelemetryReportResponse{}, fmt.Errorf("controlplane: build telemetry report request: %w", err)
	}
	requestID, err := newRequestID()
	if err != nil {
		return TelemetryReportResponse{}, fmt.Errorf("controlplane: generate request id: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.NodeToken.Reveal())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-EventCast-Node-Id", nodeID)
	req.Header.Set("X-EventCast-Request-Id", requestID)
	req.Header.Set("X-EventCast-Idempotency-Key", requestID)
	req.Header.Set("X-EventCast-Timestamp", time.Now().UTC().Format(time.RFC3339))

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return TelemetryReportResponse{}, fmt.Errorf("controlplane: telemetry report request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return TelemetryReportResponse{}, fmt.Errorf("controlplane: read telemetry report response: %w", err)
	}
	if len(body) > maxResponseBytes {
		return TelemetryReportResponse{}, fmt.Errorf("controlplane: telemetry report response exceeded %d bytes", maxResponseBytes)
	}
	if resp.StatusCode != http.StatusOK {
		return TelemetryReportResponse{}, fmt.Errorf("controlplane: telemetry report unexpected status %d", resp.StatusCode)
	}

	var parsed TelemetryReportResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return TelemetryReportResponse{}, fmt.Errorf("controlplane: parse telemetry report response: %w", err)
	}
	return parsed, nil
}

// newRequestID returns a random 128-bit hex-encoded identifier, used as
// both the request id and (for this read-only GET) the idempotency key.
func newRequestID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
