// Package health implements the Media Agent's liveness endpoint.
package health

import (
	"encoding/json"
	"net/http"
	"time"
)

// ServiceName identifies this service in health responses and future
// metrics/log correlation.
const ServiceName = "media-agent"

// Version is the build-time service version. It defaults to "dev" for
// local and CI builds and is expected to be overridden at build time
// via -ldflags "-X .../internal/health.Version=<value>".
var Version = "dev"

// Response is the stable JSON shape returned by GET /healthz. Field
// names and types must not change without a coordinated contract
// update, since operational tooling depends on them.
type Response struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Version   string `json:"version"`
	Timestamp string `json:"timestamp"`
}

// Handler returns an http.Handler serving GET /healthz. It reports
// process liveness only; it does not check downstream dependencies,
// which do not exist yet in this skeleton.
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		resp := Response{
			Status:    "ok",
			Service:   ServiceName,
			Version:   Version,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
}
