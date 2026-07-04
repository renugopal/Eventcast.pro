package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCounterIncAndRender(t *testing.T) {
	reg := NewRegistry()
	c := reg.NewCounter("test_total", "a test counter")
	c.Inc()
	c.Inc()
	c.Add(3)

	var buf strings.Builder
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "# HELP test_total a test counter\n") {
		t.Errorf("missing HELP line, got:\n%s", out)
	}
	if !strings.Contains(out, "# TYPE test_total counter\n") {
		t.Errorf("missing TYPE line, got:\n%s", out)
	}
	if !strings.Contains(out, "test_total 5\n") {
		t.Errorf("expected test_total 5, got:\n%s", out)
	}
}

func TestGaugeSetAndRender(t *testing.T) {
	reg := NewRegistry()
	g := reg.NewGauge("test_gauge", "a test gauge")
	g.Set(3.5)
	g.Set(7)

	var buf strings.Builder
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	if !strings.Contains(buf.String(), "test_gauge 7\n") {
		t.Errorf("expected the latest Set() value to win, got:\n%s", buf.String())
	}
}

func TestLabelsRenderDeterministically(t *testing.T) {
	reg := NewRegistry()
	c := reg.NewCounter("labeled_total", "a labeled counter")
	c.Inc(Label{"b", "2"}, Label{"a", "1"})
	c.Inc(Label{"a", "1"}, Label{"b", "2"}) // same series, different arg order

	var buf strings.Builder
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, `labeled_total{a="1",b="2"} 2`) {
		t.Errorf("expected one series with count 2 regardless of label arg order, got:\n%s", out)
	}
}

func TestDistinctLabelValuesAreSeparateSeries(t *testing.T) {
	reg := NewRegistry()
	c := reg.NewCounter("result_total", "outcomes")
	c.Inc(Label{"result", "accepted"})
	c.Inc(Label{"result", "accepted"})
	c.Inc(Label{"result", "rejected"})

	var buf strings.Builder
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, `result_total{result="accepted"} 2`) || !strings.Contains(out, `result_total{result="rejected"} 1`) {
		t.Errorf("expected two independent series, got:\n%s", out)
	}
}

func TestZeroValueCounterAndGaugeAreSafeNoOps(t *testing.T) {
	var c Counter
	var g Gauge
	c.Inc()
	c.Add(5)
	g.Set(1.0)
	g.SetBool(true)
	// No panic is the assertion; there is nothing to render since these
	// were never registered against any Registry.
}

func TestRegisterSameNameDifferentKindPanics(t *testing.T) {
	reg := NewRegistry()
	reg.NewCounter("dup", "x")
	defer func() {
		if recover() == nil {
			t.Error("expected a panic when re-registering the same metric name as a different kind")
		}
	}()
	reg.NewGauge("dup", "x")
}

func TestHandlerServesMetricsAndCallsRefresh(t *testing.T) {
	reg := NewRegistry()
	g := reg.NewGauge("refreshed_gauge", "x")
	refreshed := false
	h := Handler(reg, func(ctx context.Context) {
		refreshed = true
		g.Set(42)
	})

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !refreshed {
		t.Error("expected refresh callback to be invoked")
	}
	if !strings.Contains(rec.Body.String(), "refreshed_gauge 42") {
		t.Errorf("expected refreshed value in output, got:\n%s", rec.Body.String())
	}
}

func TestHandlerRejectsNonGet(t *testing.T) {
	reg := NewRegistry()
	h := Handler(reg, nil)
	req := httptest.NewRequest(http.MethodPost, "/metrics", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}
