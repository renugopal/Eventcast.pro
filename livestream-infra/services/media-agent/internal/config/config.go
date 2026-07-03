// Package config loads and validates Media Agent startup configuration
// from environment variables. Configuration is validated eagerly so the
// process fails fast with a clear, non-secret error instead of starting
// in a partially-configured state.
package config

import (
	"fmt"
	"net"
	"strings"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

// Supported environment variables. This is the complete set for the
// Phase 0 skeleton; no other environment variables are read.
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

	if _, _, err := net.SplitHostPort(c.HTTPAddr); err != nil {
		return fmt.Errorf("config: %s is not a valid host:port address", EnvHTTPAddr)
	}

	if _, err := logging.ParseLevel(c.LogLevel); err != nil {
		return fmt.Errorf("config: %s is not a recognized log level", EnvLogLevel)
	}

	return nil
}
