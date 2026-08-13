package upload

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// connectivityTestContentType is deliberately plain text: a
// connectivity-test object is never media and must never be mistaken for
// a segment or manifest.
const connectivityTestContentType = "text/plain; charset=utf-8"

// B2ConnectivityResult reports what one isolated connectivity test proved.
// Every field is a boolean or a non-secret identifier - the endpoint,
// access key id, and secret are never represented here, so the result is
// safe to log and to print to an operator.
type B2ConnectivityResult struct {
	Bucket string
	Key    string

	// PutSucceeded is true if the object was accepted at all.
	PutSucceeded bool
	// HeadMatched is true if a subsequent HEAD returned the expected size
	// and the expected sha256 user metadata.
	HeadMatched bool
	// ChecksumAttempted records whether the S3 x-amz-checksum-sha256 header
	// was sent on this attempt.
	ChecksumAttempted bool
	// ChecksumAccepted is the question this whole capability exists to
	// answer: did the real Backblaze endpoint accept a PUT carrying that
	// header? It is NOT proof of enforcement on its own - a provider could
	// ignore an unknown header - which is why the corrupt-checksum probe
	// below exists.
	ChecksumAccepted bool
	// CorruptChecksumRejected is true if a deliberately WRONG checksum was
	// rejected. Together with ChecksumAccepted this is what distinguishes
	// genuine provider-side enforcement from a silently ignored header,
	// and is the evidence required before strong byte-integrity
	// verification may ever be wired to this mechanism.
	CorruptChecksumRejected bool

	Detail string
}

// RunB2ConnectivityTest performs one deliberately tiny, isolated
// write/read probe against the configured B2 bucket.
//
// It is intentionally NOT part of the production archival path and does
// not require production archival to be enabled: a node may hold a valid
// B2 configuration purely so this can be run under explicit approval,
// while real event archival stays off.
//
// Safety properties, all structural rather than conventional:
//   - the key always lives under `_connectivity-test/`, never under
//     `events/`, so it cannot collide with or be mistaken for recording
//     data;
//   - no real event id, studio, or customer identity is used;
//   - the payload is a few dozen bytes of fixed, non-sensitive text;
//   - nothing is ever deleted here. Removing the probe object is a
//     separate, explicitly-approved operator action.
//
// The checksum probes exist to settle whether the real endpoint accepts
// AND enforces x-amz-checksum-sha256. Until that is proven, no production
// path sets that header and no archive claims strong byte-integrity
// verification.
func RunB2ConnectivityTest(ctx context.Context, objectStore ObjectStore, bucket, objectPrefix, nodeID string, requestTimeout time.Duration) (B2ConnectivityResult, error) {
	token, err := newConnectivityToken()
	if err != nil {
		return B2ConnectivityResult{}, fmt.Errorf("b2: generate connectivity test token: %w", err)
	}

	body := "eventcast media agent b2 connectivity test\n"
	sum := sha256.Sum256([]byte(body))
	digestHex := hex.EncodeToString(sum[:])
	digestB64 := base64.StdEncoding.EncodeToString(sum[:])

	key := B2ConnectivityTestKey(objectPrefix, nodeID, token)
	result := B2ConnectivityResult{Bucket: bucket, Key: key, ChecksumAttempted: true}

	// Attempt 1: with the provider checksum header.
	putCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	err = objectStore.PutObject(putCtx, PutObjectInput{
		Key:            key,
		Body:           strings.NewReader(body),
		Size:           int64(len(body)),
		ContentType:    connectivityTestContentType,
		Metadata:       map[string]string{"sha256": digestHex},
		ChecksumSHA256: digestB64,
	})
	cancel()

	if err == nil {
		result.PutSucceeded = true
		result.ChecksumAccepted = true
	} else {
		// Fall back without the header, so a checksum-unsupported endpoint
		// still yields a usable connectivity answer rather than an
		// ambiguous total failure.
		result.Detail = "endpoint rejected the request carrying x-amz-checksum-sha256; retried without it"
		putCtx, cancel = context.WithTimeout(ctx, requestTimeout)
		err = objectStore.PutObject(putCtx, PutObjectInput{
			Key:         key,
			Body:        strings.NewReader(body),
			Size:        int64(len(body)),
			ContentType: connectivityTestContentType,
			Metadata:    map[string]string{"sha256": digestHex},
		})
		cancel()
		if err != nil {
			return result, fmt.Errorf("b2: connectivity test put failed: %w", err)
		}
		result.PutSucceeded = true
	}

	headCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	info, err := objectStore.HeadObject(headCtx, key)
	cancel()
	if err != nil {
		return result, fmt.Errorf("b2: connectivity test head failed: %w", err)
	}
	result.HeadMatched = info.Size == int64(len(body)) && info.Metadata["sha256"] == digestHex

	// Enforcement probe: only meaningful if the header was accepted at all.
	// A deliberately wrong checksum on a DIFFERENT key must be rejected; if
	// it succeeds, the endpoint is ignoring the header and the mechanism
	// cannot be trusted as integrity evidence.
	if result.ChecksumAccepted {
		corruptKey := B2ConnectivityTestKey(objectPrefix, nodeID, token+"-checksum-probe")
		wrongDigest := base64.StdEncoding.EncodeToString(make([]byte, sha256.Size))
		putCtx, cancel = context.WithTimeout(ctx, requestTimeout)
		probeErr := objectStore.PutObject(putCtx, PutObjectInput{
			Key:            corruptKey,
			Body:           strings.NewReader(body),
			Size:           int64(len(body)),
			ContentType:    connectivityTestContentType,
			ChecksumSHA256: wrongDigest,
		})
		cancel()
		result.CorruptChecksumRejected = probeErr != nil
	}

	return result, nil
}

// newConnectivityToken returns a short random hex token, so repeated runs
// never collide and no probe object is ever overwritten.
func newConnectivityToken() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return time.Now().UTC().Format("20060102T150405Z") + "-" + hex.EncodeToString(b[:]), nil
}
