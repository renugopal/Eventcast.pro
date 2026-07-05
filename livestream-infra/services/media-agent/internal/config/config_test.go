package config

import (
	"net"
	"path/filepath"
	"testing"
)

func envMap(m map[string]string) func(string) string {
	return func(key string) string {
		return m[key]
	}
}

// requiredPathEnv returns the base set of environment variables every
// successful Load() needs once the durability-related paths became
// required configuration: a distinct absolute directory per path so
// overlap validation never accidentally trips in a test that isn't
// exercising it.
func requiredPathEnv(t *testing.T) map[string]string {
	t.Helper()
	base := t.TempDir()
	return map[string]string{
		EnvDBPath:     filepath.Join(base, "db", "media-agent.sqlite3"),
		EnvSpoolRoot:  filepath.Join(base, "spool"),
		EnvSRSHLSRoot: filepath.Join(base, "srs-output"),
	}
}

func withRequiredPaths(t *testing.T, extra map[string]string) map[string]string {
	t.Helper()
	m := requiredPathEnv(t)
	for k, v := range extra {
		m[k] = v
	}
	return m
}

func TestLoadValidConfig(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:   "node-asia-south1-a-01",
		EnvHTTPAddr: "127.0.0.1:9090",
		EnvLogLevel: "debug",
	}))

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.NodeID != "node-asia-south1-a-01" {
		t.Errorf("NodeID = %q, want %q", cfg.NodeID, "node-asia-south1-a-01")
	}
	if cfg.HTTPAddr != "127.0.0.1:9090" {
		t.Errorf("HTTPAddr = %q, want %q", cfg.HTTPAddr, "127.0.0.1:9090")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID: "node-1",
	}))

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.HTTPAddr != DefaultHTTPAddr {
		t.Errorf("HTTPAddr = %q, want default %q", cfg.HTTPAddr, DefaultHTTPAddr)
	}
	if cfg.LogLevel != DefaultLogLevel {
		t.Errorf("LogLevel = %q, want default %q", cfg.LogLevel, DefaultLogLevel)
	}
	if cfg.ReconcileInterval != DefaultReconcileInterval {
		t.Errorf("ReconcileInterval = %v, want default %v", cfg.ReconcileInterval, DefaultReconcileInterval)
	}
	if cfg.SessionStaleTimeout != DefaultSessionStaleTimeout {
		t.Errorf("SessionStaleTimeout = %v, want default %v", cfg.SessionStaleTimeout, DefaultSessionStaleTimeout)
	}
	if cfg.DBBusyTimeout != DefaultDBBusyTimeout {
		t.Errorf("DBBusyTimeout = %v, want default %v", cfg.DBBusyTimeout, DefaultDBBusyTimeout)
	}
	if cfg.AssignmentSeedPath != "" {
		t.Errorf("AssignmentSeedPath = %q, want empty (seeding disabled by default)", cfg.AssignmentSeedPath)
	}
}

func TestLoadDefaultAddrIsLoopback(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID: "node-1",
	}))

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	host, _, err := net.SplitHostPort(cfg.HTTPAddr)
	if err != nil {
		t.Fatalf("failed to split default HTTPAddr %q: %v", cfg.HTTPAddr, err)
	}
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		t.Errorf("default HTTPAddr host = %q, want a loopback address", host)
	}
}

func TestLoadMissingNodeIDFailsFast(t *testing.T) {
	getenv := envMap(requiredPathEnv(t))

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for missing node id, got nil")
	}
}

func TestLoadWhitespaceOnlyNodeIDFailsFast(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID: "   ",
	}))

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for whitespace-only node id, got nil")
	}
}

func TestLoadOversizedNodeIDFailsFast(t *testing.T) {
	oversized := make([]byte, maxNodeIDLength+1)
	for i := range oversized {
		oversized[i] = 'a'
	}

	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID: string(oversized),
	}))

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for oversized node id, got nil")
	}
}

