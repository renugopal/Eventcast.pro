package main

import (
	"context"
	"strings"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
)

// testR2Secret is the fake credential these tests assert never reaches any
// operator-visible output.
const (
	testR2Secret      = "super-secret-r2-token-value"
	testR2AccessKeyID = "0066aabbccddeeff0000000002"
)

// completeR2Env returns a full, valid R2 configuration pointed at addr.
func completeR2Env(t *testing.T, addr string) map[string]string {
	t.Helper()
	return withRequiredPaths(t, map[string]string{
		config.EnvNodeID:              "test-node",
		config.EnvR2Endpoint:          "http://" + addr,
		config.EnvR2Region:            "auto",
		config.EnvR2Bucket:            "eventcast-livestream-media-test",
		config.EnvR2AccessKeyID:       testR2AccessKeyID,
		config.EnvR2SecretAccessKey:   testR2Secret,
		config.EnvR2RequestTimeout:    "2s",
		config.EnvControlPlaneBaseURL: "",
	})
}

// An incomplete configuration must stop before any network call, rather
// than dialling with half a credential set. Unlike B2 (whose completeness
// gate lives in the connectivity command itself, at cfg.B2Configured), R2's
// completeness is enforced earlier, inside config.Load() -> validateR2():
// EnvR2Bucket being set makes EnvR2Endpoint/AccessKeyID/SecretAccessKey all
// required, and an incomplete set fails config.Load() itself. Either layer
// failing closed is the property under test here, not the exact wording.
func TestRunR2ConnectivityFailsClosedOnIncompleteConfiguration(t *testing.T) {
	env := withRequiredPaths(t, map[string]string{
		config.EnvNodeID:     "test-node",
		config.EnvR2Endpoint: "https://example.r2.cloudflarestorage.com",
		config.EnvR2Region:   "auto",
		config.EnvR2Bucket:   "eventcast-livestream-media-test",
		// Credentials deliberately absent.
	})

	var out strings.Builder
	err := runR2Connectivity(context.Background(), envMap(env), &out)
	if err == nil {
		t.Fatal("runR2Connectivity() succeeded with an incomplete configuration")
	}
	if !strings.Contains(err.Error(), config.EnvR2AccessKeyID) {
		t.Errorf("error = %q, want it to name the missing %s", err, config.EnvR2AccessKeyID)
	}
	if out.Len() != 0 {
		t.Errorf("probe wrote output despite failing configuration gating: %q", out.String())
	}
}

func TestRunR2ConnectivityFailsClosedWithNoR2ConfigurationAtAll(t *testing.T) {
	env := withRequiredPaths(t, map[string]string{config.EnvNodeID: "test-node"})

	var out strings.Builder
	if err := runR2Connectivity(context.Background(), envMap(env), &out); err == nil {
		t.Fatal("runR2Connectivity() succeeded with no R2 configuration")
	}
}

// The central property: the probe must not require, check, or depend on
// any active streaming session or node/assignment capacity state - it is
// a pure config-plus-network operation.
//
// The endpoint points at a closed port, so the probe gets past every
// configuration gate and fails at the network stage - which is exactly
// what proves no streaming/session/capacity state was ever consulted.
func TestRunR2ConnectivityRunsWithoutRequiringStreamingCapacity(t *testing.T) {
	addr := freeLoopbackAddr(t)
	env := completeR2Env(t, addr)

	var out strings.Builder
	err := runR2Connectivity(context.Background(), envMap(env), &out)
	if err == nil {
		t.Fatal("runR2Connectivity() unexpectedly succeeded against a closed port")
	}
	// It must fail at the PROBE, not at configuration gating.
	if strings.Contains(err.Error(), "incomplete R2 configuration") {
		t.Fatalf("probe was blocked by configuration gating: %v", err)
	}
	if !strings.Contains(err.Error(), "probe failed at put") {
		t.Errorf("error = %q, want a classified put-stage probe failure", err)
	}
}

// Sanitization: neither the emitted evidence nor the error may leak the
// R2 access key, its id, or the endpoint.
func TestRunR2ConnectivityNeverPrintsSecrets(t *testing.T) {
	addr := freeLoopbackAddr(t)
	env := completeR2Env(t, addr)

	var out strings.Builder
	err := runR2Connectivity(context.Background(), envMap(env), &out)
	if err == nil {
		t.Fatal("runR2Connectivity() unexpectedly succeeded against a closed port")
	}

	combined := out.String() + "\n" + err.Error()
	for _, forbidden := range []string{testR2Secret, testR2AccessKeyID} {
		if strings.Contains(combined, forbidden) {
			t.Errorf("operator-visible output leaked a credential value")
		}
	}
	// The raw provider error can echo request context, so it is classified
	// rather than surfaced verbatim.
	if strings.Contains(combined, "connection refused") || strings.Contains(combined, "dial tcp") {
		t.Errorf("raw provider/network error surfaced verbatim: %q", combined)
	}
}

// Evidence the operator actually needs must still be printed, in a
// machine-readable, non-secret form, even when the probe later fails.
func TestRunR2ConnectivityEmitsSanitizedEvidenceFields(t *testing.T) {
	addr := freeLoopbackAddr(t)
	env := completeR2Env(t, addr)

	var out strings.Builder
	_ = runR2Connectivity(context.Background(), envMap(env), &out)

	for _, field := range []string{
		"bucket=", "key=", "put_succeeded=", "head_matched=",
		"checksum_attempted=", "checksum_accepted=",
		"corrupt_checksum_rejected=", "supports_provider_checksum=",
	} {
		if !strings.Contains(out.String(), field) {
			t.Errorf("sanitized evidence missing %q; got:\n%s", field, out.String())
		}
	}
	// The probe object must stay inside its isolated namespace.
	if !strings.Contains(out.String(), "_connectivity-test/") {
		t.Errorf("probe key left the _connectivity-test namespace; got:\n%s", out.String())
	}
}
