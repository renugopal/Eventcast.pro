// Package srs implements the Media Agent's HTTP callback handlers for
// SRS (on_publish, on_hls, on_unpublish). on_publish authorizes the
// publisher against the durable local assignment cache and creates a
// stream session; on_hls durably captures the completed segment into
// the protected spool and records an idempotent queue entry;
// on_unpublish closes the session. See 02_V1_ARCHITECTURE_SPEC.md "SRS
// callback handling" and 03_DATA_MODEL_AND_API_CONTRACTS.md "SRS
// callback contracts".
package srs

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/relay"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/spool"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// rtmpApp is the fixed RTMP application name every publisher uses
// (rtmp://host/live/<ingest_id>?token=<secret>), matching the pinned
// srs.conf and every existing integration test script's STREAM_APP
// convention. It is also the app name the YouTube relay pulls the same
// session back from, on this node's own SRS instance.
const rtmpApp = "live"

// MaxCallbackBodyBytes bounds the size of an accepted SRS callback
// request body. SRS callback payloads are small JSON objects; this is a
// generous ceiling against a misbehaving or malicious sender, not a
// tuned limit.
const MaxCallbackBodyBytes = 1 << 20 // 1 MiB

// segmentClaimPollInterval and segmentClaimPollTimeout bound how long a
// duplicate on_hls callback waits for the original, concurrently
// in-flight capture to finish, rather than racing it.
const (
	segmentClaimPollInterval = 50 * time.Millisecond
	segmentClaimPollTimeout  = 3 * time.Second
)

// Payload is the subset of the SRS HTTP callback JSON body this handler
// reads. SRS posts the same envelope shape to on_publish, on_hls, and
// on_unpublish, with the fields relevant to each action populated and
// the rest left zero-valued (03_DATA_MODEL_AND_API_CONTRACTS.md "SRS
// callback contracts"). Param carries the RTMP publish query string,
// which may include a secret stream token, so it is decoded but
// deliberately never logged.
type Payload struct {
	Action   string  `json:"action"`
	ClientID string  `json:"client_id"`
	IP       string  `json:"ip"`
	Vhost    string  `json:"vhost"`
	App      string  `json:"app"`
	Stream   string  `json:"stream"`
	Param    string  `json:"param"`
	File     string  `json:"file"`
	URL      string  `json:"url"`
	M3U8     string  `json:"m3u8"`
	Duration float64 `json:"duration"`
	SeqNo    int     `json:"seq_no"`
}

// successResponse is the SRS-compatible success body every accepted
// callback returns.
type successResponse struct {
	Code int `json:"code"`
}

// rejectResponse is the SRS-compatible rejection body: a non-zero code
// tells SRS to refuse the publish/segment. ErrorCode is one of the
// stable machine-readable categories in
// 03_DATA_MODEL_AND_API_CONTRACTS.md "Error model"; it never echoes
// request content, so it cannot leak a stream token even if a future
// field became sensitive.
type rejectResponse struct {
	Code      int    `json:"code"`
	ErrorCode string `json:"error"`
}

// errorResponse is returned for malformed requests (bad method, bad
// JSON, missing required fields) - a transport-level problem, distinct
// from a well-formed callback that business logic rejects.
type errorResponse struct {
	Error string `json:"error"`
}

// Handlers holds the dependencies every SRS callback handler needs:
// the durable store (assignment cache, sessions, segment queue) and the
// filesystem roots durable capture validates against.
type Handlers struct {
	Store     *store.Store
	HLSRoot   string
	SpoolRoot string
	Logger    *slog.Logger

	// Relay is optional: nil disables YouTube relay entirely regardless
	// of any assignment's YouTubeEnabled flag, matching every other
	// not-yet-configured optional subsystem in this service.
	Relay                    *relay.Supervisor
	YouTubeSourceRTMPBaseURL string
	// YouTubeStreamKeys resolves an event id to its raw YouTube stream
	// key, built once at startup directly from the parsed assignment
	// seed file (internal/store.Assignment.YouTubeStreamKey is
	// deliberately never persisted to or read back from SQLite - see
	// migrations/0002_media_delivery.sql). A nil or missing entry is
	// treated as "no key available," which Target.destinationURL turns
	// into a non-functional (but harmless) destination rather than a
	// panic.
	YouTubeStreamKeys map[string]logging.Secret
}

