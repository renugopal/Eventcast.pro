// Package config loads and validates Media Agent startup configuration
// from environment variables. Configuration is validated eagerly so the
// process fails fast with a clear, non-secret error instead of starting
// in a partially-configured state.
package config

import (
	"fmt"
	"net"
	"net/url"
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
	// EnvAllowSeedEnabledAssignments is a dev/test-only opt-in. A seed file
	// is operator-supplied local disk content, not the authenticated,
	// operator-activated control plane — so by default (this variable
	// unset or false), any seed-file row with enabled: true has that flag
	// forced to false at import (store.SanitizeSeedAssignments), and a real
	// deployment can never be self-authorized to accept a publish purely by
	// the presence of a seed file. Set true only for isolated dev/test
	// fixtures (e.g. this package's own integration test scripts under
	// infra/media-node/compose/) that intentionally seed an already-enabled
	// assignment to exercise on_publish without a control plane.
	EnvAllowSeedEnabledAssignments = "EVENTCAST_ALLOW_SEED_ENABLED_ASSIGNMENTS"
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

	// R2 object storage. The whole upload/manifest/VOD/retention
	// subsystem is optional at the configuration level: if
	// EnvR2Bucket is empty, it stays disabled (a warning is logged at
	// startup) so an existing deployment's environment that predates
	// this milestone keeps starting unchanged. Once EnvR2Bucket is
	// set, EnvR2Endpoint/EnvR2AccessKeyID/EnvR2SecretAccessKey become
	// required.
	EnvR2Endpoint            = "EVENTCAST_R2_ENDPOINT"
	EnvR2Region              = "EVENTCAST_R2_REGION"
	EnvR2Bucket              = "EVENTCAST_R2_BUCKET"
	EnvR2AccessKeyID         = "EVENTCAST_R2_ACCESS_KEY_ID"
	EnvR2SecretAccessKey     = "EVENTCAST_R2_SECRET_ACCESS_KEY"
	EnvR2ObjectPrefix        = "EVENTCAST_R2_OBJECT_PREFIX"
	EnvR2PublicBaseURL       = "EVENTCAST_R2_PUBLIC_BASE_URL"
	EnvR2UploadConcurrency   = "EVENTCAST_R2_UPLOAD_CONCURRENCY"
	EnvR2RetryBaseDelay      = "EVENTCAST_R2_RETRY_BASE_DELAY"
	EnvR2RetryMaxDelay       = "EVENTCAST_R2_RETRY_MAX_DELAY"
	EnvR2RequestTimeout      = "EVENTCAST_R2_REQUEST_TIMEOUT"
	EnvR2UploadLeaseDuration = "EVENTCAST_R2_UPLOAD_LEASE_DURATION"
	// EnvR2InsecureSkipVerify must remain false in production (an
	// R2 custom domain always terminates valid TLS); it exists only so
	// isolated integration tests can point the same client at a local
	// S3-compatible service using a self-signed certificate. A plain
	// http:// EnvR2Endpoint (as tests normally use against a local
	// container) does not need this flag at all.
	EnvR2InsecureSkipVerify = "EVENTCAST_R2_INSECURE_SKIP_VERIFY"

	// Backblaze B2 authoritative VOD archival. Two deliberately separate
	// concepts, unlike the single-flag R2 block above:
	//
	//   B2Configured       - the endpoint/region/bucket/credential set is
	//                        present and valid.
	//   B2ArchivalEnabled  - an explicit operational switch (EnvB2ArchiveEnabled,
	//                        default false) authorizing REAL event recordings
	//                        to be archived to B2.
	//
	// Configuration presence must never by itself start archiving production
	// recordings: a node may hold valid B2 credentials purely so the isolated
	// connectivity test can run, while real archival stays off. Setting
	// EnvB2ArchiveEnabled without a complete configuration is a startup error
	// rather than a silently disabled subsystem.
	EnvB2Endpoint        = "EVENTCAST_B2_ENDPOINT"
	EnvB2Region          = "EVENTCAST_B2_REGION"
	EnvB2Bucket          = "EVENTCAST_B2_BUCKET"
	EnvB2AccessKeyID     = "EVENTCAST_B2_ACCESS_KEY_ID"
	EnvB2SecretAccessKey = "EVENTCAST_B2_SECRET_ACCESS_KEY"
	EnvB2ObjectPrefix    = "EVENTCAST_B2_OBJECT_PREFIX"
	// EnvB2ArchiveEnabled gates production archival only. It defaults to
	// false and must be set deliberately.
	EnvB2ArchiveEnabled = "EVENTCAST_B2_ARCHIVE_ENABLED"
	EnvB2RequestTimeout = "EVENTCAST_B2_REQUEST_TIMEOUT"
	EnvB2RetryBaseDelay = "EVENTCAST_B2_RETRY_BASE_DELAY"
	EnvB2RetryMaxDelay  = "EVENTCAST_B2_RETRY_MAX_DELAY"
	// EnvB2ArchiveInterval is the background archival worker's tick;
	// EnvB2ReportInterval is the durable control-plane reporter's tick.
	EnvB2ArchiveInterval = "EVENTCAST_B2_ARCHIVE_INTERVAL"
	EnvB2ReportInterval  = "EVENTCAST_B2_REPORT_INTERVAL"
	// EnvB2InsecureSkipVerify mirrors EnvR2InsecureSkipVerify and must stay
	// false in production; it exists only so isolated tests can target a
	// local S3-compatible container with a self-signed certificate.
	EnvB2InsecureSkipVerify = "EVENTCAST_B2_INSECURE_SKIP_VERIFY"

	// EnvDVRWindow is the live-manifest retention window. Production
	// must not change this from the ADR-004 default without a new
	// decision record; it is exposed as configuration only so isolated
	// tests can use a short, deterministic window instead of waiting
	// out fifteen real minutes.
	EnvDVRWindow = "EVENTCAST_DVR_WINDOW"
	// EnvLocalRetentionDelay bounds how long a confirmed, VOD-finalized
	// segment's local spool copy is kept before the retention worker
	// deletes it (02_V1_ARCHITECTURE_SPEC.md "Retention and deletion":
	// "The default local safety period after VOD finalization is 24
	// hours").
	EnvLocalRetentionDelay = "EVENTCAST_LOCAL_RETENTION_DELAY"
	// EnvManifestRebuildInterval is the periodic backstop rebuild
	// interval covering delayed/out-of-order upload completion; the
	// primary rebuild trigger is every upload confirmation.
	EnvManifestRebuildInterval = "EVENTCAST_MANIFEST_REBUILD_INTERVAL"
	// EnvCleanupInterval is the retention worker's periodic interval.
	EnvCleanupInterval = "EVENTCAST_CLEANUP_INTERVAL"

	// YouTube relay. Per event/session, never globally required;
	// these bound the ffmpeg binary location and restart policy only.
	EnvYouTubeFFmpegPath         = "EVENTCAST_YOUTUBE_FFMPEG_PATH"
	EnvYouTubeRestartMaxAttempts = "EVENTCAST_YOUTUBE_RESTART_MAX_ATTEMPTS"
	EnvYouTubeRestartBackoffBase = "EVENTCAST_YOUTUBE_RESTART_BACKOFF_BASE"
	EnvYouTubeRestartBackoffMax  = "EVENTCAST_YOUTUBE_RESTART_BACKOFF_MAX"
	// EnvYouTubeSourceRTMPBaseURL is the local RTMP endpoint the relay
	// pulls from (this Media Agent's own SRS instance), combined with
	// "/live/{ingest_id}" (the fixed app name every existing integration
	// script and the pinned srs.conf already use). It defaults to a
	// same-host loopback address; the Compose deployment overrides it to
	// the "srs" service hostname on the private media-node network.
	EnvYouTubeSourceRTMPBaseURL = "EVENTCAST_YOUTUBE_SOURCE_RTMP_BASE_URL"
	// EnvYouTubeSourceReadyTimeout bounds the uncounted retry window
	// (internal/relay.Config.SourceReadyTimeout) a fresh relay gets to
	// find its local source genuinely readable before failures start
	// spending the restart budget. This absorbs the short race between
	// SRS accepting a publish (which is what starts the relay) and SRS
	// having enough of that stream buffered to serve back out.
	EnvYouTubeSourceReadyTimeout = "EVENTCAST_YOUTUBE_SOURCE_READY_TIMEOUT"
	// EnvYouTubeSourceReadyMinRunDuration is how long ffmpeg must run
	// before its exit counts as a genuine failure rather than a
	// source-not-ready symptom (internal/relay.Config.SourceReadyMinRunDuration).
	EnvYouTubeSourceReadyMinRunDuration = "EVENTCAST_YOUTUBE_SOURCE_READY_MIN_RUN_DURATION"
	// EnvYouTubeSourceReadyRetryInterval is the fixed delay between
	// uncounted retries while still inside EnvYouTubeSourceReadyTimeout's
	// window (internal/relay.Config.SourceReadyRetryInterval).
	EnvYouTubeSourceReadyRetryInterval = "EVENTCAST_YOUTUBE_SOURCE_READY_RETRY_INTERVAL"

	// Control-plane assignment synchronization (internal/controlplane).
	// The whole subsystem is optional at the configuration level, exactly
	// like R2 above: if EnvControlPlaneBaseURL is empty, it stays
	// disabled and the agent relies solely on EnvAssignmentSeedPath, so
	// an existing deployment's environment that predates this milestone
	// keeps starting unchanged. Once EnvControlPlaneBaseURL is set,
	// EnvControlPlaneNodeToken becomes required, and the local seed file
	// (if also configured) is imported once at startup purely as a
	// bootstrap - the first successful sync applies control-plane state
	// on top via ApplyControlPlaneAssignments, and periodic sync
	// thereafter is always the source of truth; a seed row is never
	// re-applied and can never override fresher control-plane state.
	EnvControlPlaneBaseURL   = "EVENTCAST_CONTROLPLANE_BASE_URL"
	EnvControlPlaneNodeToken = "EVENTCAST_CONTROLPLANE_NODE_TOKEN"
	// EnvControlPlaneRequestTimeout bounds each individual sync fetch
	// attempt, independent of EnvControlPlaneSyncInterval.
	EnvControlPlaneRequestTimeout = "EVENTCAST_CONTROLPLANE_REQUEST_TIMEOUT"
	// EnvControlPlaneSyncInterval is the steady-state period between
	// successful syncs; a failed sync instead follows exponential backoff
	// with jitter bounded by EnvControlPlaneBackoffBase/Max
	// (internal/controlplane.Syncer.Run).
	EnvControlPlaneSyncInterval = "EVENTCAST_CONTROLPLANE_SYNC_INTERVAL"
	EnvControlPlaneBackoffBase  = "EVENTCAST_CONTROLPLANE_BACKOFF_BASE"
	EnvControlPlaneBackoffMax   = "EVENTCAST_CONTROLPLANE_BACKOFF_MAX"
	// EnvControlPlaneStaleWarnAfter/StaleCriticalAfter classify how long
	// since the last successful sync before the cached assignments are
	// considered stale (informational: exposed via metrics/logs only) or
	// critically stale (also fails the /readyz control_plane_cache
	// check, see cmd/media-agent/main.go). The agent keeps authorizing
	// already-cached, unexpired publishers throughout either state
	// (03_DATA_MODEL_AND_API_CONTRACTS.md "Assignment synchronization").
	EnvControlPlaneStaleWarnAfter     = "EVENTCAST_CONTROLPLANE_STALE_WARN_AFTER"
	EnvControlPlaneStaleCriticalAfter = "EVENTCAST_CONTROLPLANE_STALE_CRITICAL_AFTER"

	// EnvOperatorAPIToken authenticates the internal, state-changing
	// operator endpoints (VOD finalize trigger, VOD-gap resolution - see
	// internal/operatorauth). Left empty, these endpoints stay reachable
	// without authentication (matching their pre-milestone behavior) but
	// the agent logs a loud startup warning; production deployments must
	// set this (see infra/media-node's deployment documentation).
	EnvOperatorAPIToken = "EVENTCAST_OPERATOR_API_TOKEN"

	// Rate limiting and abuse protection (internal/ratelimit) applied to
	// every HTTP handler this agent exposes beyond loopback-only health
	// checks: SRS callbacks and the operator endpoints.
	EnvRateLimitRPS   = "EVENTCAST_RATE_LIMIT_RPS"
	EnvRateLimitBurst = "EVENTCAST_RATE_LIMIT_BURST"
	// EnvTrustedProxyEnabled must only be set true when this agent sits
	// behind a reverse proxy the deployment controls, which itself
	// strips any client-supplied X-Real-IP before setting its own
	// (02_V1_ARCHITECTURE_SPEC.md "Security requirements" / this
	// milestone's hardening requirement: "Do not trust spoofable
	// forwarding headers unless the deployment explicitly establishes a
	// trusted proxy boundary"). When false (the default), the rate
	// limiter and access logs key strictly on the TCP connection's
	// remote address.
	EnvTrustedProxyEnabled = "EVENTCAST_TRUSTED_PROXY_ENABLED"
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

	DefaultR2Region              = "auto"
	DefaultR2UploadConcurrency   = 4
	DefaultR2RetryBaseDelay      = 500 * time.Millisecond
	DefaultR2RetryMaxDelay       = 30 * time.Second
	DefaultR2RequestTimeout      = 20 * time.Second
	DefaultR2UploadLeaseDuration = 30 * time.Second

	// B2 archival defaults. There is deliberately no default region: unlike
	// R2's "auto", Backblaze's S3 endpoint is region-bound and its SigV4
	// signature is region-specific, so guessing one would produce confusing
	// authentication failures instead of a clear configuration error.
	// The archive/report intervals keep both background loops unobtrusive;
	// archival is not latency-sensitive and must never hold an operator
	// finalize request open.
	DefaultB2RequestTimeout  = 60 * time.Second
	DefaultB2RetryBaseDelay  = 1 * time.Second
	DefaultB2RetryMaxDelay   = 60 * time.Second
	DefaultB2ArchiveInterval = 30 * time.Second
	DefaultB2ReportInterval  = 30 * time.Second

	// DefaultDVRWindow is ADR-004's fifteen-minute (~900 second) live
	// DVR window. Production must not override this default without a
	// new decision record; EnvDVRWindow exists so isolated integration
	// tests can use a short, deterministic window instead.
	DefaultDVRWindow = 900 * time.Second
	// DefaultLocalRetentionDelay matches 02_V1_ARCHITECTURE_SPEC.md
	// "Retention and deletion": "The default local safety period after
	// VOD finalization is 24 hours."
	DefaultLocalRetentionDelay     = 24 * time.Hour
	DefaultManifestRebuildInterval = 5 * time.Second
	DefaultCleanupInterval         = 15 * time.Minute

	DefaultYouTubeFFmpegPath         = "ffmpeg"
	DefaultYouTubeRestartMaxAttempts = 5
	DefaultYouTubeRestartBackoffBase = 2 * time.Second
	DefaultYouTubeRestartBackoffMax  = 60 * time.Second
	DefaultYouTubeSourceRTMPBaseURL  = "rtmp://127.0.0.1:1935"
	// DefaultYouTubeSourceReadyTimeout is a generous but bounded window
	// for the local SRS source to become genuinely readable after a
	// publish is accepted - field testing observed this race resolving
	// within a couple of seconds; this leaves ample margin under load
	// without masking a truly broken relay for long.
	DefaultYouTubeSourceReadyTimeout        = 20 * time.Second
	DefaultYouTubeSourceReadyMinRunDuration = 2 * time.Second
	DefaultYouTubeSourceReadyRetryInterval  = 500 * time.Millisecond

	DefaultControlPlaneRequestTimeout     = 10 * time.Second
	DefaultControlPlaneSyncInterval       = 30 * time.Second
	DefaultControlPlaneBackoffBase        = 2 * time.Second
	DefaultControlPlaneBackoffMax         = 5 * time.Minute
	DefaultControlPlaneStaleWarnAfter     = 5 * time.Minute
	DefaultControlPlaneStaleCriticalAfter = 20 * time.Minute

	DefaultRateLimitRPS   = 20
	DefaultRateLimitBurst = 40
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

	DBPath                      string
	SpoolRoot                   string
	SRSHLSRoot                  string
	AssignmentSeedPath          string
	AllowSeedEnabledAssignments bool
	ReconcileInterval           time.Duration
	SessionStaleTimeout         time.Duration
	DBBusyTimeout               time.Duration

	// R2Enabled reports whether R2Bucket was configured, gating the
	// entire upload/manifest/VOD/retention subsystem. When false, every
	// other R2* field is its zero value and must not be used.
	R2Enabled             bool
	R2Endpoint            string
	R2Region              string
	R2Bucket              string
	R2AccessKeyID         string
	R2SecretAccessKey     logging.Secret
	R2ObjectPrefix        string
	R2PublicBaseURL       string
	R2UploadConcurrency   int
	R2RetryBaseDelay      time.Duration
	R2RetryMaxDelay       time.Duration
	R2RequestTimeout      time.Duration
	R2UploadLeaseDuration time.Duration
	R2InsecureSkipVerify  bool

	// B2Configured reports whether the complete B2 configuration set is
	// present and valid. It authorizes the isolated connectivity-test path
	// ONLY - it never by itself archives a production recording.
	B2Configured bool
	// B2ArchivalEnabled reports whether real event recordings may be
	// archived to B2. False unless EnvB2ArchiveEnabled is explicitly set
	// true AND B2Configured holds.
	B2ArchivalEnabled    bool
	B2Endpoint           string
	B2Region             string
	B2Bucket             string
	B2AccessKeyID        string
	B2SecretAccessKey    logging.Secret
	B2ObjectPrefix       string
	B2RequestTimeout     time.Duration
	B2RetryBaseDelay     time.Duration
	B2RetryMaxDelay      time.Duration
	B2ArchiveInterval    time.Duration
	B2ReportInterval     time.Duration
	B2InsecureSkipVerify bool
	// b2ArchiveEnabledRequested records the raw operator intent, before it
	// is ANDed with B2Configured, so Validate can fail fast on
	// "enabled but not configured" instead of silently disabling.
	b2ArchiveEnabledRequested bool

	DVRWindow               time.Duration
	LocalRetentionDelay     time.Duration
	ManifestRebuildInterval time.Duration
	CleanupInterval         time.Duration

	YouTubeFFmpegPath                string
	YouTubeRestartMaxAttempts        int
	YouTubeRestartBackoffBase        time.Duration
	YouTubeRestartBackoffMax         time.Duration
	YouTubeSourceRTMPBaseURL         string
	YouTubeSourceReadyTimeout        time.Duration
	YouTubeSourceReadyMinRunDuration time.Duration
	YouTubeSourceReadyRetryInterval  time.Duration

	// ControlPlaneEnabled reports whether ControlPlaneBaseURL was
	// configured, gating the entire continuous assignment-sync
	// subsystem. When false, every other ControlPlane* field is its zero
	// value and must not be used; the agent relies solely on
	// AssignmentSeedPath, exactly as it did before this milestone.
	ControlPlaneEnabled            bool
	ControlPlaneBaseURL            string
	ControlPlaneNodeToken          logging.Secret
	ControlPlaneRequestTimeout     time.Duration
	ControlPlaneSyncInterval       time.Duration
	ControlPlaneBackoffBase        time.Duration
	ControlPlaneBackoffMax         time.Duration
	ControlPlaneStaleWarnAfter     time.Duration
	ControlPlaneStaleCriticalAfter time.Duration

	// OperatorAPIToken is empty by default; see EnvOperatorAPIToken.
	OperatorAPIToken logging.Secret

	RateLimitRPS        float64
	RateLimitBurst      int
	TrustedProxyEnabled bool
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
	cfg.AllowSeedEnabledAssignments, err = parseBoolOrDefault(getenv(EnvAllowSeedEnabledAssignments), false)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid boolean: %w", EnvAllowSeedEnabledAssignments, err)
	}
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

	cfg.R2Endpoint = strings.TrimSpace(getenv(EnvR2Endpoint))
	cfg.R2Region = strings.TrimSpace(getenv(EnvR2Region))
	if cfg.R2Region == "" {
		cfg.R2Region = DefaultR2Region
	}
	cfg.R2Bucket = strings.TrimSpace(getenv(EnvR2Bucket))
	cfg.R2Enabled = cfg.R2Bucket != ""
	cfg.R2AccessKeyID = strings.TrimSpace(getenv(EnvR2AccessKeyID))
	cfg.R2SecretAccessKey = logging.Secret(getenv(EnvR2SecretAccessKey))
	cfg.R2ObjectPrefix = strings.TrimSpace(getenv(EnvR2ObjectPrefix))
	cfg.R2PublicBaseURL = strings.TrimSpace(getenv(EnvR2PublicBaseURL))

	cfg.R2UploadConcurrency, err = parseIntOrDefault(getenv(EnvR2UploadConcurrency), DefaultR2UploadConcurrency)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid integer: %w", EnvR2UploadConcurrency, err)
	}
	cfg.R2RetryBaseDelay, err = parseDurationOrDefault(getenv(EnvR2RetryBaseDelay), DefaultR2RetryBaseDelay)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvR2RetryBaseDelay, err)
	}
	cfg.R2RetryMaxDelay, err = parseDurationOrDefault(getenv(EnvR2RetryMaxDelay), DefaultR2RetryMaxDelay)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvR2RetryMaxDelay, err)
	}
	cfg.R2RequestTimeout, err = parseDurationOrDefault(getenv(EnvR2RequestTimeout), DefaultR2RequestTimeout)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvR2RequestTimeout, err)
	}
	cfg.R2UploadLeaseDuration, err = parseDurationOrDefault(getenv(EnvR2UploadLeaseDuration), DefaultR2UploadLeaseDuration)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvR2UploadLeaseDuration, err)
	}
	cfg.R2InsecureSkipVerify, err = parseBoolOrDefault(getenv(EnvR2InsecureSkipVerify), false)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid boolean: %w", EnvR2InsecureSkipVerify, err)
	}

	cfg.B2Endpoint = strings.TrimSpace(getenv(EnvB2Endpoint))
	cfg.B2Region = strings.TrimSpace(getenv(EnvB2Region))
	cfg.B2Bucket = strings.TrimSpace(getenv(EnvB2Bucket))
	cfg.B2AccessKeyID = strings.TrimSpace(getenv(EnvB2AccessKeyID))
	cfg.B2SecretAccessKey = logging.Secret(getenv(EnvB2SecretAccessKey))
	cfg.B2ObjectPrefix = strings.TrimSpace(getenv(EnvB2ObjectPrefix))
	// Configured requires the COMPLETE set, not merely a bucket name - a
	// half-configured B2 client could otherwise pass as "configured" and
	// then fail at the first request.
	cfg.B2Configured = cfg.B2Endpoint != "" && cfg.B2Region != "" && cfg.B2Bucket != "" &&
		cfg.B2AccessKeyID != "" && cfg.B2SecretAccessKey.Reveal() != ""

	cfg.b2ArchiveEnabledRequested, err = parseBoolOrDefault(getenv(EnvB2ArchiveEnabled), false)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid boolean: %w", EnvB2ArchiveEnabled, err)
	}
	// Real archival requires BOTH explicit operator intent and a complete
	// configuration. Validate() below turns the "requested but not
	// configured" combination into a startup error rather than letting it
	// quietly resolve to false here.
	cfg.B2ArchivalEnabled = cfg.b2ArchiveEnabledRequested && cfg.B2Configured

	cfg.B2RequestTimeout, err = parseDurationOrDefault(getenv(EnvB2RequestTimeout), DefaultB2RequestTimeout)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvB2RequestTimeout, err)
	}
	cfg.B2RetryBaseDelay, err = parseDurationOrDefault(getenv(EnvB2RetryBaseDelay), DefaultB2RetryBaseDelay)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvB2RetryBaseDelay, err)
	}
	cfg.B2RetryMaxDelay, err = parseDurationOrDefault(getenv(EnvB2RetryMaxDelay), DefaultB2RetryMaxDelay)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvB2RetryMaxDelay, err)
	}
	cfg.B2ArchiveInterval, err = parseDurationOrDefault(getenv(EnvB2ArchiveInterval), DefaultB2ArchiveInterval)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvB2ArchiveInterval, err)
	}
	cfg.B2ReportInterval, err = parseDurationOrDefault(getenv(EnvB2ReportInterval), DefaultB2ReportInterval)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvB2ReportInterval, err)
	}
	cfg.B2InsecureSkipVerify, err = parseBoolOrDefault(getenv(EnvB2InsecureSkipVerify), false)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid boolean: %w", EnvB2InsecureSkipVerify, err)
	}

	cfg.DVRWindow, err = parseDurationOrDefault(getenv(EnvDVRWindow), DefaultDVRWindow)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvDVRWindow, err)
	}
	cfg.LocalRetentionDelay, err = parseDurationOrDefault(getenv(EnvLocalRetentionDelay), DefaultLocalRetentionDelay)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvLocalRetentionDelay, err)
	}
	cfg.ManifestRebuildInterval, err = parseDurationOrDefault(getenv(EnvManifestRebuildInterval), DefaultManifestRebuildInterval)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvManifestRebuildInterval, err)
	}
	cfg.CleanupInterval, err = parseDurationOrDefault(getenv(EnvCleanupInterval), DefaultCleanupInterval)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvCleanupInterval, err)
	}

	cfg.YouTubeFFmpegPath = strings.TrimSpace(getenv(EnvYouTubeFFmpegPath))
	if cfg.YouTubeFFmpegPath == "" {
		cfg.YouTubeFFmpegPath = DefaultYouTubeFFmpegPath
	}
	cfg.YouTubeRestartMaxAttempts, err = parseIntOrDefault(getenv(EnvYouTubeRestartMaxAttempts), DefaultYouTubeRestartMaxAttempts)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid integer: %w", EnvYouTubeRestartMaxAttempts, err)
	}
	cfg.YouTubeRestartBackoffBase, err = parseDurationOrDefault(getenv(EnvYouTubeRestartBackoffBase), DefaultYouTubeRestartBackoffBase)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvYouTubeRestartBackoffBase, err)
	}
	cfg.YouTubeRestartBackoffMax, err = parseDurationOrDefault(getenv(EnvYouTubeRestartBackoffMax), DefaultYouTubeRestartBackoffMax)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvYouTubeRestartBackoffMax, err)
	}
	cfg.YouTubeSourceRTMPBaseURL = strings.TrimSpace(getenv(EnvYouTubeSourceRTMPBaseURL))
	if cfg.YouTubeSourceRTMPBaseURL == "" {
		cfg.YouTubeSourceRTMPBaseURL = DefaultYouTubeSourceRTMPBaseURL
	}
	cfg.YouTubeSourceReadyTimeout, err = parseDurationOrDefault(getenv(EnvYouTubeSourceReadyTimeout), DefaultYouTubeSourceReadyTimeout)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvYouTubeSourceReadyTimeout, err)
	}
	cfg.YouTubeSourceReadyMinRunDuration, err = parseDurationOrDefault(getenv(EnvYouTubeSourceReadyMinRunDuration), DefaultYouTubeSourceReadyMinRunDuration)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvYouTubeSourceReadyMinRunDuration, err)
	}
	cfg.YouTubeSourceReadyRetryInterval, err = parseDurationOrDefault(getenv(EnvYouTubeSourceReadyRetryInterval), DefaultYouTubeSourceReadyRetryInterval)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvYouTubeSourceReadyRetryInterval, err)
	}

	cfg.ControlPlaneBaseURL = strings.TrimSpace(getenv(EnvControlPlaneBaseURL))
	cfg.ControlPlaneEnabled = cfg.ControlPlaneBaseURL != ""
	cfg.ControlPlaneNodeToken = logging.Secret(getenv(EnvControlPlaneNodeToken))
	cfg.ControlPlaneRequestTimeout, err = parseDurationOrDefault(getenv(EnvControlPlaneRequestTimeout), DefaultControlPlaneRequestTimeout)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvControlPlaneRequestTimeout, err)
	}
	cfg.ControlPlaneSyncInterval, err = parseDurationOrDefault(getenv(EnvControlPlaneSyncInterval), DefaultControlPlaneSyncInterval)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvControlPlaneSyncInterval, err)
	}
	cfg.ControlPlaneBackoffBase, err = parseDurationOrDefault(getenv(EnvControlPlaneBackoffBase), DefaultControlPlaneBackoffBase)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvControlPlaneBackoffBase, err)
	}
	cfg.ControlPlaneBackoffMax, err = parseDurationOrDefault(getenv(EnvControlPlaneBackoffMax), DefaultControlPlaneBackoffMax)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvControlPlaneBackoffMax, err)
	}
	cfg.ControlPlaneStaleWarnAfter, err = parseDurationOrDefault(getenv(EnvControlPlaneStaleWarnAfter), DefaultControlPlaneStaleWarnAfter)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvControlPlaneStaleWarnAfter, err)
	}
	cfg.ControlPlaneStaleCriticalAfter, err = parseDurationOrDefault(getenv(EnvControlPlaneStaleCriticalAfter), DefaultControlPlaneStaleCriticalAfter)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid duration: %w", EnvControlPlaneStaleCriticalAfter, err)
	}

	cfg.OperatorAPIToken = logging.Secret(getenv(EnvOperatorAPIToken))

	cfg.RateLimitRPS, err = parseFloatOrDefault(getenv(EnvRateLimitRPS), DefaultRateLimitRPS)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid number: %w", EnvRateLimitRPS, err)
	}
	cfg.RateLimitBurst, err = parseIntOrDefault(getenv(EnvRateLimitBurst), DefaultRateLimitBurst)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid integer: %w", EnvRateLimitBurst, err)
	}
	cfg.TrustedProxyEnabled, err = parseBoolOrDefault(getenv(EnvTrustedProxyEnabled), false)
	if err != nil {
		return Config{}, fmt.Errorf("config: %s is not a valid boolean: %w", EnvTrustedProxyEnabled, err)
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

func parseIntOrDefault(raw string, def int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	if n <= 0 {
		return 0, fmt.Errorf("must be positive, got %s", raw)
	}
	return n, nil
}

func parseBoolOrDefault(raw string, def bool) (bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def, nil
	}
	return strconv.ParseBool(raw)
}

