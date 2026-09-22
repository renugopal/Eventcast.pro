package controlplane

import (
	"context"
	"log/slog"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/health"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/metrics"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/telemetry"
)

// telemetryEndedSessionBatchSize bounds how many durable session
// summaries one report tick will attempt to deliver, mirroring
// RecordingReporter's reportBatchSize - a large backlog (e.g. after
// extended control-plane downtime) drains steadily rather than in one
// oversized request.
const telemetryEndedSessionBatchSize = 32

// TelemetryReporterConfig configures TelemetryReporter.
type TelemetryReporterConfig struct {
	NodeID string
	// SpoolRoot is used only to compute DiskFreeBytes for the node
	// heartbeat (internal/metrics.DiskFreeBytes) - this package never
	// reads or writes spool content itself.
	SpoolRoot string
}

// TelemetryReporter is the Media Agent side of Livestream Technical
// Telemetry + Media Node Health Reporting: it samples the SRS HTTP API
// for every currently active session, combines that with this node's own
// durable session/segment state, and pushes the result plus a node
// heartbeat to the control plane on a fixed interval.
//
// It is a separate loop from every ingest-path component on purpose
// (mirrors RecordingReporter): a slow or unreachable SRS API or control
// plane must never delay on_publish/on_hls/on_unpublish handling, upload,
// manifest generation, B2 archival, or YouTube relay. Every failure here
// is caught and logged, never propagated - this is why RunOnce below
// returns nothing and cannot itself fail the caller.
//
// Every measured fact this reporter cannot actually obtain on a given
// tick (a failed store query, a failed SRS sample, a failed disk-stat
// call) is sent as nil/omitted, never as a fabricated zero or fallback
// value - the same unavailable-with-reason discipline the control plane
// itself already applies at the projection layer.
type TelemetryReporter struct {
	store     *store.Store
	srsClient *telemetry.SRSClient
	cpClient  TelemetryReporterClient
	cfg       TelemetryReporterConfig
	logger    *slog.Logger
	now       func() time.Time
}

// NewTelemetryReporter returns a TelemetryReporter. logger must not be
// nil.
func NewTelemetryReporter(st *store.Store, srsClient *telemetry.SRSClient, cpClient TelemetryReporterClient, cfg TelemetryReporterConfig, logger *slog.Logger) *TelemetryReporter {
	return &TelemetryReporter{store: st, srsClient: srsClient, cpClient: cpClient, cfg: cfg, logger: logger, now: time.Now}
}

// Run performs an immediate pass and then one every interval until ctx is
// cancelled.
func (r *TelemetryReporter) Run(ctx context.Context, interval time.Duration) {
	r.RunOnce(ctx)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.RunOnce(ctx)
		}
	}
}

