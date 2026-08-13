// Package upload implements ordered R2 publication: the durable upload
// worker, live/DVR and VOD manifest generation, and local-spool
// retention. See 02_V1_ARCHITECTURE_SPEC.md "Segment upload and
// verification", "Authoritative live manifest", "VOD finalization", and
// "Retention and deletion".
package upload

import (
	"context"
	"errors"
	"io"
)

// ObjectInfo describes an object discovered via HeadObject.
type ObjectInfo struct {
	Exists      bool
	Size        int64
	ContentType string
	// Metadata is the object's user-defined metadata (S3/R2 "x-amz-meta-*"
	// headers, exposed without that prefix), used as the "strongest
	// reliable metadata" verification source instead of ETag
	// (02_V1_ARCHITECTURE_SPEC.md "The implementation MUST NOT depend on
	// multipart ETag as a universal content checksum").
	Metadata map[string]string
}

// ErrObjectNotFound is returned by HeadObject when the object does not
// exist. It is a sentinel so callers can distinguish "not uploaded yet"
// from every other provider error, which must be treated as retryable
// or terminal per the caller's own classification, never silently
// treated the same as "not found."
var ErrObjectNotFound = errors.New("upload: object not found")

// PutObjectInput describes one object to upload.
type PutObjectInput struct {
	Key         string
	Body        io.ReadSeeker
	Size        int64
	ContentType string
	// Metadata is written as object user metadata. Per
	// 02_V1_ARCHITECTURE_SPEC.md "R2 object layout", segment uploads
	// SHOULD set SHA-256, event ID, session ID, sequence, and duration.
	Metadata map[string]string
	// CacheControl sets the Cache-Control response header R2/Cloudflare
	// cache rules key off of (ADR-021: live manifests must never be
	// cached; immutable segments and finalized VOD manifests may be).
	CacheControl string
	// ChecksumSHA256 is the base64-encoded SHA-256 digest of Body, sent as
	// the S3 x-amz-checksum-sha256 header so the PROVIDER verifies the
	// bytes it stored and rejects a corrupted upload server-side.
	//
	// Deliberately empty on every production path today. Whether the real
	// Backblaze B2 S3 endpoint accepts and *enforces* this header is
	// unproven, and an unverified assumption must not sit underneath the
	// authoritative archive's integrity claim. It is exercised only by the
	// isolated connectivity-test capability (b2connectivity.go), whose
	// result will decide whether strong byte-integrity verification is
	// wired to this header or to a read-back/hash fallback.
	ChecksumSHA256 string
}

// ObjectStore is the minimal S3-compatible surface the upload worker,
// manifest manager, and VOD finalizer need. It exists so unit tests can
// substitute an in-memory fake without a network dependency, while the
// production implementation (R2Client, below) and the integration-test
// proof both exercise the identical real HTTP S3-compatible API
// (Cloudflare R2 in production, a pinned MinIO container in tests) -
// this is one interface over one production provider, not a second
// storage backend.
type ObjectStore interface {
	// PutObject uploads in.Body as a single request. HLS segments are
	// small enough that multipart upload is never required V1-wide; see
	// 02_V1_ARCHITECTURE_SPEC.md "Segment upload and verification":
	// "HLS segments should use the simplest correct upload path."
	PutObject(ctx context.Context, in PutObjectInput) error
	// HeadObject returns ErrObjectNotFound (wrapped) if the key does not
	// exist, or any other error verbatim (classified by the caller).
	HeadObject(ctx context.Context, key string) (ObjectInfo, error)
	// GetObject streams the stored object's bytes. The caller must Close
	// the returned reader.
	//
	// It exists so B2IntegrityReadBack can hash what the provider actually
	// returns, rather than trusting HEAD metadata this same process
	// supplied. It returns ErrObjectNotFound (wrapped) on a missing key,
	// matching HeadObject. No archival or upload path reads objects back
	// for any other purpose - there is still no GetObject-based backfill.
	GetObject(ctx context.Context, key string) (io.ReadCloser, error)
}
