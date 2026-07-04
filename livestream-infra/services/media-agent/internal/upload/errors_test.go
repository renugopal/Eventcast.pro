package upload

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	smithy "github.com/aws/smithy-go"
)

type fakeAPIError struct{ code string }

func (e fakeAPIError) Error() string                 { return "fake api error: " + e.code }
func (e fakeAPIError) ErrorCode() string             { return e.code }
func (e fakeAPIError) ErrorMessage() string          { return e.code }
func (e fakeAPIError) ErrorFault() smithy.ErrorFault { return smithy.FaultUnknown }

type fakeTimeoutError struct{}

func (fakeTimeoutError) Error() string   { return "fake: i/o timeout" }
func (fakeTimeoutError) Timeout() bool   { return true }
func (fakeTimeoutError) Temporary() bool { return true }

var _ net.Error = fakeTimeoutError{}

func TestClassifyUploadError(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		retryable bool
		errorCode string
	}{
		{"missing local file", errLocalFileMissing, false, ErrCodeSpoolFileMissing},
		{"corrupted local file", errLocalFileCorrupted, false, ErrCodeSpoolFileUnstable},
		{"object mismatch", ErrObjectMismatch, false, ErrCodeR2ObjectMismatch},
		{"context deadline exceeded", context.DeadlineExceeded, true, ErrCodeR2Retryable},
		{"context canceled", context.Canceled, true, ErrCodeR2Retryable},
		{"net timeout", fakeTimeoutError{}, true, ErrCodeR2Retryable},
		{"api access denied", fakeAPIError{code: "AccessDenied"}, false, ErrCodeR2Auth},
		{"api invalid access key", fakeAPIError{code: "InvalidAccessKeyId"}, false, ErrCodeR2Auth},
		{"api internal error", fakeAPIError{code: "InternalError"}, true, ErrCodeR2Retryable},
		{"unrecognized error", errors.New("boom"), true, ErrCodeR2Retryable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyUploadError(tt.err)
			if got.retryable != tt.retryable {
				t.Errorf("retryable = %v, want %v", got.retryable, tt.retryable)
			}
			if got.errorCode != tt.errorCode {
				t.Errorf("errorCode = %q, want %q", got.errorCode, tt.errorCode)
			}
		})
	}
}

func TestBackoffDelayIsBoundedAndIncreasesWithAttempt(t *testing.T) {
	base := 100 * time.Millisecond
	max := 2 * time.Second

	for attempt := 1; attempt <= 20; attempt++ {
		d := backoffDelay(attempt, base, max)
		if d < 0 || d > max {
			t.Fatalf("attempt %d: backoffDelay = %v, want within [0, %v]", attempt, d, max)
		}
	}

	// A late attempt's *ceiling* must have grown at least as large as an
	// early attempt's ceiling; since delays are jittered we check many
	// samples and compare maxima observed rather than a single draw.
	var earlyMax, lateMax time.Duration
	for i := 0; i < 200; i++ {
		if d := backoffDelay(1, base, max); d > earlyMax {
			earlyMax = d
		}
		if d := backoffDelay(6, base, max); d > lateMax {
			lateMax = d
		}
	}
	if lateMax <= earlyMax {
		t.Errorf("expected later attempts to have a higher jitter ceiling: earlyMax=%v lateMax=%v", earlyMax, lateMax)
	}
}