// handler adapts one named callback action to net/http, sharing request
// parsing/validation and dispatching to the matching business-logic
// method on Handlers.
type handler struct {
	name    string
	deps    *Handlers
	execute func(deps *Handlers, ctx context.Context, p Payload) (rejected bool, errorCode string)
}

// OnPublish returns the http.Handler for POST /internal/srs/on-publish.
func (h *Handlers) OnPublish() http.Handler {
	return &handler{name: "on_publish", deps: h, execute: (*Handlers).handlePublish}
}

// OnHLS returns the http.Handler for POST /internal/srs/on-hls.
func (h *Handlers) OnHLS() http.Handler {
	return &handler{name: "on_hls", deps: h, execute: (*Handlers).handleHLS}
}

// OnUnpublish returns the http.Handler for POST /internal/srs/on-unpublish.
func (h *Handlers) OnUnpublish() http.Handler {
	return &handler{name: "on_unpublish", deps: h, execute: (*Handlers).handleUnpublish}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxCallbackBodyBytes)

	var payload Payload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body exceeds maximum size")
			return
		}
		writeError(w, http.StatusBadRequest, "malformed JSON body")
		return
	}

	// The minimum fields required to identify the callback and the
	// stream it concerns; everything else is optional per action.
	if payload.Action == "" || payload.Stream == "" {
		writeError(w, http.StatusBadRequest, "missing required field: action and stream must be non-empty")
		return
	}

	h.deps.Logger.Info("srs callback received",
		slog.String("callback", h.name),
		slog.String("action", payload.Action),
		slog.String("vhost", payload.Vhost),
		slog.String("app", payload.App),
		slog.String("stream", payload.Stream),
		slog.String("client_id", payload.ClientID),
		slog.Bool("param_present", payload.Param != ""),
	)

	rejected, errorCode := h.execute(h.deps, r.Context(), payload)
	if rejected {
		writeReject(w, errorCode)
		return
	}
	writeSuccess(w)
}

// handlePublish authorizes the publisher against the durable local
// assignment cache and, if valid, creates a new stream session.
func (h *Handlers) handlePublish(ctx context.Context, p Payload) (bool, string) {
	ingestID := p.Stream
	token := extractToken(p.Param)
	now := time.Now().UTC()

	assignment, found, err := h.Store.GetAssignment(ctx, ingestID)
	if err != nil {
		h.Logger.Error("on_publish: assignment lookup failed", slog.String("stream", ingestID), slog.String("error", err.Error()))
		return true, "ASSIGNMENT_MISMATCH"
	}
	if !found {
		h.Logger.Warn("on_publish rejected: no cached assignment for this ingest id", slog.String("stream", ingestID))
		return true, "ASSIGNMENT_MISMATCH"
	}
	if !assignment.Enabled {
		h.Logger.Warn("on_publish rejected: assignment disabled",
			slog.String("stream", ingestID), slog.String("event_id", assignment.EventID))
		return true, "AUTH_INVALID"
	}
	if token == "" || !assignment.VerifyToken(token) {
		h.Logger.Warn("on_publish rejected: invalid credential",
			slog.String("stream", ingestID), slog.String("event_id", assignment.EventID))
		return true, "AUTH_INVALID"
	}
	if now.Before(assignment.PublishWindowStartAt) || now.After(assignment.PublishWindowEndAt) {
		h.Logger.Warn("on_publish rejected: outside publish window",
			slog.String("stream", ingestID), slog.String("event_id", assignment.EventID))
		return true, "PUBLISH_WINDOW_CLOSED"
	}

	session, err := h.Store.CreateSession(ctx, assignment.EventID, ingestID, now)
	if err != nil {
		if errors.Is(err, store.ErrConflictingActivePublisher) {
			h.Logger.Warn("on_publish rejected: a publisher is already active for this event",
				slog.String("stream", ingestID), slog.String("event_id", assignment.EventID))
			return true, "DUPLICATE_PUBLISHER"
		}
		h.Logger.Error("on_publish: create session failed",
			slog.String("stream", ingestID), slog.String("error", err.Error()))
		return true, "STATE_CONFLICT"
	}

	h.Logger.Info("on_publish accepted",
		slog.String("stream", ingestID),
		slog.String("event_id", assignment.EventID),
		slog.String("playback_id", assignment.PlaybackID),
		slog.String("session_id", session.ID),
	)

	h.maybeStartRelay(assignment, session, ingestID)
	return false, ""
}

