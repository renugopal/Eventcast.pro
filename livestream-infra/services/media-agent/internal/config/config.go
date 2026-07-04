// Package config loads and validates Media Agent startup configuration
// from environment variables. Configuration is validated eagerly so the
// process fails fast with a clear, non-secret error instead of starting
// in a partially-configured state.
package config

import (
	"fmt"
	"net"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

// Supported environment variables. This is the complete set for the
// current baseline; no other environment variables are read.
const (
	EnvNodeID   = "EVENTCAST_NODE_ID"
	EnvHTTPAddr = "EVENTCAST_MEDIA_AGENT_HTTP_ADDR"
	EnvLogLevel = "EVENTCAST_LOG_LEVEL"

	// EnvDBPath is the absolute path to the SQLite WAL-backed durable
	// database file (assignment cache, ingest sessions, segment jobs).
	EnvDBPath = "EVENTCAST_DB_PATH"
	// EnvSpoolRoot is the absolute path to the Media Agent's protected
	// durable spool root (02_V1_ARCHITECTURE_SPEC.md "Local staging and
	// durable spool").
	EnvSpoolRoot = "EVENTCAST_SPOOL_ROOT"
	// EnvSRSHLSRoot is the absolute path to the SRS HLS staging root that
	// on_hls callback file paths must resolve inside of.
	EnvSRSHLSRoot = "EVENTCAST_SRS_HLS_ROOT"
	// EnvAssignmentSeedPath is an optional absolute path to a JSON file
	// of cached event assignments, imported at startup. Empty disables
	// seeding; a later milestone's control-plane client is expected to
	// populate the cache continuously instead.
	EnvAssignmentSeedPath = "EVENTCAST_ASSIGNMENT_SEED_PATH"
	// EnvReconcileInterval is the periodic reconciliation interval, e.g.
	// "30s". Must be a positive Go duration.
	EnvReconcileInterval = "EVENTCAST_RECONCILE_INTERVAL"
	// EnvSessionStaleTimeout bounds how long an ingest session may remain
	// "starting"/"active" with no segment activity before periodic
	// reconciliation marks it disconnected, freeing the event for a new
	// publisher after an ungraceful disconnect that SRS never reported
	// via on_unpublish.
	EnvSessionStaleTimeout = "EVENTCAST_SESSION_STALE_TIMEOUT"
	// EnvDBBusyTimeout is the SQLite busy_timeout applied to every
	// connection, bounding how long a writer waits for a lock held by
	// another connection before failing.
	EnvDBBusyTimeout = "EVENTCAST_DB_BUSY_TIMEOUT"
)

// Defaults. The default HTTP bind address is loopback-only, matching
// the internal callback address used elsewhere in the architecture
// (see 02_V1_ARCHITECTURE_SPEC.md SRS http_hooks example).
const (
	DefaultHTTPAddr = "127.0.0.1:8085"
	DefaultLogLevel = "info"

	DefaultReconcileInterval   = 30 * time.Second
	DefaultSessionStaleTimeout = 180 * time.Second
	DefaultDBBusyTimeout       = 5 * time.Second
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

	DBPath              string
	SpoolRoot           string
	SRSHLSRoot          string
	AssignmentSeedPath  string
	ReconcileInterval   time.Duration
	SessionStaleTimeout time.Duration
	DBBusyTimeout       time.Duration
}

// Load reads configuration using getenv (normally os.Getenv), applies
// defaults, and validates the result. getenv is injected so callers can
// test configuration handling without mutating process environment.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		NodeID:   strings.TrimSpace(getenv(EnvNodeID)),
		HTTPAddr: strings.TrimSpace(getenv(EnvHTTPAddr)),
		LogLevel: strings.TrimSpace(getenv(EnvLogLevel)),

		DBPath:             strings.TrimSpace(getenv(EnvDBPath)),
		SpoolRoot:          strings.TrimSpace(getenv(EnvSpoolRoot)),
		SRSHLSRoot:         strings.TrimSpace(getenv(EnvSRSHLSRoot)),
		AssignmentSeedPath: strings.TrimSpace(getenv(EnvAssignmentSeedPath)),
	}

	if cfg.HTTPAddr == "" {
		cfg.HTTPAddr = DefaultHTTPAddr
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = DefaultLogLevel
	}

	var err error
	cfg.ReconcileInterval, err = parseDurationOrDefault(getenv(EnvReconcileInterval), DefaultReconcileInterval)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvReconcileInterval, err)
	}
	cfg.SessionStaleTimeout, err = parseDurationOrDefault(getenv(EnvSessionStaleTimeout), DefaultSessionStaleTimeout)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvSessionStaleTimeout, err)
	}
	cfg.DBBusyTimeout, err = parseDurationOrDefault(getenv(EnvDBBusyTimeout), DefaultDBBusyTimeout)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvDBBusyTimeout, err)
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func parseDurationOrDefault(raw string, def time.Duration) (time.Duration, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, err
	}
	if d <= 0 {
		return 0, fmt.Errorf("must be positive, got %s", raw)
	}
	return d, nil
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

	if err := validateRequiredAbsPath(EnvDBPath, c.DBPath); err != nil {
		return err
	}
	if err := validateRequiredAbsPath(EnvSpoolRoot, c.SpoolRoot); err != nil {
		return err
	}
	if err := validateRequiredAbsPath(EnvSRSHLSRoot, c.SRSHLSRoot); err != nil {
		return err
	}
	if c.AssignmentSeedPath != "" {
		if err := validateRequiredAbsPath(EnvAssignmentSeedPath, c.AssignmentSeedPath); err != nil {
			return err
		}
	}

	// The spool root and HLS staging root must be distinct, non-nested
	// directories: the agent must never treat SRS-owned staging output
	// as part of its own protected spool (or vice versa), and cleanup in
	// one root must never reach into the other.
	if pathsOverlap(c.SpoolRoot, c.SRSHLSRoot) {
		return fmt.Errorf("config: %s and %s must not be equal or nested paths", EnvSpoolRoot, EnvSRSHLSRoot)
	}
	// The database file must not live inside either durable-media root:
	// spool/HLS-root reconciliation scans must never encounter the
	// database file itself, and database backup/rotation must never
	// disturb captured media.
	if pathContains(c.SpoolRoot, c.DBPath) || pathContains(c.SRSHLSRoot, c.DBPath) {
		return fmt.Errorf("config: %s must not be located inside %s or %s", EnvDBPath, EnvSpoolRoot, EnvSRSHLSRoot)
	}
	// Same reasoning for the optional assignment seed file: it must never
	// be mistaken for an orphaned spool file by reconciliation's spool
	// scan, and it is a distinct, config-owned artifact, not media.
	if c.AssignmentSeedPath != "" && (pathContains(c.SpoolRoot, c.AssignmentSeedPath) || pathContains(c.SRSHLSRoot, c.AssignmentSeedPath)) {
		return fmt.Errorf("config: %s must not be located inside %s or %s", EnvAssignmentSeedPath, EnvSpoolRoot, EnvSRSHLSRoot)
	}

	return nil
}

