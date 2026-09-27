package health

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func hangingServer(t *testing.T) *httptest.Server {
	t.Helper()
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() { close(release); srv.Close() })
	return srv
}

func statusServer(t *testing.T, code int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != srsProbePath {
			t.Errorf("probe path = %q, want %q", r.URL.Path, srsProbePath)
		}
		w.WriteHeader(code)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestSRSProbe_UnknownBeforeFirstProbe(t *testing.T) {
	p := NewSRSProbe("http://127.0.0.1:1", nil, time.Second)
	s := p.Snapshot(time.Now())
	if s.State != SRSStateUnknown || s.CheckedAgeSeconds != nil {
		t.Fatalf("snapshot = %+v, want unknown with no age", s)
	}
}

func TestSRSProbe_ReachableOn200(t *testing.T) {
	p := NewSRSProbe(statusServer(t, http.StatusOK).URL, nil, time.Second)
	p.probeOnce(context.Background())
	if s := p.Snapshot(time.Now()); s.State != SRSStateReachable || s.CheckedAgeSeconds == nil {
		t.Fatalf("snapshot = %+v, want reachable", s)
	}
}

func TestSRSProbe_UnreachableOnNon200(t *testing.T) {
	p := NewSRSProbe(statusServer(t, http.StatusInternalServerError).URL, nil, time.Second)
	p.probeOnce(context.Background())
	if s := p.Snapshot(time.Now()); s.State != SRSStateUnreachable {
		t.Fatalf("snapshot = %+v, want unreachable", s)
	}
}

func TestSRSProbe_UnreachableOnRefused(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close() // nothing listens here now
	p := NewSRSProbe("http://"+addr, nil, time.Second)
	p.probeOnce(context.Background())
	if s := p.Snapshot(time.Now()); s.State != SRSStateUnreachable {
		t.Fatalf("snapshot = %+v, want unreachable", s)
	}
}

func TestSRSProbe_BoundedEvenWithCustomClientWithoutTimeout(t *testing.T) {
	p := NewSRSProbe(hangingServer(t).URL, &http.Client{}, time.Second) // no client Timeout
	start := time.Now()
	p.probeOnce(context.Background())
	elapsed := time.Since(start)
	if elapsed > DefaultSRSProbeTimeout+500*time.Millisecond || elapsed < DefaultSRSProbeTimeout-100*time.Millisecond {
		t.Fatalf("probe took %v, want ~%v (bounded by the per-probe context)", elapsed, DefaultSRSProbeTimeout)
	}
	if s := p.Snapshot(time.Now()); s.State != SRSStateUnreachable {
		t.Fatalf("snapshot = %+v, want unreachable after timeout", s)
	}
}

func TestSRSProbe_StaleAfterThreeIntervals(t *testing.T) {
	interval := time.Second
	p := NewSRSProbe(statusServer(t, http.StatusOK).URL, nil, interval)
	base := time.Now()
	p.now = func() time.Time { return base }
	p.probeOnce(context.Background())
	if s := p.Snapshot(base.Add(3 * interval)); s.State != SRSStateReachable {
		t.Fatalf("at 3x interval = %+v, want still reachable", s)
	}
	if s := p.Snapshot(base.Add(3*interval + time.Millisecond)); s.State != SRSStateStale {
		t.Fatalf("past 3x interval = %+v, want stale", s)
	}
}

func TestSRSProbe_CheckedAgeClampedNonNegative(t *testing.T) {
	p := NewSRSProbe(statusServer(t, http.StatusOK).URL, nil, time.Second)
	base := time.Now()
	p.now = func() time.Time { return base }
	p.probeOnce(context.Background())
	s := p.Snapshot(base.Add(-time.Minute))
	if s.CheckedAgeSeconds == nil || *s.CheckedAgeSeconds != 0 {
		t.Fatalf("age = %v, want clamped 0", s.CheckedAgeSeconds)
	}
}

func TestSRSProbe_RunStopsPromptlyOnCancel(t *testing.T) {
	p := NewSRSProbe(hangingServer(t).URL, &http.Client{}, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { p.Run(ctx); close(done) }()
	time.Sleep(100 * time.Millisecond) // first probe in flight
	start := time.Now()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancellation")
	}
	if d := time.Since(start); d > 300*time.Millisecond {
		t.Fatalf("Run took %v to stop, want prompt", d)
	}
	if s := p.Snapshot(time.Now()); s.State != SRSStateUnknown {
		t.Fatalf("cancelled probe recorded %+v, want unknown", s)
	}
}
