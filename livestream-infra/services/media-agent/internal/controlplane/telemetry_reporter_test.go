package controlplane

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/telemetry"
)

// fakeTelemetryClient is a scriptable TelemetryReporterClient. Each call
// to ReportTelemetry records the request and consumes the next queued
// response/error pair (or repeats the last one if the queue is
// exhausted), so a test can assert exactly what was sent and control
// exactly what the "control plane" answers on each tick.
type fakeTelemetryClient struct {
	requests  []TelemetryReport
	responses []TelemetryReportResponse
	errs      []error
	calls     int
}

func (f *fakeTelemetryClient) ReportTelemetry(_ context.Context, _ string, report TelemetryReport) (TelemetryReportResponse, error) {
	f.requests = append(f.requests, report)
	i := f.calls
	f.calls++
	if i < len(f.errs) && f.errs[i] != nil {
		return TelemetryReportResponse{}, f.errs[i]
	}
	if i < len(f.responses) {
		return f.responses[i], nil
	}
	return TelemetryReportResponse{}, nil
}

func newSRSServer(t *testing.T, body string) *telemetry.SRSClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return telemetry.NewSRSClient(srv.URL, srv.Client())
}

func newUnreachableSRSClient() *telemetry.SRSClient {
	// A closed server: connections to it fail immediately, simulating an
	// unreachable SRS API without needing a real network timeout.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close()
	return telemetry.NewSRSClient(srv.URL, &http.Client{Timeout: time.Second})
}

func TestTelemetryReporterReportsActiveSessionWithSRSData(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()

	sess, err := st.CreateSession(ctx, "evt-1", "ingest-1", "pb-1", now.Add(-30*time.Second))
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	job, owned, err := st.ClaimSegment(ctx, store.ClaimSegmentInput{
		IdempotencyKey: "evt-1|" + sess.ID + "|0-seg.ts", EventID: "evt-1", SessionID: sess.ID,
		LocalFileIdentity: "0-seg.ts", SeqNo: 0, DurationSeconds: 4,
	})
	if err != nil || !owned {
		t.Fatalf("ClaimSegment() owned=%v error=%v", owned, err)
	}
	if err := st.FinalizeSegment(ctx, job.ID, "/spool/evt-1/"+sess.ID+"/0-seg.ts", 50000, "deadbeef", now); err != nil {
		t.Fatalf("FinalizeSegment() error: %v", err)
	}

	srsBody := `{"code":0,"streams":[{"name":"ingest-1","publish":{"active":true},"kbps":{"recv_30s":298,"send_30s":0},"recv_bytes":1820224,"video":{"codec":"H264","width":320,"height":240},"audio":{"codec":"AAC"}}]}`
	srsClient := newSRSServer(t, srsBody)

	fake := &fakeTelemetryClient{}
	reporter := NewTelemetryReporter(st, srsClient, fake, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter.RunOnce(ctx)

	if len(fake.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(fake.requests))
	}
	req := fake.requests[0]

	if req.Node.ActiveStreamCount == nil || *req.Node.ActiveStreamCount != 1 {
		t.Errorf("Node.ActiveStreamCount = %v, want 1", req.Node.ActiveStreamCount)
	}
	if req.Node.SoftwareVersion == "" {
		t.Error("Node.SoftwareVersion is empty, want the build version")
	}
	if req.Node.ConfigVersion != nil {
		t.Error("Node.ConfigVersion != nil, want nil (no authoritative source)")
	}

	if len(req.Streams) != 1 {
		t.Fatalf("Streams = %d, want 1", len(req.Streams))
	}
	stream := req.Streams[0]
	if stream.EventID != "evt-1" {
		t.Errorf("EventID = %q, want evt-1", stream.EventID)
	}
	if !stream.Connected {
		t.Error("Connected = false, want true")
	}
	if stream.SRSPublishActive == nil || !*stream.SRSPublishActive {
		t.Error("SRSPublishActive not true")
	}
	if stream.VideoCodec == nil || *stream.VideoCodec != "H264" {
		t.Errorf("VideoCodec = %v, want H264", stream.VideoCodec)
	}
	if stream.IngestKbpsRecv30s == nil || *stream.IngestKbpsRecv30s != 298 {
		t.Errorf("IngestKbpsRecv30s = %v, want 298", stream.IngestKbpsRecv30s)
	}
	if stream.CapturedSegmentBitrateKbps == nil {
		t.Error("CapturedSegmentBitrateKbps = nil, want a derived value")
	}
	if stream.SessionCount == nil || *stream.SessionCount != 1 {
		t.Errorf("SessionCount = %v, want 1", stream.SessionCount)
	}
}