// maybeStartRelay starts YouTube relay for the new session if both this
// Media Agent has relay supervision configured and the assignment
// authorizes it. Per ADR-012, a relay start failure is logged and
// otherwise ignored: it must never affect the on_publish accept
// decision, which has already been made by the time this runs. It uses
// context.Background(), not the callback's request context, since the
// relay supervisor's goroutine must outlive this HTTP request.
func (h *Handlers) maybeStartRelay(assignment store.Assignment, session store.Session, ingestID string) {
	if h.Relay == nil || !assignment.YouTubeEnabled {
		return
	}
	target := relay.Target{
		EventID:            assignment.EventID,
		SessionID:          session.ID,
		SourceURL:          strings.TrimSuffix(h.YouTubeSourceRTMPBaseURL, "/") + "/" + rtmpApp + "/" + ingestID,
		DestinationBaseURL: assignment.YouTubeDestinationBaseURL,
		StreamKey:          h.YouTubeStreamKeys[assignment.EventID],
	}
	if err := h.Relay.Start(context.Background(), target); err != nil {
		h.Logger.Error("on_publish: failed to start youtube relay",
			slog.String("event_id", assignment.EventID), slog.String("session_id", session.ID), slog.String("error", err.Error()))
	}
}

// handleHLS validates the callback's file path against the configured
// SRS HLS root, then durably captures the segment into the protected
// spool and records an idempotent queue entry before returning success.
// Duplicate callbacks for the same segment - including ones that arrive
// concurrently with the original - are resolved without creating a
// second spool file or queue row.
func (h *Handlers) handleHLS(ctx context.Context, p Payload) (bool, string) {
	ingestID := p.Stream

	session, found, err := h.Store.FindMostRecentByIngestID(ctx, ingestID)
	if err != nil {
		h.Logger.Error("on_hls: session lookup failed", slog.String("stream", ingestID), slog.String("error", err.Error()))
		return true, "STATE_CONFLICT"
	}
	if !found {
		h.Logger.Warn("on_hls rejected: no session on record for this stream", slog.String("stream", ingestID))
		return true, "STATE_CONFLICT"
	}

	localFileIdentity := spool.SegmentFileName(int64(p.SeqNo), filepath.Base(p.File))
	idempotencyKey := session.EventID + "|" + session.ID + "|" + localFileIdentity

	job, owned, err := h.Store.ClaimSegment(ctx, store.ClaimSegmentInput{
		IdempotencyKey:    idempotencyKey,
		EventID:           session.EventID,
		SessionID:         session.ID,
		LocalFileIdentity: localFileIdentity,
		SeqNo:             int64(p.SeqNo),
		DurationSeconds:   p.Duration,
	})
	if err != nil {
		h.Logger.Error("on_hls: claim segment failed", slog.String("stream", ingestID), slog.String("error", err.Error()))
		return true, "SPOOL_FILE_UNSTABLE"
	}

	if !owned {
		h.Logger.Info("on_hls duplicate callback observed; waiting for the original capture to finish",
			slog.String("stream", ingestID), slog.String("event_id", session.EventID), slog.Int("seq_no", p.SeqNo))
		final := h.waitForSegmentResult(ctx, job.ID)
		if final.Status != store.SegmentQueued {
			return true, "SPOOL_FILE_MISSING"
		}
		h.Logger.Info("on_hls duplicate callback resolved idempotently, no new spool file or queue row created",
			slog.String("stream", ingestID), slog.String("event_id", session.EventID), slog.Int("seq_no", p.SeqNo))
		return false, ""
	}

	result, captureErr := spool.Capture(ctx, spool.CaptureInput{
		HLSRoot:    h.HLSRoot,
		SpoolRoot:  h.SpoolRoot,
		SourceFile: p.File,
		EventID:    session.EventID,
		SessionID:  session.ID,
		SeqNo:      int64(p.SeqNo),
	})
	now := time.Now().UTC()
	if captureErr != nil {
		h.Logger.Error("on_hls: durable capture failed",
			slog.String("stream", ingestID), slog.String("event_id", session.EventID), slog.String("error", captureErr.Error()))
		if err := h.Store.FailSegment(ctx, job.ID, captureErr.Error(), now); err != nil {
			h.Logger.Error("on_hls: failed to record capture failure", slog.String("error", err.Error()))
		}
		errorCode := "SPOOL_FILE_UNSTABLE"
		if errors.Is(captureErr, spool.ErrSourceMissing) {
			errorCode = "SPOOL_FILE_MISSING"
		}
		return true, errorCode
	}

	if err := h.Store.FinalizeSegment(ctx, job.ID, result.SpoolPath, result.ByteSize, result.SHA256, now); err != nil {
		h.Logger.Error("on_hls: finalize segment record failed", slog.String("error", err.Error()))
		return true, "STATE_CONFLICT"
	}
	if err := h.Store.TouchActivity(ctx, session.ID, now); err != nil {
		h.Logger.Error("on_hls: touch session activity failed", slog.String("error", err.Error()))
	}

	h.Logger.Info("segment captured",
		slog.String("stream", ingestID),
		slog.String("event_id", session.EventID),
		slog.String("session_id", session.ID),
		slog.Int("seq_no", p.SeqNo),
		slog.Int64("byte_size", result.ByteSize),
	)
	return false, ""
}