func TestLoadInvalidHTTPAddrFailsFast(t *testing.T) {
	cases := []struct {
		name string
		addr string
	}{
		{"no port separator", "not-a-valid-address"},
		{"empty port", "127.0.0.1:"},
		{"non-numeric port", "127.0.0.1:http"},
		{"port zero selects ephemeral port", "127.0.0.1:0"},
		{"port above 65535", "127.0.0.1:70000"},
		{"negative port", "127.0.0.1:-1"},
		{"plus-prefixed port", "127.0.0.1:+8085"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := envMap(withRequiredPaths(t, map[string]string{
				EnvNodeID:   "node-1",
				EnvHTTPAddr: tc.addr,
			}))

			_, err := Load(getenv)
			if err == nil {
				t.Fatalf("Load() expected error for HTTP address %q, got nil", tc.addr)
			}
		})
	}
}

func TestLoadAcceptsExplicitBindAddresses(t *testing.T) {
	// 0.0.0.0 (and the equivalent empty host) is a deliberate operator
	// choice used by the Compose stack so the SRS container can reach
	// the agent over the private container network.
	cases := []struct {
		name string
		addr string
	}{
		{"all interfaces", "0.0.0.0:8085"},
		{"empty host binds all interfaces", ":8085"},
		{"ipv6 loopback", "[::1]:8085"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := envMap(withRequiredPaths(t, map[string]string{
				EnvNodeID:   "node-1",
				EnvHTTPAddr: tc.addr,
			}))

			cfg, err := Load(getenv)
			if err != nil {
				t.Fatalf("Load() unexpected error for HTTP address %q: %v", tc.addr, err)
			}
			if cfg.HTTPAddr != tc.addr {
				t.Errorf("HTTPAddr = %q, want %q", cfg.HTTPAddr, tc.addr)
			}
		})
	}
}

func TestLoadRejectsUnsafeNodeIDCharacters(t *testing.T) {
	cases := []struct {
		name   string
		nodeID string
	}{
		{"embedded space", "node 1"},
		{"path separator", "node/1"},
		{"path traversal", "../etc"},
		{"embedded newline", "node\n1"},
		{"non-ascii", "nödé-1"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := envMap(withRequiredPaths(t, map[string]string{
				EnvNodeID: tc.nodeID,
			}))

			_, err := Load(getenv)
			if err == nil {
				t.Fatalf("Load() expected error for unsafe node id %q, got nil", tc.nodeID)
			}
		})
	}
}

func TestLoadAcceptsSafeNodeIDCharacters(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID: "media-node_asia.south1-A01",
	}))

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.NodeID != "media-node_asia.south1-A01" {
		t.Errorf("NodeID = %q, want %q", cfg.NodeID, "media-node_asia.south1-A01")
	}
}

func TestLoadInvalidLogLevelFailsFast(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:   "node-1",
		EnvLogLevel: "not-a-level",
	}))

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for invalid log level, got nil")
	}
}

func TestValidateRejectsZeroValueConfig(t *testing.T) {
	var cfg Config
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() expected error for zero-value config, got nil")
	}
}

func TestLoadRequiresDurabilityPaths(t *testing.T) {
	base := t.TempDir()
	full := map[string]string{
		EnvNodeID:     "node-1",
		EnvDBPath:     filepath.Join(base, "db", "media-agent.sqlite3"),
		EnvSpoolRoot:  filepath.Join(base, "spool"),
		EnvSRSHLSRoot: filepath.Join(base, "srs-output"),
	}

	for _, missing := range []string{EnvDBPath, EnvSpoolRoot, EnvSRSHLSRoot} {
		t.Run("missing "+missing, func(t *testing.T) {
			m := make(map[string]string, len(full))
			for k, v := range full {
				m[k] = v
			}
			delete(m, missing)

			_, err := Load(envMap(m))
			if err == nil {
				t.Fatalf("Load() expected error when %s is missing, got nil", missing)
			}
		})
	}
}

func TestLoadRejectsUnsafeDurabilityPaths(t *testing.T) {
	base := t.TempDir()

	cases := []struct {
		name   string
		envVar string
		value  string
	}{
		{"relative db path", EnvDBPath, "relative/db.sqlite3"},
		{"empty db path", EnvDBPath, ""},
		{"db path with traversal", EnvDBPath, base + string(filepath.Separator) + ".." + string(filepath.Separator) + "escape.sqlite3"},
		{"relative spool root", EnvSpoolRoot, "relative/spool"},
		{"empty spool root", EnvSpoolRoot, ""},
		{"spool root is filesystem root", EnvSpoolRoot, string(filepath.Separator)},
		{"relative hls root", EnvSRSHLSRoot, "relative/srs-output"},
		{"empty hls root", EnvSRSHLSRoot, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := map[string]string{
				EnvNodeID:     "node-1",
				EnvDBPath:     filepath.Join(base, "db", "media-agent.sqlite3"),
				EnvSpoolRoot:  filepath.Join(base, "spool"),
				EnvSRSHLSRoot: filepath.Join(base, "srs-output"),
			}
			m[tc.envVar] = tc.value

			_, err := Load(envMap(m))
			if err == nil {
				t.Fatalf("Load() expected error for %s = %q, got nil", tc.envVar, tc.value)
			}
		})
	}
}

