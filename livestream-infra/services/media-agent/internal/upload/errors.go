package upload

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	smithy "github.com/aws/smithy-go"
)

// Stable machine-readable error codes
// (03_DATA_MODEL_AND_API_CONTRACTS.md "Error model"). These are safe to
// log and to surface to any future control-plane API: they never
// contain request content.
const (
	ErrCodeR2Auth            = "R2_AUTH"
	ErrCodeR2Retryable       = "R2_RETRYABLE"
	ErrCodeR2ObjectMismatch  = "R2_OBJECT_MISMATCH"
	ErrCodeSpoolFileMissing  = "SPOOL_FILE_MISSING"
	ErrCodeSpoolFileUnstable = "SPOOL_FILE_UNSTABLE"
)

// classification is the outcome of classifyUploadError: either the
// segment should be retried later (with backoff) or the failure is
// terminal and the segment must be dead-lettered.
type classification struct {
	retryable bool
	errorCode string
}

// classifyUploadError decides whether an upload/verification failure is
// retryable or terminal. Per 02_V1_ARCHITECTURE_SPEC.md "Upload
// retries MUST use exponential backoff with jitter and a maximum
// interval. Retriable provider, network, timeout, and 5xx errors MUST
// not become terminal merely because a retry count was exceeded.
// Permanently invalid credentials, missing local files, or corrupted
// files MUST raise a critical incident and place the event in a
// recoverable failed state," so classification - never attempt count -
// is what decides retryable vs. terminal here.
func classifyUploadError(err error) classification {
	if err == nil {
		return classification{retryable: false}
	}

	if errors.Is(err, errLocalFileMissing) {
		return classification{retryable: false, errorCode: ErrCodeSpoolFileMissing}
	}
	if errors.Is(err, errLocalFileCorrupted) {
		return classification{retryable: false, errorCode: ErrCodeSpoolFileUnstable}
	}
	if errors.Is(err, ErrObjectMismatch) {
		return classification{retryable: false, errorCode: ErrCodeR2ObjectMismatch}
	}

	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return classification{retryable: true, errorCode: ErrCodeR2Retryable}
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return classification{retryable: true, errorCode: ErrCodeR2Retryable}
	}

	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		code := apiErr.ErrorCode()
		if isAuthErrorCode(code) {
			return classification{retryable: false, errorCode: ErrCodeR2Auth}
		}
		return classification{retryable: true, errorCode: ErrCodeR2Retryable}
	}

	var httpErr interface{ HTTPStatusCode() int }
	if errors.As(err, &httpErr) {
		status := httpErr.HTTPStatusCode()
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			return classification{retryable: false, errorCode: ErrCodeR2Auth}
		}
		if status >= 500 || status == http.StatusTooManyRequests {
			return classification{retryable: true, errorCode: ErrCodeR2Retryable}
		}
		return classification{retryable: false, errorCode: ErrCodeR2Auth}
	}

	// An unrecognized error shape (e.g. a transport error without a
	// typed net.Error, such as some TLS handshake failures) is treated
	// as retryable: per the architecture's error model, only
	// affirmatively-classified terminal conditions (auth, corruption,
	// mismatch) are non-retryable, so an unknown failure defaults to
	// the safer "keep retrying with backoff" path rather than silently
	// dead-lettering a segment on a transient, unrecognized fault.
	return classification{retryable: true, errorCode: ErrCodeR2Retryable}
}

func isAuthErrorCode(code string) bool {
	switch strings.ToLower(code) {
	case "accessdenied", "invalidaccesskeyid", "signaturedoesnotmatch", "invalidsecuritytoken", "expiredtoken", "unauthorized", "forbidden":
		return true
	default:
		return false
	}
}

// Sentinel errors for local-file-related terminal classifications.
var (
	errLocalFileMissing   = errors.New("upload: local spool file is missing")
	errLocalFileCorrupted = errors.New("upload: local spool file no longer matches its recorded sha256")
	// ErrObjectMismatch means HeadObject found an existing object at the
	// deterministic key whose size or sha256 metadata does not match
	// what this segment expects. Per
	// 02_V1_ARCHITECTURE_SPEC.md "Segment keys MUST be immutable. A
	// segment object MUST NOT be overwritten," the worker never
	// overwrites in this case; it dead-letters instead so an operator
	// can investigate the collision.
	ErrObjectMismatch = errors.New("upload: existing R2 object does not match expected size/sha256")
)
