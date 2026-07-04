package srs

import (
	"net/http"
	"strings"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/metrics"
)

func TestHandlersWithNilMetricsNeverPanics(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	// env.handlers.Metrics is nil (never set) - this must not panic.
	if rec, _ := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token)); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestOnPublishRecordsAcceptedAndRejectedMetrics(t *testing.T) {
	env := newTestEnv(t)
	reg := metrics.NewRegistry()
	env.handlers.Metrics = metrics.NewSink(reg)

	token := env.seedAssignment(t, "teststream", nil)
	if rec, _ := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token)); rec.Code != http.StatusOK {
		t.Fatalf("accept status = %d, want 200", rec.Code)
	}
	if rec, _ := doRequest(t, env.handlers.OnPublish(), publishBody("unknown-stream", "wrong")); rec.Code != http.StatusOK {
		t.Fatalf("reject status = %d, want 200", rec.Code)
	}

	var buf strings.Builder
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, `media_agent_publish_auth_total{result="accepted"} 1`) {
		t.Errorf("expected 1 accepted publish auth, got:\n%s", out)
	}
	if !strings.Contains(out, `media_agent_publish_auth_total{result="rejected"} 1`) {
		t.Errorf("expected 1 rejected publish auth, got:\n%s", out)
	}
	if !strings.Contains(out, `media_agent_callback_total{callback="on_publish",result="ok"} 1`) {
		t.Errorf("expected 1 ok on_publish callback, got:\n%s", out)
	}
	if !strings.Contains(out, `media_agent_callback_total{callback="on_publish",result="rejected"} 1`) {
		t.Errorf("expected 1 rejected on_publish callback, got:\n%s", out)
	}
}
