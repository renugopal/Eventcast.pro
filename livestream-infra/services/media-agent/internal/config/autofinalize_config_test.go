package config

import (
	"strings"
	"testing"
	"time"
)

// afEnv is a complete, valid baseline environment (reusing b2Env's
// required-path baseline) plus AutoFinalizer overrides.
func afEnv(t *testing.T, overrides map[string]string) func(string) string {
	t.Helper()
	return b2Env(t, overrides)
}

func TestAutoFinalizeDefaults(t *testing.T) {
	cfg, err := Load(afEnv(t, nil))
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.AutoFinalizeEnabled {
		t.Error("AutoFinalizeEnabled default = true, want false (explicit opt-in)")
	}
	if cfg.AutoFinalizeInterval != DefaultAutoFinalizeInterval ||
		cfg.AutoFinalizeQuietPeriod != 120*time.Second ||
		cfg.AutoFinalizeWindowGrace != 3*time.Hour ||
		cfg.AutoFinalizeClaimLease != DefaultAutoFinalizeClaimLease {
		t.Errorf("defaults = interval %v quiet %v grace %v lease %v, want %v/120s/3h/%v",
			cfg.AutoFinalizeInterval, cfg.AutoFinalizeQuietPeriod, cfg.AutoFinalizeWindowGrace, cfg.AutoFinalizeClaimLease,
			DefaultAutoFinalizeInterval, DefaultAutoFinalizeClaimLease)
	}
	if !cfg.AutoFinalizeRolloutCutoff.IsZero() {
		t.Error("rollout cutoff default must be unset")
	}
}

func TestAutoFinalizeEnabledWithCutoffValid(t *testing.T) {
	cfg, err := Load(afEnv(t, map[string]string{
		EnvAutoFinalizeEnabled:       "true",
		EnvAutoFinalizeRolloutCutoff: "2026-10-01T00:00:00Z",
		EnvAutoFinalizeQuietPeriod:   "90s",
		EnvAutoFinalizeWindowGrace:   "2h",
		EnvAutoFinalizeClaimLease:    "5m",
	}))
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	want := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	if !cfg.AutoFinalizeEnabled || !cfg.AutoFinalizeRolloutCutoff.Equal(want) ||
		cfg.AutoFinalizeQuietPeriod != 90*time.Second || cfg.AutoFinalizeWindowGrace != 2*time.Hour ||
		cfg.AutoFinalizeClaimLease != 5*time.Minute {
		t.Errorf("cfg = %+v", cfg)
	}
}

func TestAutoFinalizeRejectedConfigs(t *testing.T) {
	cases := map[string]struct {
		env     map[string]string
		wantSub string
	}{
		"enabled-without-cutoff": {map[string]string{EnvAutoFinalizeEnabled: "true"}, EnvAutoFinalizeRolloutCutoff},
		"lease-below-minimum":    {map[string]string{EnvAutoFinalizeClaimLease: "10s"}, EnvAutoFinalizeClaimLease},
		"zero-interval":          {map[string]string{EnvAutoFinalizeInterval: "0s"}, EnvAutoFinalizeInterval},
		"negative-interval":      {map[string]string{EnvAutoFinalizeInterval: "-5s"}, EnvAutoFinalizeInterval},
		"negative-quiet":         {map[string]string{EnvAutoFinalizeQuietPeriod: "-1s"}, EnvAutoFinalizeQuietPeriod},
		"negative-grace":         {map[string]string{EnvAutoFinalizeWindowGrace: "-1h"}, EnvAutoFinalizeWindowGrace},
		"bad-cutoff":             {map[string]string{EnvAutoFinalizeRolloutCutoff: "yesterday"}, EnvAutoFinalizeRolloutCutoff},
		"bad-enabled":            {map[string]string{EnvAutoFinalizeEnabled: "maybe"}, EnvAutoFinalizeEnabled},
		"bad-duration":           {map[string]string{EnvAutoFinalizeQuietPeriod: "soon"}, EnvAutoFinalizeQuietPeriod},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Load(afEnv(t, tc.env))
			if err == nil {
				t.Fatal("Load() accepted an invalid AutoFinalizer configuration")
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error %q does not mention %q", err, tc.wantSub)
			}
		})
	}
}