func TestLoadRejectsOverlappingSpoolAndHLSRoots(t *testing.T) {
	base := t.TempDir()

	cases := []struct {
		name      string
		spoolRoot string
		hlsRoot   string
	}{
		{"identical paths", filepath.Join(base, "media"), filepath.Join(base, "media")},
		{"hls root nested in spool root", filepath.Join(base, "media"), filepath.Join(base, "media", "srs-output")},
		{"spool root nested in hls root", filepath.Join(base, "media", "spool"), filepath.Join(base, "media")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := envMap(map[string]string{
				EnvNodeID:     "node-1",
				EnvDBPath:     filepath.Join(base, "db.sqlite3"),
				EnvSpoolRoot:  tc.spoolRoot,
				EnvSRSHLSRoot: tc.hlsRoot,
			})

			_, err := Load(getenv)
			if err == nil {
				t.Fatalf("Load() expected error for overlapping spool root %q and hls root %q, got nil", tc.spoolRoot, tc.hlsRoot)
			}
		})
	}
}

func TestLoadRejectsDBPathInsideDurableRoots(t *testing.T) {
	base := t.TempDir()

	getenv := envMap(map[string]string{
		EnvNodeID:     "node-1",
		EnvSpoolRoot:  filepath.Join(base, "spool"),
		EnvSRSHLSRoot: filepath.Join(base, "srs-output"),
		EnvDBPath:     filepath.Join(base, "spool", "media-agent.sqlite3"),
	})

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error when db path is nested inside the spool root, got nil")
	}
}

func TestLoadRejectsAssignmentSeedPathInsideDurableRoots(t *testing.T) {
	base := t.TempDir()

	cases := []struct {
		name     string
		seedPath string
	}{
		{"inside spool root", filepath.Join(base, "spool", "assignments.json")},
		{"inside hls root", filepath.Join(base, "srs-output", "assignments.json")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := envMap(map[string]string{
				EnvNodeID:             "node-1",
				EnvDBPath:             filepath.Join(base, "db.sqlite3"),
				EnvSpoolRoot:          filepath.Join(base, "spool"),
				EnvSRSHLSRoot:         filepath.Join(base, "srs-output"),
				EnvAssignmentSeedPath: tc.seedPath,
			})

			_, err := Load(getenv)
			if err == nil {
				t.Fatalf("Load() expected error for assignment seed path %q, got nil", tc.seedPath)
			}
		})
	}
}

func TestLoadAcceptsOptionalAssignmentSeedPath(t *testing.T) {
	base := t.TempDir()
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:             "node-1",
		EnvAssignmentSeedPath: filepath.Join(base, "assignments.json"),
	}))

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.AssignmentSeedPath != filepath.Join(base, "assignments.json") {
		t.Errorf("AssignmentSeedPath = %q, want %q", cfg.AssignmentSeedPath, filepath.Join(base, "assignments.json"))
	}
}

func TestLoadRejectsRelativeAssignmentSeedPath(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:             "node-1",
		EnvAssignmentSeedPath: "relative/assignments.json",
	}))

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for a relative assignment seed path, got nil")
	}
}

func TestLoadDurationEnvVars(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:              "node-1",
		EnvReconcileInterval:   "10s",
		EnvSessionStaleTimeout: "1m",
		EnvDBBusyTimeout:       "500ms",
	}))

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.ReconcileInterval.String() != "10s" {
		t.Errorf("ReconcileInterval = %v, want 10s", cfg.ReconcileInterval)
	}
	if cfg.SessionStaleTimeout.String() != "1m0s" {
		t.Errorf("SessionStaleTimeout = %v, want 1m0s", cfg.SessionStaleTimeout)
	}
	if cfg.DBBusyTimeout.String() != "500ms" {
		t.Errorf("DBBusyTimeout = %v, want 500ms", cfg.DBBusyTimeout)
	}
}

