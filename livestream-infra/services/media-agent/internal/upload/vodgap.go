package upload

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// maxVODGapRequestBytes bounds the resolution request body. The payload
// is a small JSON object; this is a generous ceiling against a
// misbehaving or malicious sender.
const maxVODGapRequestBytes = 1 << 12 // 4 KiB

// vodGapResponse is the stable JSON shape both the GET status check and
// the POST resolution action return.
type vodGapResponse struct {
	EventID             string `json:"event_id"`
	GapCount            int    `json:"gap_count"`
	GapStatus           string `json:"gap_status"`
	GapResolutionActor  string `json:"gap_resolution_actor,omitempty"`
	GapResolutionReason string `json:"gap_resolution_reason,omitempty"`
	GapResolvedAt       string `json:"gap_resolved_at,omitempty"`
}

// vodGapResolveRequest is the POST request body. Actor identifies the
// authenticated caller for the audit trail (e.g. an operator's account
// name or the control plane's own service identity) - it is not derived
// from the bearer token itself, so the caller must supply it explicitly.
//
// Known limitation: this milestone's operator authentication
// (internal/operatorauth) is a single shared bearer token, not a
// per-operator credential, so Actor is self-reported by the caller and
// not cryptographically bound to a specific identity. The audit trail
// (vod_gap_audit) is therefore trustworthy about *what* was decided and
// *when*, but relies on caller honesty for *who*. A future milestone
// requiring strong per-operator attribution would need individual
// operator credentials, which the architecture does not yet define.
type vodGapResolveRequest struct {
	Action string `json:"action"` // "acknowledge" or "reject"
	Actor  string `json:"actor"`
	Reason string `json:"reason"`
}

// VODGapHandler serves the VOD-gap operator resolution surface
// (02_V1_ARCHITECTURE_SPEC.md "VOD finalization": "... or an operator
// explicitly accepts a documented gap"):
//
//   - GET  /internal/events/{event_id}/vod-gap        current gap state
//   - POST /internal/events/{event_id}/vod-gap        acknowledge/reject
//
// Both routes are internal-only and must be placed behind
// internal/operatorauth by the caller (cmd/media-agent/main.go); this
// handler does not itself authenticate the caller. The POST action only
// ever updates the gap_status/resolution columns of the existing
// vod_finalizations row and appends an audit row - it never touches a
// segment, an R2 object, or the filesystem, so it cannot be used to
// perform arbitrary object or filesystem manipulation regardless of the
// event_id or reason supplied.
type VODGapHandler struct {
	Store  *store.Store
	Logger *slog.Logger
}

func (h *VODGapHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("event_id")
	if eventID == "" {
		http.Error(w, "event_id is required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.handleGet(w, r, eventID)
	case http.MethodPost:
		h.handlePost(w, r, eventID)
	default:
		w.Header().Set("Allow", http.MethodGet+", "+http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *VODGapHandler) handleGet(w http.ResponseWriter, r *http.Request, eventID string) {
	v, found, err := h.Store.GetVODFinalization(r.Context(), eventID)
	if err != nil {
		h.Logger.Error("vod-gap: read finalization failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
		http.Error(w, "read failed", http.StatusInternalServerError)
		return
	}
	if !found {
		http.Error(w, "no finalization on record for this event", http.StatusNotFound)
		return
	}
	writeVODGapResponse(w, http.StatusOK, v)
}

func (h *VODGapHandler) handlePost(w http.ResponseWriter, r *http.Request, eventID string) {
	r.Body = http.MaxBytesReader(w, r.Body, maxVODGapRequestBytes)

	var req vodGapResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed JSON body", http.StatusBadRequest)
		return
	}
	if req.Action != store.VODGapActionAcknowledge && req.Action != store.VODGapActionReject {
		http.Error(w, `action must be "acknowledge" or "reject"`, http.StatusBadRequest)
		return
	}
	if req.Actor == "" {
		http.Error(w, "actor is required", http.StatusBadRequest)
		return
	}

	v, err := h.Store.ResolveVODGap(r.Context(), eventID, req.Action, req.Actor, req.Reason, time.Now().UTC())
	switch {
	case errors.Is(err, store.ErrNoGapPending):
		http.Error(w, "no pending gap for this event", http.StatusNotFound)
		return
	case errors.Is(err, store.ErrGapAlreadyResolvedDifferently):
		http.Error(w, "gap was already resolved with a different action", http.StatusConflict)
		return
	case err != nil:
		h.Logger.Error("vod-gap: resolve failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
		http.Error(w, "resolution failed", http.StatusInternalServerError)
		return
	}

	h.Logger.Info("vod gap resolved",
		slog.String("event_id", eventID),
		slog.String("action", req.Action),
		slog.String("actor", req.Actor),
		slog.Int("gap_count", v.GapCount),
	)
	writeVODGapResponse(w, http.StatusOK, v)
}

func writeVODGapResponse(w http.ResponseWriter, status int, v store.VODFinalization) {
	resp := vodGapResponse{
		EventID:             v.EventID,
		GapCount:            v.GapCount,
		GapStatus:           v.GapStatus,
		GapResolutionActor:  v.GapResolutionActor,
		GapResolutionReason: v.GapResolutionReason,
	}
	if !v.GapResolvedAt.IsZero() {
		resp.GapResolvedAt = v.GapResolvedAt.UTC().Format(time.RFC3339Nano)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(resp)
}
