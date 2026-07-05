// Package metrics implements a minimal, dependency-free Prometheus text
// exposition format (https://prometheus.io/docs/instrumenting/exposition_formats/)
// writer for the Media Agent's GET /metrics endpoint. It intentionally
// does not pull in a third-party client library: Go is not available in
// this development environment to fetch and vendor a new module
// (go.sum requires network access to the module proxy), and the
// exposition format itself is a small, stable, well-documented text
// protocol - implementing exactly the subset this service needs keeps
// the dependency surface minimal, per 04_TECH_STACK_AND_VERSION_POLICY.md
// "The required libraries should be minimal and maintained."
//
// Every metric name and label set used against this Registry is fixed at
// compile time in cmd/media-agent/main.go's wiring; none is ever derived
// from unbounded, request-controlled input such as an event id or stream
// key, per this milestone's cardinality requirement.
package metrics

import (
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

// Registry holds every metric this process exposes and renders them in
// Prometheus text exposition format. The zero value is not usable; use
// NewRegistry.
type Registry struct {
	mu    sync.Mutex
	names []string // registration order, for deterministic /metrics output
	kind  map[string]string
	help  map[string]string
	// series holds each metric's child series keyed by their rendered
	// label string (e.g. `{status="confirmed"}`, or "" for an unlabeled
	// metric).
	series map[string]map[string]*series
}

type series struct {
	labels  string
	value   atomic.Int64  // counters and integer gauges
	fvalue  atomic.Uint64 // float gauges, stored via math.Float64bits
	isFloat bool
}

// NewRegistry returns an empty Registry.
func NewRegistry() *Registry {
	return &Registry{
		kind:   make(map[string]string),
		help:   make(map[string]string),
		series: make(map[string]map[string]*series),
	}
}

// Counter is a monotonically-increasing named metric, optionally
// partitioned by a fixed label set.
type Counter struct {
	reg  *Registry
	name string
}

// NewCounter registers name (failing fast via panic if it is already
// registered under a different kind - a programmer error caught at
// startup, not a runtime condition) and returns a handle to increment it.
func (r *Registry) NewCounter(name, help string) Counter {
	r.register(name, "counter", help)
	return Counter{reg: r, name: name}
}

// Inc increments the series identified by labels (nil or empty for an
// unlabeled metric) by 1.
func (c Counter) Inc(labels ...Label) { c.Add(1, labels...) }

// Add increments the series identified by labels by delta, which must be
// non-negative. The zero-value Counter (reg == nil) is a safe no-op, so a
// struct embedding Counter fields left unset by an older call site or a
// test that does not care about metrics never panics.
func (c Counter) Add(delta int64, labels ...Label) {
	if c.reg == nil || delta < 0 {
		return
	}
	c.reg.seriesFor(c.name, labels).value.Add(delta)
}

// Gauge is an arbitrary up-or-down named metric, optionally partitioned
// by a fixed label set.
type Gauge struct {
	reg  *Registry
	name string
}

// NewGauge registers name and returns a handle to set it.
func (r *Registry) NewGauge(name, help string) Gauge {
	r.register(name, "gauge", help)
	return Gauge{reg: r, name: name}
}

// Set records value as the current reading for the series identified by
// labels. The zero-value Gauge (reg == nil) is a safe no-op.
func (g Gauge) Set(value float64, labels ...Label) {
	if g.reg == nil {
		return
	}
	s := g.reg.seriesFor(g.name, labels)
	s.isFloat = true
	s.fvalue.Store(math.Float64bits(value))
}

// SetBool records 1 for true and 0 for false, the idiomatic gauge shape
// for a boolean condition (e.g. "is this dependency currently healthy").
func (g Gauge) SetBool(value bool, labels ...Label) {
	if value {
		g.Set(1, labels...)
		return
	}
	g.Set(0, labels...)
}

// SetGroup replaces g's complete reading along a single label dimension:
// every (labelName=key) pair in counts is set to n, and any series
// previously set for labelName on this gauge whose key is absent from
// counts - a status value that no longer has any rows behind it, e.g.
// the last active session disconnected, or the last running relay
// stopped - is reset to zero rather than left at its last observed
// value. It never introduces a label value outside of labelName's own
// key space and never grows the series count beyond the distinct values
// counts has used across the process lifetime, so cardinality stays
// bounded to the small, fixed enum callers always pass here (see
// cmd/media-agent/main.go's collectMetrics). The zero-value Gauge
// (reg == nil) is a safe no-op.
func (g Gauge) SetGroup(labelName string, counts map[string]int) {
	if g.reg == nil {
		return
	}
	r := g.reg
	r.mu.Lock()
	defer r.mu.Unlock()

	byLabels, ok := r.series[g.name]
	if !ok {
		panic(fmt.Sprintf("metrics: %q was never registered", g.name))
	}

	prefix := labelName + "="
	seen := make(map[string]bool, len(counts))
	for key, n := range counts {
		labels := []Label{{Name: labelName, Value: key}}
		k := labelKey(labels)
		seen[k] = true
		s, ok := byLabels[k]
		if !ok {
			s = &series{labels: renderLabels(labels)}
			byLabels[k] = s
		}
		s.isFloat = true
		s.fvalue.Store(math.Float64bits(float64(n)))
	}

	for k, s := range byLabels {
		if seen[k] || !strings.HasPrefix(k, prefix) {
			continue
		}
		s.isFloat = true
		s.fvalue.Store(0)
	}
}

// Label is one name/value pair attached to a metric series. Values must
// always come from a small, fixed, code-controlled vocabulary (a status
// enum, a provider name, a boolean) - never an event id, session id, or
// any other unbounded or secret-derived identifier.
type Label struct {
	Name  string
	Value string
}

func (r *Registry) register(name, kind, help string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existingKind, ok := r.kind[name]; ok {
		if existingKind != kind {
			panic(fmt.Sprintf("metrics: %q already registered as %s, cannot re-register as %s", name, existingKind, kind))
		}
		return
	}
	r.names = append(r.names, name)
	r.kind[name] = kind
	r.help[name] = help
	r.series[name] = make(map[string]*series)
}

func (r *Registry) seriesFor(name string, labels []Label) *series {
	key := labelKey(labels)
	r.mu.Lock()
	defer r.mu.Unlock()
	byLabels, ok := r.series[name]
	if !ok {
		panic(fmt.Sprintf("metrics: %q was never registered", name))
	}
	s, ok := byLabels[key]
	if !ok {
		s = &series{labels: renderLabels(labels)}
		byLabels[key] = s
	}
	return s
}

// labelKey produces a stable map key independent of the caller's
// argument order, so Label{"a","1"},Label{"b","2"} and the reverse order
// address the same series.
func labelKey(labels []Label) string {
	if len(labels) == 0 {
		return ""
	}
	sorted := append([]Label(nil), labels...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })
	var b strings.Builder
	for _, l := range sorted {
		b.WriteString(l.Name)
		b.WriteByte('=')
		b.WriteString(l.Value)
		b.WriteByte(',')
	}
	return b.String()
}