// waitForSegmentResult polls a segment job a duplicate callback did not
// win the claim for, until its owner finalizes or fails it or a bounded
// timeout elapses.
func (h *Handlers) waitForSegmentResult(ctx context.Context, id int64) store.SegmentJob {
	deadline := time.Now().Add(segmentClaimPollTimeout)
	for {
		job, err := h.Store.GetSegmentByID(ctx, id)
		if err != nil {
			h.Logger.Error("on_hls: poll segment result failed", slog.String("error", err.Error()))
			return store.SegmentJob{}
		}
		if job.Status != store.SegmentCapturing {
			return job
		}
		if time.Now().After(deadline) {
			return job
		}
		select {
		case <-ctx.Done():
			return store.SegmentJob{}
		case <-time.After(segmentClaimPollInterval):
		}
	}
}

// handleUnpublish closes the current session, if any. An unknown or
// already-closed stream is treated as a no-op success: on_unpublish
// must be idempotent and safe against a late or duplicate delivery, and
// per 02_V1_ARCHITECTURE_SPEC.md it never finalizes the event or
// deletes files.
func (h *Handlers) handleUnpublish(ctx context.Context, p Payload) (bool, string) {
	ingestID := p.Stream

	session, found, err := h.Store.FindMostRecentByIngestID(ctx, ingestID)
	if err != nil {
		h.Logger.Error("on_unpublish: session lookup failed", slog.String("stream", ingestID), slog.String("error", err.Error()))
		return true, "STATE_CONFLICT"
	}
	if !found {
		h.Logger.Info("on_unpublish observed for a stream with no session on record; treating as a no-op",
			slog.String("stream", ingestID))
		return false, ""
	}

	now := time.Now().UTC()
	if err := h.Store.MarkDisconnected(ctx, session.ID, store.EndReasonUnpublish, now); err != nil {
		h.Logger.Error("on_unpublish: mark disconnected failed", slog.String("stream", ingestID), slog.String("error", err.Error()))
		return true, "STATE_CONFLICT"
	}

	h.Logger.Info("on_unpublish closed session",
		slog.String("stream", ingestID),
		slog.String("event_id", session.EventID),
		slog.String("session_id", session.ID),
		slog.String("session_status", "disconnected"),
	)

	if h.Relay != nil {
		h.Relay.Stop(session.ID)
	}
	return false, ""
}

// extractToken reads the "token" query parameter out of the SRS
// callback param field, which carries the RTMP publish query string in
// the form "?token=<secret>" (02_V1_ARCHITECTURE_SPEC.md "Protocols":
// "<ingest_id>?token=<secret>"). A malformed or absent param yields an
// empty token, which VerifyToken always rejects.
func extractToken(param string) string {
	values, err := url.ParseQuery(strings.TrimPrefix(param, "?"))
	if err != nil {
		return ""
	}
	return values.Get("token")
}

func writeSuccess(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(successResponse{Code: 0})
}

// writeReject responds per the SRS callback contract: HTTP 200 with a
// non-zero code tells SRS to refuse the publish/segment
// (02_V1_ARCHITECTURE_SPEC.md "on_publish ... MUST reject unauthorized
// or conflicting publishers with a non-zero callback result").
func writeReject(w http.ResponseWriter, errorCode string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(rejectResponse{Code: 1, ErrorCode: errorCode})
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorResponse{Error: message})
}