// validateRequiredAbsPath rejects empty, relative, and traversal-bearing
// paths. It intentionally does not touch the filesystem: existence and
// writability are runtime concerns (see internal/health readiness),
// not startup configuration-shape concerns.
func validateRequiredAbsPath(envVar, value string) error {
	if value == "" {
		return fmt.Errorf("config: %s is required", envVar)
	}
	if !filepath.IsAbs(value) {
		return fmt.Errorf("config: %s must be an absolute path", envVar)
	}
	cleaned := filepath.Clean(value)
	if cleaned != value {
		return fmt.Errorf("config: %s must be a clean absolute path (no '.', '..', or trailing/duplicate separators)", envVar)
	}
	if cleaned == string(filepath.Separator) {
		return fmt.Errorf("config: %s must not be the filesystem root", envVar)
	}
	return nil
}

// pathsOverlap reports whether a and b are equal or one is an ancestor
// directory of the other. Both inputs are assumed already validated as
// clean absolute paths.
func pathsOverlap(a, b string) bool {
	return a == b || pathContains(a, b) || pathContains(b, a)
}

// pathContains reports whether candidate is root itself or lives inside
// root, using path-segment comparison (not a string prefix check, which
// would incorrectly treat "/data" as containing "/data-other").
func pathContains(root, candidate string) bool {
	if root == candidate {
		return true
	}
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
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
