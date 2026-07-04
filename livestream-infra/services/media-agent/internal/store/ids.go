package store

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// newID returns a random, non-secret, URL-safe identifier suitable for
// session IDs and similar internal identifiers. It is not a
// cryptographic secret; its only requirement is a vanishingly small
// collision probability, so 16 bytes (128 bits) of randomness is ample.
func newID(prefix string) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("store: generate id: %w", err)
	}
	return prefix + "_" + hex.EncodeToString(buf), nil
}