func parseFloatOrDefault(raw string, def float64) (float64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def, nil
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, err
	}
	if f <= 0 {
		return 0, fmt.Errorf("must be positive, got %s", raw)
	}
	return f, nil
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

	if err := c.validateR2(); err != nil {
		return err
	}

	if err := c.validateB2(); err != nil {
		return err
	}

	if err := c.validateControlPlane(); err != nil {
		return err
	}

	if c.RateLimitBurst <= 0 {
		return fmt.Errorf("config: %s must be positive", EnvRateLimitBurst)
	}

	if c.YouTubeRestartMaxAttempts <= 0 {
		return fmt.Errorf("config: %s must be positive", EnvYouTubeRestartMaxAttempts)
	}
	if c.YouTubeRestartBackoffMax < c.YouTubeRestartBackoffBase {
		return fmt.Errorf("config: %s must be >= %s", EnvYouTubeRestartBackoffMax, EnvYouTubeRestartBackoffBase)
	}
	if parsed, err := url.Parse(c.YouTubeSourceRTMPBaseURL); err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("config: %s must be an absolute rtmp:// URL", EnvYouTubeSourceRTMPBaseURL)
	}

	return nil
}

// validateR2 enforces that the upload/manifest/VOD/retention subsystem
// is either fully configured or fully absent: an operator who sets
// EnvR2Bucket clearly intends to enable it and must not be left with a
// silently half-configured (and therefore non-functional) uploader. An
// entirely unset EnvR2Bucket leaves the subsystem disabled, preserving
// startup compatibility for a deployment predating this milestone. Do
// not require real R2 credentials for automated tests: any S3-compatible
// endpoint (including a local test container) satisfies this check
// equally.
func (c Config) validateR2() error {
	if !c.R2Enabled {
		return nil
	}

	if c.R2Endpoint == "" {
		return fmt.Errorf("config: %s is required when %s is set", EnvR2Endpoint, EnvR2Bucket)
	}
	parsed, err := url.Parse(c.R2Endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("config: %s must be an absolute http:// or https:// URL", EnvR2Endpoint)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("config: %s must use http or https", EnvR2Endpoint)
	}
	if c.R2AccessKeyID == "" {
		return fmt.Errorf("config: %s is required when %s is set", EnvR2AccessKeyID, EnvR2Bucket)
	}
	if c.R2SecretAccessKey.Reveal() == "" {
		return fmt.Errorf("config: %s is required when %s is set", EnvR2SecretAccessKey, EnvR2Bucket)
	}
	if c.R2PublicBaseURL != "" {
		parsed, err := url.Parse(c.R2PublicBaseURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("config: %s must be an absolute http:// or https:// URL", EnvR2PublicBaseURL)
		}
	}
	if c.R2RetryMaxDelay < c.R2RetryBaseDelay {
		return fmt.Errorf("config: %s must be >= %s", EnvR2RetryMaxDelay, EnvR2RetryBaseDelay)
	}
	if c.DVRWindow <= 0 {
		return fmt.Errorf("config: %s must be positive", EnvDVRWindow)
	}
	if c.LocalRetentionDelay <= 0 {
		return fmt.Errorf("config: %s must be positive", EnvLocalRetentionDelay)
	}

	return nil
}

