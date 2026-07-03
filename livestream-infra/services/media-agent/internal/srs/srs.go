// Package srs implements the Media Agent's HTTP callback handlers for
// SRS (on_publish, on_hls, on_unpublish). This Phase 0 implementation
// validates and logs each callback only; no database, authorization,
// upload, or business-state logic exists yet (see the media-agent
// README "Expected responsibilities").
package srs

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

// MaxCallbackBodyBytes bounds the size of an accepted SRS callback
// request body. SRS callback payloads are small JSON objects; this is a
// generous ceiling against a misbehaving or malicious sender, not a
// tuned limit.
const MaxCallbackBodyBytes = 1 << 20 // 1 MiB

// Payload is the subset of the SRS HTTP callback JSON body this Phase 0
// handler reads. SRS posts the same envelope shape to on_publish,
// on_hls, and on_unpublish, with the fields relevant to each action
// populated and the rest left zero-valued (03_DATA_MODEL_AND_API_CONTRACTS.md
// "SRS callback contracts"). Param carries the RTMP publish query
// string, which may include a secret stream token, so it is decoded but
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
// callback returns. A non-zero "code" tells SRS to reject the action;
// this Phase 0 handler only ever returns code 0 because no rejection
// logic (auth, session, assignment) exists yet.
type successResponse struct {
	Code int `json:"code"`
}

// errorResponse is returned for rejected callbacks. The message never
// echoes request content, so it cannot leak a stream token or other
// callback value even if a future field became sensitive.
type errorResponse struct {
	Error string `json:"error"`
}

// handler serves a single named SRS callback route.
type handler struct {
	name   string
	logger *slog.Logger
}

// NewOnPublishHandler returns the http.Handler for POST /internal/srs/on-publish.
func NewOnPublishHandler(logger *slog.Logger) http.Handler {
	return &handler{name: "on_publish", logger: logger}
}

// NewOnHLSHandler returns the http.Handler for POST /internal/srs/on-hls.
func NewOnHLSHandler(logger *slog.Logger) http.Handler {
	return &handler{name: "on_hls", logger: logger}
}

// NewOnUnpublishHandler returns the http.Handler for POST /internal/srs/on-unpublish.
func NewOnUnpublishHandler(logger *slog.Logger) http.Handler {
	return &handler{name: "on_unpublish", logger: logger}
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

	h.logger.Info("srs callback received",
		slog.String("callback", h.name),
		slog.String("action", payload.Action),
		slog.String("vhost", payload.Vhost),
		slog.String("app", payload.App),
		slog.String("stream", payload.Stream),
		slog.String("client_id", payload.ClientID),
		slog.Bool("param_present", payload.Param != ""),
	)

	writeSuccess(w)
}

func writeSuccess(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(successResponse{Code: 0})
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorResponse{Error: message})
}
