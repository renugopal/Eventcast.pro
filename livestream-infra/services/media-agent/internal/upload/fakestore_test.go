package upload

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
)

// fakeObject is one object recorded by fakeObjectStore.
type fakeObject struct {
	body        string
	size        int64
	contentType string
	metadata    map[string]string
}

// fakeObjectStore is an in-memory ObjectStore used by unit tests that
// need to simulate specific failure modes (timeouts, provider errors,
// injected flakiness) without a network dependency. The real R2Client
// and the integration-test proof both exercise the identical interface
// against a real HTTP S3-compatible service (Cloudflare R2 in
// production, a pinned MinIO container in the integration test); this
// fake never substitutes for that proof.
type fakeObjectStore struct {
	mu      sync.Mutex
	objects map[string]fakeObject

	// failPutNTimes, if > 0, makes the next N PutObject calls fail with
	// failErr before succeeding, simulating a transient provider/network
	// fault that later recovers.
	failPutNTimes int
	failErr       error

	// failHeadWith, if non-nil, makes every HeadObject call for a key
	// not already in objects fail with this error instead of
	// ErrObjectNotFound (simulating a provider outage during
	// HEAD-before-PUT).
	failHeadWith error

	// enforceChecksum makes the fake behave like a provider that actually
	// VERIFIES x-amz-checksum-sha256: a PUT whose declared checksum does
	// not match the body it received is rejected.
	enforceChecksum bool

	// rejectChecksumHeader makes the fake behave like a provider that does
	// not support the checksum header at all, rejecting any PUT that
	// carries one. Used to prove production archival never silently
	// downgrades to an unverified upload.
	rejectChecksumHeader bool

	putCount  int
	headCount int
	getCount  int
}

func newFakeObjectStore() *fakeObjectStore {
	return &fakeObjectStore{objects: make(map[string]fakeObject)}
}

func (f *fakeObjectStore) PutObject(ctx context.Context, in PutObjectInput) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.putCount++

	if f.failPutNTimes > 0 {
		f.failPutNTimes--
		return f.failErr
	}

	body, err := io.ReadAll(in.Body)
	if err != nil {
		return fmt.Errorf("fake read body: %w", err)
	}
	if int64(len(body)) != in.Size {
		return fmt.Errorf("fake: body length %d does not match declared size %d", len(body), in.Size)
	}

	if in.ChecksumSHA256 != "" {
		if f.rejectChecksumHeader {
			return fmt.Errorf("fake: endpoint does not support x-amz-checksum-sha256")
		}
		if f.enforceChecksum {
			sum := sha256.Sum256(body)
			if base64.StdEncoding.EncodeToString(sum[:]) != in.ChecksumSHA256 {
				return fmt.Errorf("fake: checksum mismatch, rejecting upload")
			}
		}
	}

	metadata := make(map[string]string, len(in.Metadata))
	for k, v := range in.Metadata {
		metadata[k] = v
	}
	f.objects[in.Key] = fakeObject{body: string(body), size: in.Size, contentType: in.ContentType, metadata: metadata}
	return nil
}

// GetObject implements ObjectStore, returning the exact stored bytes so a
// read-back verification test can observe real corruption.
func (f *fakeObjectStore) GetObject(ctx context.Context, key string) (io.ReadCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.getCount++

	obj, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
	}
	return io.NopCloser(strings.NewReader(obj.body)), nil
}

// corruptBody replaces the stored BYTES (not merely metadata) for key,
// simulating silent at-rest corruption that only a real read-back can
// detect - size and metadata are deliberately left consistent.
func (f *fakeObjectStore) corruptBody(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	obj, ok := f.objects[key]
	if !ok {
		return
	}
	corrupted := []byte(obj.body)
	if len(corrupted) == 0 {
		return
	}
	corrupted[0] ^= 0xFF
	obj.body = string(corrupted)
	f.objects[key] = obj
}

func (f *fakeObjectStore) HeadObject(ctx context.Context, key string) (ObjectInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.headCount++

	obj, ok := f.objects[key]
	if !ok {
		if f.failHeadWith != nil {
			return ObjectInfo{}, f.failHeadWith
		}
		return ObjectInfo{}, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
	}
	return ObjectInfo{Exists: true, Size: obj.size, ContentType: obj.contentType, Metadata: obj.metadata}, nil
}

func (f *fakeObjectStore) has(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.objects[key]
	return ok
}

func (f *fakeObjectStore) corrupt(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	obj := f.objects[key]
	obj.metadata = map[string]string{"sha256": "0000000000000000000000000000000000000000000000000000000000000000"}
	f.objects[key] = obj
}

func (f *fakeObjectStore) counts() (put, head int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.putCount, f.headCount
}

// errRetryable and errAuth are stand-ins for classifyUploadError's
// generic-retryable and auth-typed-error paths without needing a real
// smithy error value in these tests.
var errRetryable = errors.New("fake: simulated transient network error")
