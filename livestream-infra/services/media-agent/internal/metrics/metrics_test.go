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

func TestSetGroupResetsLabelsAbsentFromLatestCounts(t *testing.T) {
	reg := NewRegistry()
	g := reg.NewGauge("test_sessions", "current sessions by status")

	g.SetGroup("status", map[string]int{"active": 3, "starting": 1})

	var buf strings.Builder
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, `test_sessions{status="active"} 3`) {
		t.Errorf("expected active=3, got:\n%s", out)
	}
	if !strings.Contains(out, `test_sessions{status="starting"} 1`) {
		t.Errorf("expected starting=1, got:\n%s", out)
	}

	// The next scrape observes no more active or starting sessions at
	// all (both disappeared from the query result, e.g. the last session
	// disconnected). SetGroup must reset both known series to zero
	// rather than leave them at their last nonzero reading.
	g.SetGroup("status", map[string]int{})

	buf.Reset()
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out = buf.String()
	if !strings.Contains(out, `test_sessions{status="active"} 0`) {
		t.Errorf("expected active reset to 0 after disappearing from counts, got:\n%s", out)
	}
	if !strings.Contains(out, `test_sessions{status="starting"} 0`) {
		t.Errorf("expected starting reset to 0 after disappearing from counts, got:\n%s", out)
	}
}

func TestSetGroupNeverCreatesSeriesOutsideCountsGiven(t *testing.T) {
	reg := NewRegistry()
	g := reg.NewGauge("test_relays", "current relays by status")

	g.SetGroup("status", map[string]int{"running": 1})
	g.SetGroup("status", map[string]int{"stopped": 1})

	var buf strings.Builder
	if _, err := reg.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo() error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, `test_relays{status="stopped"} 1`) {
		t.Errorf("expected stopped=1, got:\n%s", out)
	}
	if !strings.Contains(out, `test_relays{status="running"} 0`) {
		t.Errorf("expected running reset to 0 (not deleted, not left at 1), got:\n%s", out)
	}
	// Cardinality stays bounded to the distinct values actually observed
	// (2 here: running, stopped) - SetGroup must never fabricate a third
	// series for some value it was never called with.
	if strings.Count(out, "test_relays{") != 2 {
		t.Errorf("expected exactly 2 series total, got:\n%s", out)
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
