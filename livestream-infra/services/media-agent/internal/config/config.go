// Package config loads and validates Media Agent startup configuration
// from environment variables. Configuration is validated eagerly so the
// process fails fast with a clear, non-secret error instead of starting
// in a partially-configured state.
package config

import (
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

// Supported environment variables. This is the complete set for the
// current baseline; no other environment variables are read.
const (
	EnvNodeID   = "EVENTCAST_NODE_ID"
	EnvHTTPAddr = "EVENTCAST_MEDIA_AGENT_HTTP_ADDR"
	EnvLogLevel = "EVENTCAST_LOG_LEVEL"
)

// Defaults. The default HTTP bind address is loopback-only, matching
// the internal callback address used elsewhere in the architecture
// (see 02_V1_ARCHITECTURE_SPEC.md SRS http_hooks example).
const (
	DefaultHTTPAddr = "127.0.0.1:8085"
	DefaultLogLevel = "info"
)

// maxNodeIDLength is a sanity bound, not a business rule; it exists so
// a misconfigured environment fails fast instead of producing an
// oversized log field or metric label later.
const maxNodeIDLength = 128

// Config holds validated Media Agent startup configuration. It carries
// no secret fields; secret-bearing configuration (provider credentials,
// stream tokens) belongs to later phases and must use logging.Secret
// when introduced.
type Config struct {
	NodeID   string
	HTTPAddr string
	LogLevel string
}

// Load reads configuration using getenv (normally os.Getenv), applies
// defaults, and validates the result. getenv is injected so callers can
// test configuration handling without mutating process environment.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		NodeID:   strings.TrimSpace(getenv(EnvNodeID)),
		HTTPAddr: strings.TrimSpace(getenv(EnvHTTPAddr)),
		LogLevel: strings.TrimSpace(getenv(EnvLogLevel)),
	}

	if cfg.HTTPAddr == "" {
		cfg.HTTPAddr = DefaultHTTPAddr
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = DefaultLogLevel
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Validate checks that every field is present and well-formed. Errors
// name the offending environment variable but never echo a value, so
// this remains safe even if a future field carries sensitive data.
func (c Config) Validate() error {
	if c.NodeID == "" {
		return fmt.Errorf("config: %s is required", EnvNodeID)
	}
	if len(c.NodeID) > maxNodeIDLength {
		return fmt.Errorf("config: %s exceeds maximum length of %d", EnvNodeID, maxNodeIDLength)
	}
	if !isSafeNodeID(c.NodeID) {
		return fmt.Errorf("config: %s may contain only ASCII letters, digits, '.', '_', and '-'", EnvNodeID)
	}

	_, port, err := net.SplitHostPort(c.HTTPAddr)
	if err != nil {
		return fmt.Errorf("config: %s is not a valid host:port address", EnvHTTPAddr)
	}
	// SplitHostPort alone accepts empty, non-numeric, signed, and
	// out-of-range ports; an explicit digits-only port keeps the bind
	// deterministic (port 0 would select an ephemeral port at startup).
	if n, err := strconv.ParseUint(port, 10, 16); err != nil || n == 0 {
		return fmt.Errorf("config: %s port must be a number between 1 and 65535", EnvHTTPAddr)
	}

	if _, err := logging.ParseLevel(c.LogLevel); err != nil {
		return fmt.Errorf("config: %s is not a recognized log level", EnvLogLevel)
	}

	return nil
}

// isSafeNodeID reports whether the node identifier uses only characters
// that are safe to embed in log fields, metric labels, and filesystem
// paths in later phases. Multi-byte characters fail the per-byte check,
// which correctly restricts the identifier to printable ASCII.
func isSafeNodeID(id string) bool {
	for i := 0; i < len(id); i++ {
		b := id[i]
		switch {
		case b >= 'a' && b <= 'z':
		case b >= 'A' && b <= 'Z':
		case b >= '0' && b <= '9':
		case b == '.' || b == '_' || b == '-':
		default:
			return false
		}
	}
	return true
}
