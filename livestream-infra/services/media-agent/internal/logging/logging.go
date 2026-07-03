// Package logging provides structured JSON logging for the Media Agent,
// including reusable redaction support for fields that may later carry
// secrets (stream tokens, provider credentials).
package logging

import (
	"fmt"
	"io"
	"log/slog"
	"strings"
)

// RedactedPlaceholder replaces any value wrapped in Secret when logged
// or formatted, regardless of handler or verb.
const RedactedPlaceholder = "[REDACTED]"

// ParseLevel converts a case-insensitive level name into a slog.Level.
// An empty string is treated as "info".
func ParseLevel(level string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info", "":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("logging: unknown log level %q", level)
	}
}

// New builds a structured JSON logger writing to w, filtered at level.
func New(w io.Writer, level slog.Level) *slog.Logger {
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level})
	return slog.New(handler)
}

// Secret wraps a sensitive value (stream tokens, provider credentials,
// signed URLs) so it can be carried through the codebase without risk
// of accidental exposure. Every rendering path - slog attribute value,
// fmt verb, or Println - resolves to RedactedPlaceholder instead of the
// underlying value. Callers that legitimately need the raw value must
// convert explicitly via Reveal.
type Secret string

// LogValue implements slog.LogValuer so a Secret always renders redacted
// when passed as a structured log attribute.
func (s Secret) LogValue() slog.Value {
	return slog.StringValue(RedactedPlaceholder)
}

// String implements fmt.Stringer so accidental use with fmt.Sprintf,
// fmt.Println, or string concatenation also redacts.
func (s Secret) String() string {
	return RedactedPlaceholder
}

// Reveal returns the wrapped value. Callers must use it only at the
// point of legitimate use (e.g. an outbound Authorization header) and
// must never pass the result to a logger or error message.
func (s Secret) Reveal() string {
	return string(s)
}
