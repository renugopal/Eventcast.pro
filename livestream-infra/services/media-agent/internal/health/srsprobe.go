package health

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
)

// SRS API signal states (fixed vocabulary).
const (
	SRSStateUnknown     = "unknown"
	SRSStateReachable   = "reachable"
	SRSStateUnreachable = "unreachable"
	SRSStateStale       = "stale"
)

// Probe defaults (Livestream Reliability & Operations Package).
const (
	DefaultSRSProbeInterval = 15 * time.Second
	// DefaultSRSProbeTimeout bounds every probe INSIDE SRSProbe via a
	// per-probe context, independent of any supplied http.Client's Timeout.
	DefaultSRSProbeTimeout = 1 * time.Second
	srsProbePath           = "/api/v1/versions" // read-only SRS endpoint
	srsStaleMultiplier     = 3
)

// SRSSignal is the non-gating /readyz view of SRS API reachability.
type SRSSignal struct {
	State string `json:"state"`
	// CheckedAgeSeconds is seconds since the last completed probe (>= 0);
	// omitted while no probe has completed (state "unknown").
	CheckedAgeSeconds *float64 `json:"checked_age_seconds,omitempty"`
}

// SRSProbe maintains a cached, last-known SRS API reachability observation
// from a background loop. /readyz only ever reads Snapshot - it never
// performs an SRS request - so a slow or hanging SRS can never delay
// readiness.
type SRSProbe struct {
	url      string
	client   *http.Client
	interval time.Duration
	now      func() time.Time

	mu        sync.Mutex
	observed  bool
	reachable bool
	checkedAt time.Time
}

// NewSRSProbe returns a probe for baseURL (e.g. "http://srs:1985"). A nil
// client gets a default client; every probe is bounded by
// DefaultSRSProbeTimeout regardless of the client's own Timeout.
// interval <= 0 means DefaultSRSProbeInterval.
func NewSRSProbe(baseURL string, client *http.Client, interval time.Duration) *SRSProbe {
	if client == nil {
		client = &http.Client{}
	}
	if interval <= 0 {
		interval = DefaultSRSProbeInterval
	}
	return &SRSProbe{
		url:      strings.TrimSuffix(baseURL, "/") + srsProbePath,
		client:   client,
		interval: interval,
		now:      time.Now,
	}
}

// Run probes immediately, then once per interval, until ctx is cancelled.
// Callers start it in a goroutine tied to the agent's shutdown WaitGroup;
// it returns promptly on cancellation (an in-flight request is aborted via
// the per-probe context derived from ctx).
func (p *SRSProbe) Run(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		p.probeOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// probeOnce performs exactly one request (no retry within a tick), bounded
// by DefaultSRSProbeTimeout through its own context. HTTP status 200 alone
// decides reachability; the body is closed immediately, never read.
func (p *SRSProbe) probeOnce(ctx context.Context) {
	probeCtx, cancel := context.WithTimeout(ctx, DefaultSRSProbeTimeout)
	defer cancel()

	reachable := false
	if req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, p.url, nil); err == nil {
		if resp, err := p.client.Do(req); err == nil {
			reachable = resp.StatusCode == http.StatusOK
			resp.Body.Close()
		}
	}
	// Parent (shutdown) cancellation is never recorded as unreachable. A
	// per-probe timeout with the parent still live IS recorded (unreachable).
	if ctx.Err() != nil {
		return
	}
	p.mu.Lock()
	p.observed, p.reachable, p.checkedAt = true, reachable, p.now()
	p.mu.Unlock()
}

// Snapshot returns the cached signal without any I/O.
func (p *SRSProbe) Snapshot(now time.Time) SRSSignal {
	p.mu.Lock()
	observed, reachable, checkedAt := p.observed, p.reachable, p.checkedAt
	p.mu.Unlock()
	if !observed {
		return SRSSignal{State: SRSStateUnknown}
	}
	elapsed := now.Sub(checkedAt)
	age := elapsed.Seconds()
	if age < 0 {
		age = 0
	}
	state := SRSStateUnreachable
	switch {
	case elapsed > srsStaleMultiplier*p.interval:
		state = SRSStateStale
	case reachable:
		state = SRSStateReachable
	}
	return SRSSignal{State: state, CheckedAgeSeconds: &age}
}