// validateB2 enforces the two-concept model documented on EnvB2Bucket
// above. Unlike validateR2, a partially-populated B2 block is NOT an
// error on its own: an operator may legitimately leave B2 entirely unset,
// and B2Configured simply stays false. What is an error is asking for
// production archival (EnvB2ArchiveEnabled) without a complete, valid
// configuration to perform it with - that must fail fast rather than
// silently resolve to "archival disabled", because the operator's stated
// intent would then be quietly ignored.
//
// When any B2 field is present, the whole set is validated for shape, so
// a typo in an endpoint surfaces at startup rather than at the first
// archival attempt. Errors name the offending variable and never echo a
// value.
func (c Config) validateB2() error {
	anyPresent := c.B2Endpoint != "" || c.B2Region != "" || c.B2Bucket != "" ||
		c.B2AccessKeyID != "" || c.B2SecretAccessKey.Reveal() != "" || c.B2ObjectPrefix != ""

	if c.b2ArchiveEnabledRequested && !c.B2Configured {
		return fmt.Errorf(
			"config: %s is true but the B2 configuration is incomplete; %s, %s, %s, %s, and %s are all required",
			EnvB2ArchiveEnabled, EnvB2Endpoint, EnvB2Region, EnvB2Bucket, EnvB2AccessKeyID, EnvB2SecretAccessKey)
	}

	if !anyPresent {
		return nil
	}

	if c.B2Endpoint != "" {
		parsed, err := url.Parse(c.B2Endpoint)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("config: %s must be an absolute http:// or https:// URL", EnvB2Endpoint)
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return fmt.Errorf("config: %s must use http or https", EnvB2Endpoint)
		}
	}
	if c.B2RetryMaxDelay < c.B2RetryBaseDelay {
		return fmt.Errorf("config: %s must be >= %s", EnvB2RetryMaxDelay, EnvB2RetryBaseDelay)
	}

	return nil
}

