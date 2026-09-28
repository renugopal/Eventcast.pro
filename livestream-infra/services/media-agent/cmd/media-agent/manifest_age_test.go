package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/metrics"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

type fakeManifestStore struct {
	sessions   []store.Session
	manifests  map[string]time.Time // eventID -> PublishedAt
	sessErr    error
	manifestEr error
}

func (f fakeManifestStore) ListActiveSessions(context.Context) ([]store.Session, error) {
	return f.sessions, f.sessErr
}

func (f fakeManifestStore) GetLatestManifestGeneration(_ context.Context, eventID, _ string) (store.ManifestGeneration, bool, error) {
	if f.manifestEr != nil {
		return store.ManifestGeneration{}, false, f.manifestEr
	}
	at, ok := f.manifests[eventID]
	if !ok {
		return store.ManifestGeneration{}, false, nil
	}
	return store.ManifestGeneration{EventID: eventID, PublishedAt: at}, true, nil
}

func sess(eventID string, started time.Time) store.Session {
	return store.Session{ID: "s-" + eventID, EventID: eventID, StartedAt: started}
}

func TestManifestAge_ActiveSessionNoManifest_UsesSessionStart(t *testing.T) {
	now := time.Now().UTC()
	age, ok := liveManifestAgeSeconds(context.Background(), fakeManifestStore{sessions: []store.Session{sess("e1", now.Add(-40*time.Second))}}, now)
	if !ok || age != 40 {
		t.Fatalf("age=%v ok=%v, want 40 from session start (never a false 0)", age, ok)
	}
}

func TestManifestAge_ActiveSessionWithManifest_UsesPublishedAt(t *testing.T) {
	now := time.Now().UTC()
	fs := fakeManifestStore{
		sessions:  []store.Session{sess("e1", now.Add(-time.Hour))},
		manifests: map[string]time.Time{"e1": now.Add(-6 * time.Second)},
	}
	if age, ok := liveManifestAgeSeconds(context.Background(), fs, now); !ok || age != 6 {
		t.Fatalf("age=%v ok=%v, want 6 from PublishedAt", age, ok)
	}
}

func TestManifestAge_TwoActiveSessions_MaxWins(t *testing.T) {
	now := time.Now().UTC()
	fs := fakeManifestStore{
		sessions:  []store.Session{sess("e1", now.Add(-time.Hour)), sess("e2", now.Add(-25*time.Second))},
		manifests: map[string]time.Time{"e1": now.Add(-4 * time.Second)},
	}
	if age, ok := liveManifestAgeSeconds(context.Background(), fs, now); !ok || age != 25 {
		t.Fatalf("age=%v ok=%v, want 25 (e2 has no manifest yet)", age, ok)
	}
}

func TestManifestAge_NoActiveSessions_Zero(t *testing.T) {
	if age, ok := liveManifestAgeSeconds(context.Background(), fakeManifestStore{}, time.Now()); !ok || age != 0 {
		t.Fatalf("age=%v ok=%v, want 0", age, ok)
	}
}

func TestManifestAge_FutureTimestamps_ClampToZero(t *testing.T) {
	now := time.Now().UTC()
	future := fakeManifestStore{sessions: []store.Session{sess("e1", now.Add(time.Minute))}}
	if age, ok := liveManifestAgeSeconds(context.Background(), future, now); !ok || age != 0 {
		t.Fatalf("future StartedAt: age=%v ok=%v, want 0", age, ok)
	}
	futureManifest := fakeManifestStore{
		sessions:  []store.Session{sess("e1", now.Add(-time.Hour))},
		manifests: map[string]time.Time{"e1": now.Add(time.Minute)},
	}
	if age, ok := liveManifestAgeSeconds(context.Background(), futureManifest, now); !ok || age != 0 {
		t.Fatalf("future PublishedAt: age=%v ok=%v, want 0", age, ok)
	}
}

func TestManifestAge_QueryFailure_GaugeUnchanged(t *testing.T) {
	now := time.Now().UTC()
	cases := map[string]fakeManifestStore{
		"ListActiveSessions failure":          {sessErr: errors.New("db")},
		"GetLatestManifestGeneration failure": {sessions: []store.Session{sess("e1", now.Add(-time.Minute))}, manifestEr: errors.New("db")},
	}
	for name, fs := range cases {
		t.Run(name, func(t *testing.T) {
			reg := metrics.NewRegistry()
			sink := metrics.NewSink(reg)
			sink.LiveManifestAgeSeconds.Set(123) // sentinel prior value

			// Exactly the production update rule from collectMetrics.
			age, ok := liveManifestAgeSeconds(context.Background(), fs, now)
			if ok {
				sink.LiveManifestAgeSeconds.Set(age)
			}

			if ok {
				t.Fatalf("ok = true (age=%v), want false for an injected query failure", age)
			}
			var sb stringsBuilder
			if _, err := reg.WriteTo(&sb); err != nil {
				t.Fatal(err)
			}
			if !contains(sb.String(), "media_agent_live_manifest_age_seconds 123") {
				t.Fatalf("gauge changed on query failure; want sentinel 123 retained:\n%s", sb.String())
			}
		})
	}
}

type stringsBuilder struct{ b []byte }

func (s *stringsBuilder) Write(p []byte) (int, error) { s.b = append(s.b, p...); return len(p), nil }
func (s *stringsBuilder) String() string              { return string(s.b) }

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