func TestLoadRejectsInvalidDurationEnvVars(t *testing.T) {
	cases := []struct {
		name   string
		envVar string
		value  string
	}{
		{"not a duration", EnvReconcileInterval, "not-a-duration"},
		{"zero duration", EnvReconcileInterval, "0s"},
		{"negative duration", EnvReconcileInterval, "-5s"},
		{"not a duration", EnvSessionStaleTimeout, "soon"},
		{"zero duration", EnvDBBusyTimeout, "0s"},
	}

	for _, tc := range cases {
		t.Run(tc.envVar+"/"+tc.name, func(t *testing.T) {
			getenv := envMap(withRequiredPaths(t, map[string]string{
				EnvNodeID: "node-1",
				tc.envVar: tc.value,
			}))

			_, err := Load(getenv)
			if err == nil {
				t.Fatalf("Load() expected error for %s = %q, got nil", tc.envVar, tc.value)
			}
		})
	}
}

func TestLoadR2DisabledByDefault(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{EnvNodeID: "node-1"}))
	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.R2Enabled {
		t.Error("R2Enabled = true without EVENTCAST_R2_BUCKET set, want false")
	}
}

func TestLoadR2RequiresEndpointAccessKeyAndSecretWhenBucketSet(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:   "node-1",
		EnvR2Bucket: "my-bucket",
	}))
	if _, err := Load(getenv); err == nil {
		t.Fatal("Load() expected error when EVENTCAST_R2_BUCKET is set without endpoint/credentials")
	}
}

func TestLoadValidR2ConfigDoesNotRequireRealCredentials(t *testing.T) {
	// Any S3-compatible endpoint (a local test container's URL and
	// arbitrary test access keys) must satisfy validation - no real R2
	// account is required for automated tests.
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:            "node-1",
		EnvR2Bucket:          "my-bucket",
		EnvR2Endpoint:        "http://127.0.0.1:9000",
		EnvR2AccessKeyID:     "test-access-key",
		EnvR2SecretAccessKey: "test-secret-key",
	}))
	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if !cfg.R2Enabled {
		t.Fatal("R2Enabled = false, want true")
	}
	if cfg.R2Region != DefaultR2Region {
		t.Errorf("R2Region = %q, want default %q", cfg.R2Region, DefaultR2Region)
	}
	if cfg.R2UploadConcurrency != DefaultR2UploadConcurrency {
		t.Errorf("R2UploadConcurrency = %d, want default %d", cfg.R2UploadConcurrency, DefaultR2UploadConcurrency)
	}
	if cfg.DVRWindow != DefaultDVRWindow {
		t.Errorf("DVRWindow = %v, want default %v", cfg.DVRWindow, DefaultDVRWindow)
	}
	if cfg.LocalRetentionDelay != DefaultLocalRetentionDelay {
		t.Errorf("LocalRetentionDelay = %v, want default %v", cfg.LocalRetentionDelay, DefaultLocalRetentionDelay)
	}
	if cfg.R2SecretAccessKey.Reveal() != "test-secret-key" {
		t.Errorf("R2SecretAccessKey.Reveal() = %q, want %q", cfg.R2SecretAccessKey.Reveal(), "test-secret-key")
	}
}

func TestLoadR2RejectsInvalidEndpoint(t *testing.T) {
	cases := []string{"not-a-url", "ftp://example.com", ""}
	for _, endpoint := range cases {
		t.Run(endpoint, func(t *testing.T) {
			getenv := envMap(withRequiredPaths(t, map[string]string{
				EnvNodeID:            "node-1",
				EnvR2Bucket:          "my-bucket",
				EnvR2Endpoint:        endpoint,
				EnvR2AccessKeyID:     "key",
				EnvR2SecretAccessKey: "secret",
			}))
			if _, err := Load(getenv); err == nil {
				t.Fatalf("Load() expected error for R2 endpoint %q", endpoint)
			}
		})
	}
}

