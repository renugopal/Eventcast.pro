package controlplane

import (
	"sync"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

func TestStreamKeyCacheGetMissingReturnsFalse(t *testing.T) {
	c := NewStreamKeyCache()
	if _, ok := c.Get("no-such-event"); ok {
		t.Error("Get() ok = true for an unpopulated cache, want false")
	}
}

func TestStreamKeyCacheReplaceIsVisibleImmediately(t *testing.T) {
	c := NewStreamKeyCache()
	c.Replace(map[string]logging.Secret{"event-1": "key-1"})

	got, ok := c.Get("event-1")
	if !ok || got.Reveal() != "key-1" {
		t.Errorf("Get() = (%v, %v), want (key-1, true)", got, ok)
	}

	c.Replace(map[string]logging.Secret{"event-2": "key-2"})
	if _, ok := c.Get("event-1"); ok {
		t.Error("expected event-1 to be gone after Replace() with a new map")
	}
	got2, ok := c.Get("event-2")
	if !ok || got2.Reveal() != "key-2" {
		t.Errorf("Get(event-2) = (%v, %v), want (key-2, true)", got2, ok)
	}
}

func TestStreamKeyCacheConcurrentAccess(t *testing.T) {
	c := NewStreamKeyCache()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			c.Replace(map[string]logging.Secret{"event": "key"})
		}(i)
		go func(i int) {
			defer wg.Done()
			c.Get("event")
		}(i)
	}
	wg.Wait()
}
