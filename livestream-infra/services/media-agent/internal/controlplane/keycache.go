package controlplane

import (
	"sync"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

// StreamKeyCache is a concurrency-safe, continuously-updated cache of raw
// YouTube stream keys, keyed by event id. It implements
// internal/srs.YouTubeKeyStore. Unlike the durable assignment cache, raw
// stream keys are never written to SQLite (see
// migrations/0002_media_delivery.sql and internal/store.Assignment); this
// cache is their only runtime home, rebuilt from scratch on every
// successful sync via Replace.
type StreamKeyCache struct {
	mu   sync.RWMutex
	keys map[string]logging.Secret
}

// NewStreamKeyCache returns an empty StreamKeyCache.
func NewStreamKeyCache() *StreamKeyCache {
	return &StreamKeyCache{keys: make(map[string]logging.Secret)}
}

// Get implements internal/srs.YouTubeKeyStore.
func (c *StreamKeyCache) Get(eventID string) (logging.Secret, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	key, ok := c.keys[eventID]
	return key, ok
}

// Replace atomically swaps the entire cache contents. The syncer calls
// this after every successful sync with exactly the set of
// (event_id -> stream key) pairs the latest control-plane response
// authorized, so a key revoked or rotated by the control plane stops
// being served as soon as the next sync completes.
func (c *StreamKeyCache) Replace(keys map[string]logging.Secret) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.keys = keys
}