func TestLoadR2RejectsRetryMaxDelayBelowBaseDelay(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:            "node-1",
		EnvR2Bucket:          "my-bucket",
		EnvR2Endpoint:        "http://127.0.0.1:9000",
		EnvR2AccessKeyID:     "key",
		EnvR2SecretAccessKey: "secret",
		EnvR2RetryBaseDelay:  "10s",
		EnvR2RetryMaxDelay:   "1s",
	}))
	if _, err := Load(getenv); err == nil {
		t.Fatal("Load() expected error when R2 retry max delay is below the base delay")
	}
}

func TestLoadYouTubeDefaultsAndValidation(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{EnvNodeID: "node-1"}))
	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.YouTubeFFmpegPath != DefaultYouTubeFFmpegPath {
		t.Errorf("YouTubeFFmpegPath = %q, want default %q", cfg.YouTubeFFmpegPath, DefaultYouTubeFFmpegPath)
	}
	if cfg.YouTubeRestartMaxAttempts != DefaultYouTubeRestartMaxAttempts {
		t.Errorf("YouTubeRestartMaxAttempts = %d, want default %d", cfg.YouTubeRestartMaxAttempts, DefaultYouTubeRestartMaxAttempts)
	}
	if cfg.YouTubeSourceRTMPBaseURL != DefaultYouTubeSourceRTMPBaseURL {
		t.Errorf("YouTubeSourceRTMPBaseURL = %q, want default %q", cfg.YouTubeSourceRTMPBaseURL, DefaultYouTubeSourceRTMPBaseURL)
	}
	if cfg.YouTubeSourceReadyTimeout != DefaultYouTubeSourceReadyTimeout {
		t.Errorf("YouTubeSourceReadyTimeout = %v, want default %v", cfg.YouTubeSourceReadyTimeout, DefaultYouTubeSourceReadyTimeout)
	}
	if cfg.YouTubeSourceReadyMinRunDuration != DefaultYouTubeSourceReadyMinRunDuration {
		t.Errorf("YouTubeSourceReadyMinRunDuration = %v, want default %v", cfg.YouTubeSourceReadyMinRunDuration, DefaultYouTubeSourceReadyMinRunDuration)
	}
	if cfg.YouTubeSourceReadyRetryInterval != DefaultYouTubeSourceReadyRetryInterval {
		t.Errorf("YouTubeSourceReadyRetryInterval = %v, want default %v", cfg.YouTubeSourceReadyRetryInterval, DefaultYouTubeSourceReadyRetryInterval)
	}
}

func TestLoadYouTubeRejectsInvalidSourceReadyDurations(t *testing.T) {
	for _, envVar := range []string{
		EnvYouTubeSourceReadyTimeout,
		EnvYouTubeSourceReadyMinRunDuration,
		EnvYouTubeSourceReadyRetryInterval,
	} {
		getenv := envMap(withRequiredPaths(t, map[string]string{
			EnvNodeID: "node-1",
			envVar:    "not-a-duration",
		}))
		if _, err := Load(getenv); err == nil {
			t.Errorf("Load() expected error for invalid %s, got nil", envVar)
		}
	}
}

func TestLoadYouTubeRejectsBackoffMaxBelowBase(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:                    "node-1",
		EnvYouTubeRestartBackoffBase: "30s",
		EnvYouTubeRestartBackoffMax:  "5s",
	}))
	if _, err := Load(getenv); err == nil {
		t.Fatal("Load() expected error when YouTube restart backoff max is below base")
	}
}

func TestLoadYouTubeRejectsInvalidSourceRTMPBaseURL(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:                   "node-1",
		EnvYouTubeSourceRTMPBaseURL: "not-a-url",
	}))
	if _, err := Load(getenv); err == nil {
		t.Fatal("Load() expected error for an invalid YouTube source RTMP base URL")
	}
}

func TestLoadRejectsInvalidR2InsecureSkipVerifyBoolean(t *testing.T) {
	getenv := envMap(withRequiredPaths(t, map[string]string{
		EnvNodeID:               "node-1",
		EnvR2Bucket:             "my-bucket",
		EnvR2Endpoint:           "http://127.0.0.1:9000",
		EnvR2AccessKeyID:        "key",
		EnvR2SecretAccessKey:    "secret",
		EnvR2InsecureSkipVerify: "not-a-bool",
	}))
	if _, err := Load(getenv); err == nil {
		t.Fatal("Load() expected error for a non-boolean EVENTCAST_R2_INSECURE_SKIP_VERIFY")
	}
}
