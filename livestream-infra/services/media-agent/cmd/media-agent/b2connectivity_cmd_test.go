package main

import (
	"context"
	"strings"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
)

// testB2Secret is the fake credential these tests assert never reaches any
// operator-visible output.
const (
	testB2Secret      = "super-secret-application-key-value"
	testB2AccessKeyID = "0055aabbccddeeff0000000001"
)

// completeB2Env returns a full, valid B2 configuration pointed at addr,
// with production archival deliberately left OFF.
func completeB2Env(t *testing.T, addr string) map[string]string {
	t.Helper()
	return withRequiredPaths(t, map[string]string{
		config.EnvNodeID:              "test-node",
		config.EnvB2Endpoint:          "http://" + addr,
		config.EnvB2Region:            "us-west-004",
		config.EnvB2Bucket:            "eventcast-vod-test",
		config.EnvB2AccessKeyID:       testB2AccessKeyID,
		config.EnvB2SecretAccessKey:   testB2Secret,
		config.EnvB2RequestTimeout:    "2s",
		config.EnvB2ArchiveEnabled:    "false",
		config.EnvControlPlaneBaseURL: "",
	})
}

// An incomplete configuration must stop before any network call and name
// the missing contract, rather than dialling with half a credential set.
func TestRunB2ConnectivityFailsClosedOnIncompleteConfiguration(t *testing.T) {
	env := withRequiredPaths(t, map[string]string{
		config.EnvNodeID:     "test-node",
		config.EnvB2Endpoint: "https://s3.us-west-004.backblazeb2.com",
		config.EnvB2Region:   "us-west-004",
		config.EnvB2Bucket:   "eventcast-vod-test",
		// Credentials deliberately absent.
	})

	var out strings.Builder
	err := runB2Connectivity(context.Background(), envMap(env), &out)
	if err == nil {
		t.Fatal("runB2Connectivity() succeeded with an incomplete configuration")
	}
	if !strings.Contains(err.Error(), "incomplete B2 configuration") {
		t.Errorf("error = %q, want the incomplete-configuration message", err)
	}
	if out.Len() != 0 {
		t.Errorf("probe wrote output despite failing configuration gating: %q", out.String())
	}
}

func TestRunB2ConnectivityFailsClosedWithNoB2ConfigurationAtAll(t *testing.T) {
	env := withRequiredPaths(t, map[string]string{config.EnvNodeID: "test-node"})

	var out strings.Builder
	if err := runB2Connectivity(context.Background(), envMap(env), &out); err == nil {
		t.Fatal("runB2Connectivity() succeeded with no B2 configuration")
	}
}

// The central property: the probe must be runnable while production
// archival is OFF. Holding credentials so this can run is explicitly not
// the same as authorising archival.
//
// The endpoint points at a closed port, so the probe gets past every
// configuration gate and fails at the network stage - which is exactly
// what proves archival enablement was never required.
func TestRunB2ConnectivityRunsWithArchivalDisabled(t *testing.T) {
	addr := freeLoopbackAddr(t)
	env := completeB2Env(t, addr)

	var out strings.Builder
	err := runB2Connectivity(context.Background(), envMap(env), &out)
	if err == nil {
		t.Fatal("runB2Connectivity() unexpectedly succeeded against a closed port")
	}
	// It must fail at the PROBE, not at configuration gating.
	if strings.Contains(err.Error(), "incomplete B2 configuration") {
		t.Fatalf("probe was blocked by configuration gating: %v", err)
	}
	if !strings.Contains(err.Error(), "probe failed at put") {
		t.Errorf("error = %q, want a classified put-stage probe failure", err)
	}
	// Nothing may demand that archival be enabled first.
	if strings.Contains(err.Error(), config.EnvB2ArchiveEnabled) {
		t.Errorf("probe required archival enablement: %v", err)
	}
}

// Sanitization: neither the emitted evidence nor the error may leak the
// application key, its id, or the endpoint.
func TestRunB2ConnectivityNeverPrintsSecrets(t *testing.T) {
	addr := freeLoopbackAddr(t)
	env := completeB2Env(t, addr)

	var out strings.Builder
	err := runB2Connectivity(context.Background(), envMap(env), &out)
	if err == nil {
		t.Fatal("runB2Connectivity() unexpectedly succeeded against a closed port")
	}

	combined := out.String() + "\n" + err.Error()
	for _, forbidden := range []string{testB2Secret, testB2AccessKeyID} {
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
func TestRunB2ConnectivityEmitsSanitizedEvidenceFields(t *testing.T) {
	addr := freeLoopbackAddr(t)
	env := completeB2Env(t, addr)

	var out strings.Builder
	_ = runB2Connectivity(context.Background(), envMap(env), &out)

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
