package upload

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// B2IntegrityMode selects how an archived B2 object is proven to hold the
// exact bytes the local spool holds.
//
// Two mechanisms are prepared deliberately, because which one is usable is
// a property of the real Backblaze endpoint and is NOT yet proven. The
// isolated connectivity test (b2connectivity.go) is the authority for that
// choice: it reports both whether the endpoint accepts
// x-amz-checksum-sha256 and, critically, whether it actually REJECTS a
// deliberately wrong one. Accepting the header while ignoring it is
// indistinguishable from enforcement without that second probe, which is
// exactly why neither mode is enabled by default.
//
// Selecting a mode is an explicit operator decision. The zero value is
// B2IntegrityNone, so an unset variable can never silently promote a
// weaker archive into a strong integrity claim.
type B2IntegrityMode string

const (
	// B2IntegrityNone makes no strong byte-integrity claim. The archiver
	// still performs its existing post-PUT HEAD (size plus sha256 user
	// metadata), which proves presence and metadata consistency only -
	// the provider echoing back metadata this same process supplied is
	// not evidence about the stored bytes.
	B2IntegrityNone B2IntegrityMode = "none"

	// B2IntegrityProviderChecksum sends the base64 SHA-256 of the body as
	// the S3 x-amz-checksum-sha256 header, so the PROVIDER verifies the
	// bytes it stored and rejects a corrupted upload server-side.
	//
	// Only valid once a real connectivity probe has shown the endpoint
	// both accepts AND enforces that header. Unlike the connectivity
	// probe, this mode never retries without the header: silently falling
	// back would downgrade a strong claim into an unverified one.
	B2IntegrityProviderChecksum B2IntegrityMode = "provider_checksum"

	// B2IntegrityReadBack re-reads the stored object and hashes the bytes
	// actually returned, comparing them against the locally-known digest.
	//
	// It depends on no provider-specific checksum feature, at the cost of
	// one extra full read per object. Hashing is streamed, so memory use
	// stays bounded regardless of recording length. HEAD metadata and
	// object size are deliberately NOT accepted as substitutes here.
	B2IntegrityReadBack B2IntegrityMode = "read_back"
)

// ErrB2IntegrityVerificationFailed is returned when a strong verification
// mode ran and the stored object did not match the expected digest.
//
// This is a fail-closed invariant violation, surfaced to the archiver as a
// plain error so the event is simply not recorded as archived - which in
// turn keeps the retention gate refusing to release local spool bytes.
var ErrB2IntegrityVerificationFailed = errors.New("upload: B2 integrity verification failed")

// ParseB2IntegrityMode converts an operator-supplied value into a mode.
//
// An empty value means "not configured" and resolves to B2IntegrityNone.
// Any other unrecognised value is an error rather than a silent fallback:
// a typo in an integrity setting must never quietly disable the very
// verification it was meant to turn on.
func ParseB2IntegrityMode(raw string) (B2IntegrityMode, error) {
	switch B2IntegrityMode(raw) {
	case "":
		return B2IntegrityNone, nil
	case B2IntegrityNone, B2IntegrityProviderChecksum, B2IntegrityReadBack:
		return B2IntegrityMode(raw), nil
	default:
		return "", fmt.Errorf("unsupported integrity mode %q: want one of %q, %q, %q",
			raw, B2IntegrityNone, B2IntegrityProviderChecksum, B2IntegrityReadBack)
	}
}

// StrongVerification reports whether the mode makes a real claim about the
// stored bytes, as opposed to presence and metadata consistency only.
func (m B2IntegrityMode) StrongVerification() bool {
	return m == B2IntegrityProviderChecksum || m == B2IntegrityReadBack
}

// sha256HexToBase64 converts the lowercase hex digest the pipeline stores
// (and writes as sha256 user metadata) into the base64 form the S3
// checksum header requires. It rejects anything that is not a real
// 32-byte SHA-256, so a malformed digest fails closed here rather than
// being sent to the provider as a checksum that cannot match.
func sha256HexToBase64(hexDigest string) (string, error) {
	raw, err := hex.DecodeString(hexDigest)
	if err != nil {
		return "", fmt.Errorf("malformed sha256 hex digest: %w", err)
	}
	if len(raw) != sha256.Size {
		return "", fmt.Errorf("sha256 digest must be %d bytes, got %d", sha256.Size, len(raw))
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// sha256HexOfBytes returns the lowercase hex SHA-256 of b, in the same
// form the segment pipeline already stores as sha256 user metadata.
func sha256HexOfBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// verifyObjectReadBack streams the stored object at key and compares the
// SHA-256 of the bytes actually returned against expectedHex.
//
// The body is hashed incrementally through io.Copy rather than buffered,
// so a multi-gigabyte recording verifies in constant memory.
func verifyObjectReadBack(ctx context.Context, objectStore ObjectStore, key, expectedHex string) error {
	body, err := objectStore.GetObject(ctx, key)
	if err != nil {
		return fmt.Errorf("read back object %s: %w", key, err)
	}
	defer body.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, body); err != nil {
		return fmt.Errorf("read back object %s: %w", key, err)
	}

	actual := hex.EncodeToString(hasher.Sum(nil))
	if actual != expectedHex {
		// Neither digest is a secret, but they are also not useful to an
		// operator and would be noise in logs; the key plus the sentinel
		// is enough to identify and act on the failure.
		return fmt.Errorf("%w: read-back digest mismatch for key %s", ErrB2IntegrityVerificationFailed, key)
	}
	return nil
}
