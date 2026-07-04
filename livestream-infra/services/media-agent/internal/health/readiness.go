package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// readinessCheckTimeout bounds each individual dependency check so a
// single slow or hung dependency cannot make GET /readyz itself hang;
// GET /healthz (Handler, above) remains a pure in-process liveness
// check with no dependency calls at all.
const readinessCheckTimeout = 2 * time.Second

// ReadinessChecks are the dependency probes GET /readyz evaluates. Each
// function must be side-effect free (or, in the case of a spool
// writability probe, clean up any file it creates before returning) and
// must return quickly. A nil entry is treated as "not applicable" and
// always passes, so callers that do not yet have a given dependency
// wired up are not forced to stub it out.
type ReadinessChecks struct {
	Database        func(ctx context.Context) error
	SpoolWritable   func(ctx context.Context) error
	AssignmentCache func(ctx context.Context) error
	// ControlPlaneCache reports an error only when continuous
	// control-plane assignment sync is enabled and the cache has become
	// critically stale (internal/controlplane.Syncer.Status). It must
	// return nil throughout an ordinary, still-within-policy control-plane
	// outage: the architecture requires the agent keep authorizing
	// already-cached, unexpired publishers during a temporary outage
	// (03_DATA_MODEL_AND_API_CONTRACTS.md "Assignment synchronization"),
	// so this check exists to catch only the case where that grace
	// period has been exceeded, not routine transient failures.
	ControlPlaneCache func(ctx context.Context) error
}

// ReadinessResponse is the stable JSON shape returned by GET /readyz.
// Checks are booleans only - no paths, counts, or other filesystem or
// database detail that could aid an attacker or leak operational
// internals.
type ReadinessResponse struct {
	Status string          `json:"status"`
	Checks map[string]bool `json:"checks"`
}

// ReadinessHandler returns an http.Handler serving GET /readyz. It
// reports HTTP 200 with status "ready" only when every configured check
// passes, otherwise HTTP 503 with status "not_ready" and the per-check
// boolean breakdown.
func ReadinessHandler(checks ReadinessChecks) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), readinessCheckTimeout)
		defer cancel()

		results := map[string]bool{
			"database":            runCheck(ctx, checks.Database),
			"spool_writable":      runCheck(ctx, checks.SpoolWritable),
			"assignment_cache":    runCheck(ctx, checks.AssignmentCache),
			"control_plane_cache": runCheck(ctx, checks.ControlPlaneCache),
		}

		ready := results["database"] && results["spool_writable"] && results["assignment_cache"] && results["control_plane_cache"]

		resp := ReadinessResponse{Checks: results}
		status := http.StatusOK
		resp.Status = "ready"
		if !ready {
			status = http.StatusServiceUnavailable
			resp.Status = "not_ready"
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(resp)
	})
}

func runCheck(ctx context.Context, check func(context.Context) error) bool {
	if check == nil {
		return true
	}
	return check(ctx) == nil
}
