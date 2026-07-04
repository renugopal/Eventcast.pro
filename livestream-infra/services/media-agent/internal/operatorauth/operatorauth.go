// Package operatorauth guards the Media Agent's internal, state-changing
// HTTP endpoints (VOD finalization trigger, VOD-gap resolution) that a
// control plane or human operator calls directly, as distinct from the
// SRS callback endpoints (internal/srs) and the pull-only control-plane
// sync client (internal/controlplane). These endpoints must never be
// exposed publicly (02_V1_ARCHITECTURE_SPEC.md "Security requirements":
// "Internal callback endpoints MUST bind to loopback or a private network
// only"); this package is a defense-in-depth authentication layer on top
// of that network boundary, not a substitute for it.
package operatorauth

import (
	"crypto/subtle"
	"log/slog"
	"net/http"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

// RequireBearerToken wraps next so every request must present
// "Authorization: Bearer <token>" matching the configured secret via a
// constant-time comparison. If token is empty, the middleware is
// disabled and every request passes through unmodified: this keeps a
// deployment that predates this milestone (and every existing
// integration/smoke test script) working unchanged, but the caller must
// log a loud startup warning when leaving it disabled (see
// cmd/media-agent/main.go) - an internal endpoint left unauthenticated on
// a misconfigured network boundary can trigger VOD finalization or
// override a documented gap decision for an arbitrary event id.
func RequireBearerToken(token logging.Secret, logger *slog.Logger, next http.Handler) http.Handler {
	want := token.Reveal()
	if want == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok := bearerToken(r)
		if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			logger.Warn("operator endpoint rejected: missing or invalid bearer token",
				slog.String("path", r.URL.Path), slog.String("remote_addr", r.RemoteAddr))
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// bearerToken extracts the credential from a well-formed
// "Authorization: Bearer <token>" header. It never logs the header value.
func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) <= len(prefix) || h[:len(prefix)] != prefix {
		return "", false
	}
	return h[len(prefix):], true
}
