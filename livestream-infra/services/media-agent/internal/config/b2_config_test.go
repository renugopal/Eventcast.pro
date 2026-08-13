package config

import (
	"strings"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/upload"
)

// b2Env returns a complete, valid baseline environment plus whatever B2
// overrides a case needs. It reuses the existing requiredPathEnv helper so
// the platform-appropriate absolute paths every Load() needs stay in one
// place.
func b2Env(t *testing.T, overrides map[string]string) func(string) string {
	t.Helper()
	base := requiredPathEnv(t)
	base[EnvNodeID] = "test-node"
	for k, v := range overrides {
		base[k] = v
	}
	return func(key string) string { return base[key] }
}

func completeB2() map[string]string {
	return map[string]string{
		EnvB2Endpoint:        "https://s3.us-west-004.backblazeb2.com",
		EnvB2Region:          "us-west-004",
		EnvB2Bucket:          "eventcast-vod-prod",
		EnvB2AccessKeyID:     "key-id",
		EnvB2SecretAccessKey: "secret",
	}
}

// The integrity mode defaults to "none", so an existing deployment that
// never sets it keeps exactly its current archival behaviour and makes no
// unearned strong-integrity claim.
func TestB2IntegrityModeDefaultsToNone(t *testing.T) {
	cfg, err := Load(b2Env(t, completeB2()))
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.B2IntegrityMode != upload.B2IntegrityNone {
		t.Errorf("B2IntegrityMode = %q, want %q", cfg.B2IntegrityMode, upload.B2IntegrityNone)
	}
	if cfg.B2IntegrityMode.StrongVerification() {
		t.Error("the default mode must not claim strong verification")
	}
}

func TestB2IntegrityModeAcceptsBothStrongMechanisms(t *testing.T) {
	for raw, want := range map[string]upload.B2IntegrityMode{
		"provider_checksum": upload.B2IntegrityProviderChecksum,
		"read_back":         upload.B2IntegrityReadBack,
	} {
		env := completeB2()
		env[EnvB2IntegrityMode] = raw
		cfg, err := Load(b2Env(t, env))
		if err != nil {
			t.Fatalf("Load() with %s=%q error: %v", EnvB2IntegrityMode, raw, err)
		}
		if cfg.B2IntegrityMode != want {
			t.Errorf("B2IntegrityMode = %q, want %q", cfg.B2IntegrityMode, want)
		}
	}
}

// An unsupported mode must stop startup. Falling back to "none" would
// leave an operator believing verification was on when it was not.
func TestB2UnsupportedIntegrityModeFailsFast(t *testing.T) {
	env := completeB2()
	env[EnvB2IntegrityMode] = "sha256-maybe"
	_, err := Load(b2Env(t, env))
	if err == nil {
		t.Fatal("Load() accepted an unsupported integrity mode")
	}
	if !strings.Contains(err.Error(), EnvB2IntegrityMode) {
		t.Errorf("error %q does not name the offending variable", err)
	}
}

// Selecting a strong mode must not, by itself, turn archival on.
func TestB2IntegrityModeDoesNotEnableArchival(t *testing.T) {
	env := completeB2()
	env[EnvB2IntegrityMode] = "read_back"
	cfg, err := Load(b2Env(t, env))
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.B2ArchivalEnabled {
		t.Error("archival enabled purely because an integrity mode was selected")
	}
}

// A node with no B2 configuration must behave exactly as before B2
// existed.
func TestB2AbsentLeavesBothFlagsFalse(t *testing.T) {
	cfg, err := Load(b2Env(t, nil))
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.B2Configured || cfg.B2ArchivalEnabled {
		t.Errorf("B2Configured=%v B2ArchivalEnabled=%v, want both false", cfg.B2Configured, cfg.B2ArchivalEnabled)
	}
}

// The central safety property: holding valid credentials must NOT by
// itself start archiving real recordings.
func TestB2ConfiguredWithoutTheSwitchDoesNotEnableArchival(t *testing.T) {
	cfg, err := Load(b2Env(t, completeB2()))
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if !cfg.B2Configured {
		t.Error("B2Configured = false for a complete configuration")
	}
	if cfg.B2ArchivalEnabled {
		t.Error("archival enabled purely because credentials were configured")
	}
}

func TestB2ArchivalEnabledRequiresBothConfigurationAndTheSwitch(t *testing.T) {
	env := completeB2()
	env[EnvB2ArchiveEnabled] = "true"

	cfg, err := Load(b2Env(t, env))
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if !cfg.B2Configured || !cfg.B2ArchivalEnabled {
		t.Errorf("B2Configured=%v B2ArchivalEnabled=%v, want both true", cfg.B2Configured, cfg.B2ArchivalEnabled)
	}
}

// Asking for archival without the means to perform it must fail fast, not
// silently resolve to "disabled" - that would ignore stated operator
// intent.
func TestB2ArchivalEnabledWithoutConfigurationFailsFast(t *testing.T) {
	_, err := Load(b2Env(t, map[string]string{EnvB2ArchiveEnabled: "true"}))
	if err == nil {
		t.Fatal("Load() succeeded with archival enabled but unconfigured")
	}
	if !strings.Contains(err.Error(), EnvB2ArchiveEnabled) {
		t.Errorf("error = %v, want it to name %s", err, EnvB2ArchiveEnabled)
	}
}

// An incomplete set must not read as configured - a half-configured client
// would fail at its first request instead of at startup.
func TestB2PartialConfigurationIsNotConfigured(t *testing.T) {
	for _, missing := range []string{EnvB2Endpoint, EnvB2Region, EnvB2Bucket, EnvB2AccessKeyID, EnvB2SecretAccessKey} {
		t.Run("missing "+missing, func(t *testing.T) {
			env := completeB2()
			delete(env, missing)

			cfg, err := Load(b2Env(t, env))
			if err != nil {
				t.Fatalf("Load() error: %v", err)
			}
			if cfg.B2Configured {
				t.Errorf("B2Configured = true despite %s being unset", missing)
			}
		})
	}
}

func TestB2EndpointShapeIsValidatedEagerly(t *testing.T) {
	env := completeB2()
	env[EnvB2Endpoint] = "not-a-url"

	if _, err := Load(b2Env(t, env)); err == nil {
		t.Fatal("Load() accepted a malformed B2 endpoint")
	}
}

// Errors must name the variable but never echo a value.
func TestB2ValidationErrorsNeverEchoSecrets(t *testing.T) {
	env := completeB2()
	env[EnvB2Endpoint] = "ftp://example.invalid"
	env[EnvB2SecretAccessKey] = "super-secret-value"

	_, err := Load(b2Env(t, env))
	if err == nil {
		t.Fatal("Load() accepted an unsupported endpoint scheme")
	}
	if strings.Contains(err.Error(), "super-secret-value") {
		t.Errorf("error echoed a secret value: %v", err)
	}
}
