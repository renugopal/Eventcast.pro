package telemetry

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestRelayErrorCategory_FixedMapping(t *testing.T) {
	cases := []struct {
		status, lastError, want string
	}{
		{"running", "", ""},
		{"failed", "ffmpeg exited: exit status 1 (stderr: rtmp://secret/key)", RelayErrorRestartBudgetExhausted},
		{"running", "start ffmpeg: fork/exec /usr/local/bin/ffmpeg: no such file", RelayErrorFFmpegStartFailed},
		{"starting", "ffmpeg exited: signal: killed (stderr: whatever)", RelayErrorFFmpegExited},
		{"stopped", "stopped: media agent restarted", RelayErrorAgentRestarted},
		{"stopped", "something entirely unexpected", RelayErrorOther},
	}
	for _, tc := range cases {
		if got := RelayErrorCategory(tc.status, tc.lastError); got != tc.want {
			t.Errorf("RelayErrorCategory(%q, %q) = %q, want %q", tc.status, tc.lastError, got, tc.want)
		}
	}
}

func TestNonNegativeSeconds_ClampsSkew(t *testing.T) {
	now := time.Now().UTC()
	if got := NonNegativeSeconds(now, now.Add(time.Minute)); got != 0 {
		t.Errorf("future ref = %v, want 0", got)
	}
	if got := NonNegativeSeconds(now, now.Add(-90*time.Second)); got != 90 {
		t.Errorf("past ref = %v, want 90", got)
	}
}

func TestStreamTelemetry_NewFieldsOmittedWhenUnknown(t *testing.T) {
	st := BuildStreamTelemetry("evt", time.Now().Add(-time.Minute), time.Now(), nil, nil, nil, time.Now())
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"relay_status", "relay_restart_count", "relay_error_category", "manifest_age_seconds"} {
		if strings.Contains(string(b), key) {
			t.Errorf("unknown field %q emitted: %s", key, b)
		}
	}
}
