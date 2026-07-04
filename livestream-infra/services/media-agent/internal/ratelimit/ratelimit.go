// Package ratelimit provides a per-client-key token-bucket rate limiter
// and HTTP middleware for the Media Agent's exposed endpoints (SRS
// callbacks and internal operator endpoints), per this milestone's
// requirement to add "rate limiting and abuse protection where the Media
// Agent exposes HTTP callback or internal operator endpoints" while
// remaining "functional at legitimate event rates."
package ratelimit

import (
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// bucket is a single client key's token bucket.
type bucket struct {
	mu       sync.Mutex
	tokens   float64
	lastSeen time.Time
}

// Limiter is a per-key token-bucket rate limiter. The zero value is not
// usable; use New.
type Limiter struct {
	rps   float64 // tokens added per second
	burst float64 // maximum bucket size

	mu      sync.Mutex
	buckets map[string]*bucket

	// now is overridable for deterministic tests.
	now func() time.Time
}

// New returns a Limiter allowing, per client key, rps sustained requests
// per second with bursts up to burst.
func New(rps float64, burst int) *Limiter {
	return &Limiter{
		rps:     rps,
		burst:   float64(burst),
		buckets: make(map[string]*bucket),
		now:     time.Now,
	}
}

// Allow reports whether a request for key may proceed, consuming one
// token if so.
func (l *Limiter) Allow(key string) bool {
	now := l.now()

	l.mu.Lock()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, lastSeen: now}
		l.buckets[key] = b
	}
	l.mu.Unlock()

	b.mu.Lock()
	defer b.mu.Unlock()
	elapsed := now.Sub(b.lastSeen).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * l.rps
		if b.tokens > l.burst {
			b.tokens = l.burst
		}
		b.lastSeen = now
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Sweep removes buckets idle for longer than maxIdle, bounding the
// limiter's memory to the set of recently active client keys rather than
// growing unboundedly across the process lifetime. Callers should invoke
// this periodically (see cmd/media-agent/main.go), not on every request.
//
// Known limitation: this bounds *steady-state* memory (idle buckets are
// eventually reclaimed), but does not cap the number of *distinct*
// client keys seen within one sweep window - a large-scale distributed
// attacker with many real source addresses could still grow the bucket
// map significantly before the next sweep. This limiter is deliberately
// a defense-in-depth, per-node abuse control, not the platform's primary
// DDoS boundary; that boundary is the network/firewall/CDN layer
// (02_V1_ARCHITECTURE_SPEC.md "Security requirements": "Production
// firewall rules SHOULD expose only required publishing ports").
func (l *Limiter) Sweep(maxIdle time.Duration) {
	cutoff := l.now().Add(-maxIdle)
	l.mu.Lock()
	defer l.mu.Unlock()
	for key, b := range l.buckets {
		b.mu.Lock()
		idle := b.lastSeen.Before(cutoff)
		b.mu.Unlock()
		if idle {
			delete(l.buckets, key)
		}
	}
}

// Middleware wraps next with the rate limiter, responding 429 Too Many
// Requests when the caller's key has exhausted its budget. keyFunc
// extracts the client key from the request (see ClientIP below); logger
// must not be nil.
func Middleware(limiter *Limiter, keyFunc func(*http.Request) string, logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := keyFunc(r)
		if !limiter.Allow(key) {
			logger.Warn("request rate-limited", slog.String("path", r.URL.Path), slog.String("client_key", key))
			w.Header().Set("Retry-After", "1")
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ClientIP returns the request's client key for rate-limiting and access
// logging: the TCP remote address's IP, with the port stripped. It never
// consults X-Forwarded-For, X-Real-IP, or any other client-supplied
// header, because those are trivially spoofable by the very client the
// limiter exists to bound - 02_V1_ARCHITECTURE_SPEC.md "Security
// requirements" and this milestone's explicit hardening requirement ("Do
// not trust spoofable forwarding headers unless the deployment
// explicitly establishes a trusted proxy boundary"). Use
// TrustedProxyClientIP instead only when the deployment has verified
// every request actually transits a proxy that itself strips and
// re-sets that header.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// TrustedProxyClientIP returns the first address in X-Forwarded-For, or
// falls back to ClientIP if the header is absent. It must only be used
// when EVENTCAST_TRUSTED_PROXY_ENABLED is explicitly set (see
// internal/config), i.e. the deployment has established that every
// request genuinely transits a reverse proxy under its control that
// strips any client-supplied X-Forwarded-For before appending its own -
// otherwise a client can trivially forge this header to evade or corrupt
// per-client rate limiting.
func TrustedProxyClientIP(r *http.Request) string {
	xff := r.Header.Get("X-Forwarded-For")
	if xff == "" {
		return ClientIP(r)
	}
	first, _, _ := strings.Cut(xff, ",")
	return strings.TrimSpace(first)
}