func renderLabels(labels []Label) string {
	if len(labels) == 0 {
		return ""
	}
	sorted := append([]Label(nil), labels...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })
	parts := make([]string, len(sorted))
	for i, l := range sorted {
		parts[i] = fmt.Sprintf("%s=%q", l.Name, l.Value)
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// WriteTo renders every registered metric in Prometheus text exposition
// format. It never fails: a write error to w is the caller's problem to
// handle (e.g. a client disconnect), not a reason to produce partial or
// malformed output.
func (r *Registry) WriteTo(w io.Writer) (int64, error) {
	r.mu.Lock()
	names := append([]string(nil), r.names...)
	r.mu.Unlock()

	var total int64
	for _, name := range names {
		r.mu.Lock()
		kind := r.kind[name]
		help := r.help[name]
		byLabels := r.series[name]
		seriesCopy := make([]*series, 0, len(byLabels))
		for _, s := range byLabels {
			seriesCopy = append(seriesCopy, s)
		}
		r.mu.Unlock()

		sort.Slice(seriesCopy, func(i, j int) bool { return seriesCopy[i].labels < seriesCopy[j].labels })

		n, err := fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s %s\n", name, help, name, kind)
		total += int64(n)
		if err != nil {
			return total, err
		}
		for _, s := range seriesCopy {
			var valueStr string
			if s.isFloat {
				valueStr = strconv.FormatFloat(math.Float64frombits(s.fvalue.Load()), 'g', -1, 64)
			} else {
				valueStr = strconv.FormatInt(s.value.Load(), 10)
			}
			n, err := fmt.Fprintf(w, "%s%s %s\n", name, s.labels, valueStr)
			total += int64(n)
			if err != nil {
				return total, err
			}
		}
	}
	return total, nil
}
