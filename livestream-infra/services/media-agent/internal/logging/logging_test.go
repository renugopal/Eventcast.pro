package logging

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

func TestParseLevel(t *testing.T) {
	cases := []struct {
		in      string
		want    slog.Level
		wantErr bool
	}{
		{"debug", slog.LevelDebug, false},
		{"DEBUG", slog.LevelDebug, false},
		{"info", slog.LevelInfo, false},
		{"", slog.LevelInfo, false},
		{"  info  ", slog.LevelInfo, false},
		{"warn", slog.LevelWarn, false},
		{"warning", slog.LevelWarn, false},
		{"error", slog.LevelError, false},
		{"trace", 0, true},
		{"critical", 0, true},
	}

	for _, tc := range cases {
		got, err := ParseLevel(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("ParseLevel(%q): expected error, got nil", tc.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseLevel(%q): unexpected error: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("ParseLevel(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestNewFiltersByLevel(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, slog.LevelInfo)

	logger.Debug("should not appear")
	if buf.Len() != 0 {
		t.Fatalf("expected no output for debug entry below configured level, got: %s", buf.String())
	}

	logger.Info("should appear", slog.String("key", "value"))
	if buf.Len() == 0 {
		t.Fatal("expected output for info entry at configured level, got none")
	}

	var decoded map[string]any
	if err := json.Unmarshal(buf.Bytes(), &decoded); err != nil {
		t.Fatalf("expected valid JSON output, got error: %v (raw: %s)", err, buf.String())
	}
	if decoded["msg"] != "should appear" {
		t.Errorf("msg = %v, want %q", decoded["msg"], "should appear")
	}
	if decoded["key"] != "value" {
		t.Errorf("key = %v, want %q", decoded["key"], "value")
	}
}

func TestSecretRedactsInStructuredLog(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, slog.LevelInfo)

	secret := Secret("super-secret-token-value")
	logger.Info("issued token", slog.Any("token", secret))

	output := buf.String()
	if strings.Contains(output, "super-secret-token-value") {
		t.Fatalf("secret value leaked into structured log output: %s", output)
	}
	if !strings.Contains(output, RedactedPlaceholder) {
		t.Fatalf("expected redaction placeholder in output, got: %s", output)
	}
}

func TestSecretRedactsWithFmt(t *testing.T) {
	secret := Secret("another-secret-value")

	if got := secret.String(); got != RedactedPlaceholder {
		t.Errorf("Secret.String() = %q, want %q", got, RedactedPlaceholder)
	}
	if got := fmt.Sprintf("%v", secret); got != RedactedPlaceholder {
		t.Errorf("fmt %%v of Secret = %q, want %q", got, RedactedPlaceholder)
	}
	if got := fmt.Sprintf("%s", secret); got != RedactedPlaceholder {
		t.Errorf("fmt %%s of Secret = %q, want %q", got, RedactedPlaceholder)
	}
}

func TestSecretRevealReturnsUnderlyingValue(t *testing.T) {
	const want = "raw-value-for-legitimate-use"
	secret := Secret(want)
	if got := secret.Reveal(); got != want {
		t.Errorf("Secret.Reveal() = %q, want %q", got, want)
	}
}