// A completely unreachable SRS API must never block or fail the report -
// the node's own durable facts (Connected, duration, session count) are
// still sent, with SRS-sourced fields correctly nil rather than the
// whole report being dropped.
func TestTelemetryReporterNonFatalOnSRSFailure(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()

	if _, err := st.CreateSession(ctx, "evt-1", "ingest-1", "pb-1", now); err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	fake := &fakeTelemetryClient{}
	reporter := NewTelemetryReporter(st, newUnreachableSRSClient(), fake, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter.RunOnce(ctx)

	if len(fake.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(fake.requests))
	}
	if len(fake.requests[0].Streams) != 1 {
		t.Fatalf("Streams = %d, want 1 (own-store facts must still be reported)", len(fake.requests[0].Streams))
	}
	stream := fake.requests[0].Streams[0]
	if !stream.Connected {
		t.Error("Connected = false, want true even when SRS is unreachable")
	}
	if stream.SRSPublishActive != nil || stream.VideoCodec != nil || stream.IngestKbpsRecv30s != nil {
		t.Error("SRS-sourced fields are non-nil despite SRS being unreachable")
	}
}

// A closed store makes every query fail, simulating a durable-state
// failure. ActiveStreamCount must be nil (unmeasured), not a fabricated
// 0 that would falsely claim "no active streams".
func TestTelemetryReporterOmitsActiveStreamCountOnStoreFailure(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if err := st.Close(); err != nil {
		t.Fatalf("Close() error: %v", err)
	}

	fake := &fakeTelemetryClient{}
	reporter := NewTelemetryReporter(st, newSRSServer(t, `{"code":0,"streams":[]}`), fake, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter.RunOnce(ctx)

	if len(fake.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(fake.requests))
	}
	if fake.requests[0].Node.ActiveStreamCount != nil {
		t.Errorf("ActiveStreamCount = %v, want nil after a store failure", fake.requests[0].Node.ActiveStreamCount)
	}
}

