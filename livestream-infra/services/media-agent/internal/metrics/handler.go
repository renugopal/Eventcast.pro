package metrics

import (
	"context"
	"net/http"
	"time"
)

// refreshTimeout bounds the optional pre-render refresh hook so a slow or
// hung dependency (e.g. a stalled SQLite query under lock contention)
// cannot make GET /metrics itself hang indefinitely.
const refreshTimeout = 3 * time.Second

// Handler returns the http.Handler for GET /metrics. If refresh is
// non-nil, it is called with a bounded-timeout context derived from the
// request before the registry is rendered, so gauges reflect
// near-current state (e.g. current queue depth, spool free bytes) rather
// than whatever the last scrape happened to compute. refresh must not
// panic and should treat its own errors as best-effort (log and
// continue) rather than failing the scrape - a metrics endpoint that
// goes down because one dependency query failed would itself become an
// operational blind spot at exactly the wrong moment.
func Handler(reg *Registry, refresh func(ctx context.Context)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if refresh != nil {
			ctx, cancel := context.WithTimeout(r.Context(), refreshTimeout)
			refresh(ctx)
			cancel()
		}

		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = reg.WriteTo(w)
	})
}
