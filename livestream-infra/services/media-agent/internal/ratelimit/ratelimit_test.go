package ratelimit

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLimiterAllowsUpToBurstThenBlocks(t *testing.T) {
	l := New(1, 3)
	fixed := time.Now()
	l.now = func() time.Time { return fixed }

	for i := 0; i < 3; i++ {
		if !l.Allow("client-a") {
			t.Fatalf("Allow() call %d = false, want true within burst", i+1)
		}
	}
	if l.Allow("client-a") {
		t.Error("Allow() = true after burst exhausted, want false")
	}
}

func TestLimiterRefillsOverTime(t *testing.T) {
	l := New(10, 1) // 10 tokens/sec, burst of 1
	fixed := time.Now()
	l.now = func() time.Time { return fixed }

	if !l.Allow("client-a") {
		t.Fatal("first Allow() = false, want true")
	}
	if l.Allow("client-a") {
		t.Fatal("second immediate Allow() = true, want false (bucket exhausted)")
	}

	fixed = fixed.Add(200 * time.Millisecond) // 10/sec * 0.2s = 2 tokens, capped at burst=1
	if !l.Allow("client-a") {
		t.Error("Allow() after refill window = false, want true")
	}
}

func TestLimiterKeysAreIndependent(t *testing.T) {
	l := New(1, 1)
	fixed := time.Now()
	l.now = func() time.Time { return fixed }

	if !l.Allow("client-a") {
		t.Fatal("client-a first Allow() = false")
	}
	if !l.Allow("client-b") {
		t.Error("client-b should have its own independent bucket")
	}
}

func TestLimiterSweepRemovesIdleBuckets(t *testing.T) {
	l := New(1, 1)
	fixed := time.Now()
	l.now = func() time.Time { return fixed }
	l.Allow("client-a")

	fixed = fixed.Add(time.Hour)
	l.Sweep(time.Minute)

	l.mu.Lock()
	_, exists := l.buckets["client-a"]
	l.mu.Unlock()
	if exists {
		t.Error("expected an idle-longer-than-maxIdle bucket to be swept")
	}
}

func testLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestMiddlewareBlocksOverLimit(t *testing.T) {
	l := New(1, 1)
	fixed := time.Now()
	l.now = func() time.Time { return fixed }

	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := Middleware(l, ClientIP, testLogger(), ok)

	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.RemoteAddr = "203.0.113.5:12345"

	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, req)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first request status = %d, want 200", rec1.Code)
	}

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusTooManyRequests {
		t.Errorf("second request status = %d, want 429", rec2.Code)
	}
}

func TestClientIPStripsPort(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.5:54321"
	if got := ClientIP(req); got != "203.0.113.5" {
		t.Errorf("ClientIP() = %q, want 203.0.113.5", got)
	}
}

func TestClientIPIgnoresForwardedHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.5:54321"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	if got := ClientIP(req); got != "203.0.113.5" {
		t.Errorf("ClientIP() = %q, want the RemoteAddr, not the spoofable header", got)
	}
}

func TestTrustedProxyClientIPUsesForwardedHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.5:54321"
	req.Header.Set("X-Forwarded-For", "198.51.100.9, 203.0.113.5")
	if got := TrustedProxyClientIP(req); got != "198.51.100.9" {
		t.Errorf("TrustedProxyClientIP() = %q, want 198.51.100.9", got)
	}
}

func TestTrustedProxyClientIPFallsBackWithoutHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.5:54321"
	if got := TrustedProxyClientIP(req); got != "203.0.113.5" {
		t.Errorf("TrustedProxyClientIP() = %q, want fallback to RemoteAddr", got)
	}
}
