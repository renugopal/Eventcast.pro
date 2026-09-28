package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func passing() ReadinessChecks {
	ok := func(context.Context) error { return nil }
	return ReadinessChecks{Database: ok, SpoolWritable: ok, AssignmentCache: ok, ControlPlaneCache: ok}
}

func serveReadyz(t *testing.T, h http.Handler) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	return rec.Code, body
}

func zero() *float64 { z := 0.0; return &z }

func TestReadyz_FastWhileSRSHanging(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(started) }) // the probe request has arrived
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	t.Cleanup(func() { close(release); srv.Close() })

	probe := NewSRSProbe(srv.URL, &http.Client{}, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel) // guarantees Run is cancelled even if a t.Fatal fires below
	runDone := make(chan struct{})
	go func() { probe.Run(ctx); close(runDone) }()

	select {
	case <-started: // SRS probe is now genuinely in flight and hanging
	case <-time.After(2 * time.Second):
		t.Fatal("probe request never reached the hanging SRS server")
	}

	h := ReadinessHandlerWithSignals(passing(), B2Status{}, func(context.Context) Signals {
		return Signals{SRSAPI: probe.Snapshot(time.Now()), UploadLagSeconds: zero()}
	})
	start := time.Now()
	code, body := serveReadyz(t, h)
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Fatalf("/readyz took %v while the SRS probe hangs in flight, want < 100ms", d)
	}
	if code != http.StatusOK || body["status"] != "ready" {
		t.Fatalf("code=%d body=%v", code, body)
	}

	cancel()
	select {
	case <-runDone: // background probe exits cleanly on cancellation
	case <-time.After(2 * time.Second):
		t.Fatal("probe Run did not exit after cancellation")
	}
}

func TestReadyz_UnreachableSRSStillReady200(t *testing.T) {
	h := ReadinessHandlerWithSignals(passing(), B2Status{}, func(context.Context) Signals {
		return Signals{SRSAPI: SRSSignal{State: SRSStateUnreachable}}
	})
	code, body := serveReadyz(t, h)
	sig := body["signals"].(map[string]any)["srs_api"].(map[string]any)
	if code != http.StatusOK || body["status"] != "ready" || sig["state"] != SRSStateUnreachable {
		t.Fatalf("code=%d body=%v", code, body)
	}
}

func TestReadyz_GatingFailureStill503WithHealthySignals(t *testing.T) {
	checks := passing()
	checks.Database = func(context.Context) error { return errors.New("db down") }
	h := ReadinessHandlerWithSignals(checks, B2Status{}, func(context.Context) Signals {
		return Signals{SRSAPI: SRSSignal{State: SRSStateReachable}, UploadLagSeconds: zero()}
	})
	if code, body := serveReadyz(t, h); code != http.StatusServiceUnavailable || body["status"] != "not_ready" {
		t.Fatalf("code=%d body=%v, want 503 not_ready", code, body)
	}
}

func TestReadyz_UploadLagErrorOmitsKey_ZeroBacklogEmitsZero(t *testing.T) {
	omit := ReadinessHandlerWithSignals(passing(), B2Status{}, func(context.Context) Signals {
		return Signals{SRSAPI: SRSSignal{State: SRSStateUnknown}} // query failed -> nil
	})
	_, body := serveReadyz(t, omit)
	if _, present := body["signals"].(map[string]any)["upload_lag_seconds"]; present {
		t.Fatalf("upload_lag_seconds present on query error: %v", body)
	}
	emit := ReadinessHandlerWithSignals(passing(), B2Status{}, func(context.Context) Signals {
		return Signals{SRSAPI: SRSSignal{State: SRSStateUnknown}, UploadLagSeconds: zero()}
	})
	_, body = serveReadyz(t, emit)
	if v, present := body["signals"].(map[string]any)["upload_lag_seconds"]; !present || v != float64(0) {
		t.Fatalf("zero backlog not emitted as 0: %v", body)
	}
}

func TestReadyz_LegacyConstructorsUnchangedShape(t *testing.T) {
	_, plain := serveReadyz(t, ReadinessHandler(passing()))
	if _, ok := plain["b2"]; ok {
		t.Fatalf("ReadinessHandler gained b2: %v", plain)
	}
	if _, ok := plain["signals"]; ok {
		t.Fatalf("ReadinessHandler gained signals: %v", plain)
	}
	_, withB2 := serveReadyz(t, ReadinessHandlerWithB2(passing(), B2Status{Configured: true}))
	if _, ok := withB2["b2"]; !ok {
		t.Fatalf("ReadinessHandlerWithB2 lost b2: %v", withB2)
	}
	if _, ok := withB2["signals"]; ok {
		t.Fatalf("ReadinessHandlerWithB2 gained signals: %v", withB2)
	}
}
