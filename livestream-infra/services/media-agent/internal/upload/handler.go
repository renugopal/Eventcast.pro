package upload

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// finalizeResponse is the stable JSON shape POST
// /internal/events/{event_id}/finalize returns. Reason is safe to
// expose verbatim (see FinalizeResult).
type finalizeResponse struct {
	Finalized bool   `json:"finalized"`
	Reason    string `json:"reason,omitempty"`
	R2Key     string `json:"r2_key,omitempty"`
}

// FinalizeHandler serves POST /internal/events/{event_id}/finalize:
// the control-plane-facing trigger for VOD finalization. Per
// 02_V1_ARCHITECTURE_SPEC.md "Event lifecycle," deciding *when* an
// event has ended (scheduled end plus grace period, or a manual "End
// Live") is control-plane business logic this Media Agent does not yet
// implement (internal/controlplane is a later milestone); this endpoint
// is the documented seam a control plane (or, until then, an operator
// or integration test) calls once it has made that decision. It is safe
// to call repeatedly and before the event is actually eligible: a
// not-yet-eligible call returns finalized=false with a human-readable,
// secret-free reason rather than an error.
type FinalizeHandler struct {
	Finalizer *VODFinalizer
	Logger    *slog.Logger
}

func (h *FinalizeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	eventID := r.PathValue("event_id")
	if eventID == "" {
		http.Error(w, "event_id is required", http.StatusBadRequest)
		return
	}

	result, err := h.Finalizer.Finalize(r.Context(), eventID)
	if err != nil {
		h.Logger.Error("finalize handler failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
		http.Error(w, "finalization failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if !result.Finalized {
		w.WriteHeader(http.StatusAccepted)
	}
	_ = json.NewEncoder(w).Encode(finalizeResponse{Finalized: result.Finalized, Reason: result.Reason, R2Key: result.R2Key})
}