// The core retry-until-acknowledged property: an ended session must stay
// pending (and be resent) across any tick that fails, errors, or simply
// does not acknowledge it - and must be marked reported only once its
// exact session id is explicitly acknowledged.
func TestTelemetryReporterRetriesEndedSessionUntilAcknowledged(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()

	sess, err := st.CreateSession(ctx, "evt-1", "ingest-1", "pb-1", now.Add(-time.Minute))
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	if err := st.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, now); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	srsClient := newSRSServer(t, `{"code":0,"streams":[]}`)

	// Tick 1: the control plane call itself fails outright.
	fake := &fakeTelemetryClient{errs: []error{errors.New("network error")}}
	reporter := NewTelemetryReporter(st, srsClient, fake, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter.RunOnce(ctx)

	unreported, err := st.ListUnreportedEndedSessions(ctx, 32)
	if err != nil {
		t.Fatalf("ListUnreportedEndedSessions() error: %v", err)
	}
	if len(unreported) != 1 {
		t.Fatalf("unreported after failed call = %d, want 1 (still pending)", len(unreported))
	}

	// Tick 2: the call succeeds but acknowledges nothing.
	fake2 := &fakeTelemetryClient{responses: []TelemetryReportResponse{{}}}
	reporter2 := NewTelemetryReporter(st, srsClient, fake2, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter2.RunOnce(ctx)

	unreported, err = st.ListUnreportedEndedSessions(ctx, 32)
	if err != nil {
		t.Fatalf("ListUnreportedEndedSessions() error: %v", err)
	}
	if len(unreported) != 1 {
		t.Fatalf("unreported after unacknowledged success = %d, want 1 (still pending)", len(unreported))
	}
	if len(fake2.requests[0].EndedSessions) != 1 || fake2.requests[0].EndedSessions[0].SessionID != sess.ID {
		t.Fatalf("tick 2 did not resend the still-pending session")
	}

	// Tick 3: the control plane finally acknowledges this exact session id.
	fake3 := &fakeTelemetryClient{responses: []TelemetryReportResponse{{AcceptedSessionIDs: []string{sess.ID}}}}
	reporter3 := NewTelemetryReporter(st, srsClient, fake3, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter3.RunOnce(ctx)

	unreported, err = st.ListUnreportedEndedSessions(ctx, 32)
	if err != nil {
		t.Fatalf("ListUnreportedEndedSessions() error: %v", err)
	}
	if len(unreported) != 0 {
		t.Fatalf("unreported after acknowledgement = %d, want 0", len(unreported))
	}

	// Tick 4: nothing left to send.
	fake4 := &fakeTelemetryClient{}
	reporter4 := NewTelemetryReporter(st, srsClient, fake4, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter4.RunOnce(ctx)
	if len(fake4.requests[0].EndedSessions) != 0 {
		t.Error("an already-acknowledged session was resent")
	}
}

// The sent-set guard: an acknowledgement for a session id this request
// never sent must never mark anything reported - including the genuine
// pending session, which must remain unreported and eligible for retry.
func TestTelemetryReporterIgnoresAcknowledgementForUnsentSessionID(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()

	sess, err := st.CreateSession(ctx, "evt-1", "ingest-1", "pb-1", now.Add(-time.Minute))
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	if err := st.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, now); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	// The response "acknowledges" a session id that was never part of
	// this (or any) request - a foreign/spoofed/buggy id.
	fake := &fakeTelemetryClient{responses: []TelemetryReportResponse{{AcceptedSessionIDs: []string{"sess_never_sent"}}}}
	reporter := NewTelemetryReporter(st, newSRSServer(t, `{"code":0,"streams":[]}`), fake, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter.RunOnce(ctx)

	unreported, err := st.ListUnreportedEndedSessions(ctx, 32)
	if err != nil {
		t.Fatalf("ListUnreportedEndedSessions() error: %v", err)
	}
	if len(unreported) != 1 {
		t.Fatalf("unreported = %d, want 1 (the real session must remain pending)", len(unreported))
	}
	if unreported[0].ID != sess.ID {
		t.Errorf("unreported session id = %q, want %q", unreported[0].ID, sess.ID)
	}
}

// An idle node (no active or recently-ended sessions) must still report
// a heartbeat - last_heartbeat_at needs to keep advancing regardless of
// stream activity.
func TestTelemetryReporterReportsHeartbeatWithNoSessions(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	fake := &fakeTelemetryClient{}
	reporter := NewTelemetryReporter(st, newSRSServer(t, `{"code":0,"streams":[]}`), fake, TelemetryReporterConfig{NodeID: "node-a", SpoolRoot: t.TempDir()}, testLogger(t))
	reporter.RunOnce(ctx)

	if len(fake.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(fake.requests))
	}
	if fake.requests[0].Node.ActiveStreamCount == nil || *fake.requests[0].Node.ActiveStreamCount != 0 {
		t.Errorf("ActiveStreamCount = %v, want a measured 0", fake.requests[0].Node.ActiveStreamCount)
	}
	if len(fake.requests[0].Streams) != 0 {
		t.Error("Streams non-empty with no active sessions")
	}
}