// RunOnce builds and pushes one telemetry report. It never returns an
// error: every failure (SRS unreachable, store query failure, control
// plane unreachable) is logged and the pass simply produces a smaller,
// more-unavailable, or empty report rather than blocking or panicking.
func (r *TelemetryReporter) RunOnce(ctx context.Context) {
	now := r.now().UTC()

	// activeSessionsOK is tracked separately from len(activeSessions): a
	// failed query and a genuine "zero active sessions" fact must never
	// be conflated (see NodeHeartbeat.ActiveStreamCount's doc).
	activeSessions, activeSessionsErr := r.store.ListActiveSessions(ctx)
	activeSessionsOK := activeSessionsErr == nil
	if !activeSessionsOK {
		r.logger.Error("telemetry reporter: list active sessions failed", slog.String("error", activeSessionsErr.Error()))
		activeSessions = nil
	}

	// SRS is sampled at most once per tick, and only when the
	// active-session query itself succeeded and found at least one
	// session. When ListActiveSessions fails, sampling is skipped
	// entirely - not because sessions are assumed to be zero, but
	// because there are no authoritative session ingest ids to match a
	// sample against; that is a different, deliberate reason from the
	// ordinary case of a successful query that simply found none.
	var srsStreams []telemetry.SRSStream
	if activeSessionsOK && len(activeSessions) > 0 {
		var srsErr error
		srsStreams, srsErr = r.srsClient.FetchStreams(ctx)
		if srsErr != nil {
			// Non-fatal: every StreamTelemetry entry below still reports
			// this node's own durable facts (Connected, duration,
			// freshness) with every SRS-sourced field correctly left
			// nil, never fabricated.
			r.logger.Warn("telemetry reporter: SRS streams sample failed; reporting session facts without SRS fields",
				slog.String("error", srsErr.Error()))
			srsStreams = nil
		}
	}

	streams := make([]telemetry.StreamTelemetry, 0, len(activeSessions))
	for _, sess := range activeSessions {
		capturedBytesRaw, err := r.store.SessionCapturedBytes(ctx, sess.ID)
		var capturedBytes *int64
		if err != nil {
			r.logger.Error("telemetry reporter: session captured bytes failed",
				slog.String("session_id", sess.ID), slog.String("error", err.Error()))
		} else {
			capturedBytes = &capturedBytesRaw
		}

		sessionCountRaw, err := r.store.SessionCountForEvent(ctx, sess.EventID)
		var sessionCount *int
		if err != nil {
			r.logger.Error("telemetry reporter: session count failed",
				slog.String("event_id", sess.EventID), slog.String("error", err.Error()))
		} else {
			sessionCount = &sessionCountRaw
		}

		var matched *telemetry.SRSStream
		if s, found := telemetry.FindByName(srsStreams, sess.IngestID); found {
			matched = &s
		}

		streams = append(streams, telemetry.BuildStreamTelemetry(
			sess.EventID, sess.StartedAt, sess.LastActivityAt, sessionCount, capturedBytes, matched, now,
		))
	}

	diskFreeRaw, _, diskErr := metrics.DiskFreeBytes(r.cfg.SpoolRoot)
	var diskFree *int64
	if diskErr != nil {
		r.logger.Warn("telemetry reporter: disk free bytes unavailable", slog.String("error", diskErr.Error()))
	} else {
		v := int64(diskFreeRaw)
		diskFree = &v
	}

	backlogRaw, backlogErr := r.store.PendingUploadBacklogBytes(ctx)
	var backlogBytes *int64
	if backlogErr != nil {
		r.logger.Error("telemetry reporter: pending upload backlog bytes failed", slog.String("error", backlogErr.Error()))
	} else {
		backlogBytes = &backlogRaw
	}

	var activeStreamCount *int
	if activeSessionsOK {
		n := len(activeSessions)
		activeStreamCount = &n
	}

	heartbeat := telemetry.NodeHeartbeat{
		DiskFreeBytes:   diskFree,
		R2QueueBytes:    backlogBytes,
		SoftwareVersion: health.Version,
		// ConfigVersion stays nil: no authoritative source exists yet.
		ActiveStreamCount: activeStreamCount,
	}

	unreported, err := r.store.ListUnreportedEndedSessions(ctx, telemetryEndedSessionBatchSize)
	if err != nil {
		r.logger.Error("telemetry reporter: list unreported ended sessions failed", slog.String("error", err.Error()))
		unreported = nil
	}
	ended := make([]telemetry.SessionEndedTelemetry, 0, len(unreported))
	for _, sess := range unreported {
		if !sess.DisconnectedAt.Valid {
			continue
		}
		ended = append(ended, telemetry.SessionEndedTelemetry{
			EventID:         sess.EventID,
			SessionID:       sess.ID,
			StartedAt:       sess.StartedAt,
			DisconnectedAt:  sess.DisconnectedAt.Time,
			EndReason:       sess.EndReason,
			SegmentCount:    sess.SegmentCount,
			DurationSeconds: sess.DisconnectedAt.Time.Sub(sess.StartedAt).Seconds(),
		})
	}

	// Track exactly which ended-session ids THIS request actually sent,
	// so an unexpected id the control plane echoes back (a bug, a
	// cross-node response, or any other anomaly) can never mark an
	// unrelated local session as reported.
	sentSessionIDs := make(map[string]bool, len(ended))
	for _, e := range ended {
		sentSessionIDs[e.SessionID] = true
	}

	resp, err := r.cpClient.ReportTelemetry(ctx, r.cfg.NodeID, TelemetryReport{
		Node:          heartbeat,
		Streams:       streams,
		EndedSessions: ended,
	})
	if err != nil {
		// Streams/Node are simply superseded by the next tick.
		// EndedSessions are untouched here - nothing is marked reported,
		// so every entry in `ended` above is retried on the next tick,
		// exactly as if this call had never happened.
		r.logger.Warn("telemetry report failed; will retry ephemeral facts next tick and durable session summaries until acknowledged",
			slog.String("error", err.Error()))
		return
	}

	for _, id := range resp.AcceptedSessionIDs {
		if !sentSessionIDs[id] {
			r.logger.Warn("telemetry reporter: ignoring acknowledgement for a session id this request never sent",
				slog.String("session_id", id))
			continue
		}
		if markErr := r.store.MarkSessionTelemetryReported(ctx, id, now); markErr != nil {
			r.logger.Error("telemetry reporter: mark session reported failed",
				slog.String("session_id", id), slog.String("error", markErr.Error()))
		}
	}
}