// validateControlPlane enforces that the continuous assignment-sync
// subsystem is either fully configured or fully absent, mirroring
// validateR2's rationale: setting EnvControlPlaneBaseURL clearly signals
// intent to enable it, and a half-configured sync client (e.g. no node
// credential) must fail fast at startup rather than run unauthenticated
// or silently never sync.
func (c Config) validateControlPlane() error {
	if !c.ControlPlaneEnabled {
		return nil
	}

	parsed, err := url.Parse(c.ControlPlaneBaseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("config: %s must be an absolute http:// or https:// URL", EnvControlPlaneBaseURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("config: %s must use http or https", EnvControlPlaneBaseURL)
	}
	if c.ControlPlaneNodeToken.Reveal() == "" {
		return fmt.Errorf("config: %s is required when %s is set", EnvControlPlaneNodeToken, EnvControlPlaneBaseURL)
	}
	if c.ControlPlaneBackoffMax < c.ControlPlaneBackoffBase {
		return fmt.Errorf("config: %s must be >= %s", EnvControlPlaneBackoffMax, EnvControlPlaneBackoffBase)
	}
	if c.ControlPlaneStaleCriticalAfter < c.ControlPlaneStaleWarnAfter {
		return fmt.Errorf("config: %s must be >= %s", EnvControlPlaneStaleCriticalAfter, EnvControlPlaneStaleWarnAfter)
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
