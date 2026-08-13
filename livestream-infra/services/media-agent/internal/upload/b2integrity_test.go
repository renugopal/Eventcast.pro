package upload

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// withIntegrityMode rebuilds the fixture's archiver with mode, reusing the
// same store and B2 fake so a test can compare modes over identical state.
func (f *archiveFixture) withIntegrityMode(t *testing.T, mode B2IntegrityMode) *archiveFixture {
	t.Helper()
	f.archiver = NewB2Archiver(f.store, f.b2, B2ArchiveConfig{
		Bucket:         "eventcast-vod-test",
		RequestTimeout: 5 * time.Second,
		IntegrityMode:  mode,
	}, testLogger(t))
	return f
}

// corruptSpoolFile replaces a confirmed segment's local bytes with
// different content of the SAME length, so neither the declared size nor
// the sha256 user metadata (both derived from the durable record, not from
// the file) can reveal the change. Only a mechanism that inspects real
// bytes can catch this.
func corruptSpoolFile(t *testing.T, path string, length int) {
	t.Helper()
	corrupted := []byte(strings.Repeat("X", length))
	if err := os.WriteFile(path, corrupted, 0o600); err != nil {
		t.Fatalf("corrupt spool file: %v", err)
	}
}

func TestParseB2IntegrityModeAcceptsSupportedValues(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want B2IntegrityMode
	}{
		{"", B2IntegrityNone}, // unset must resolve to the safe default
		{"none", B2IntegrityNone},
		{"provider_checksum", B2IntegrityProviderChecksum},
		{"read_back", B2IntegrityReadBack},
	} {
		got, err := ParseB2IntegrityMode(tc.raw)
		if err != nil {
			t.Fatalf("ParseB2IntegrityMode(%q) error: %v", tc.raw, err)
		}
		if got != tc.want {
			t.Errorf("ParseB2IntegrityMode(%q) = %q, want %q", tc.raw, got, tc.want)
		}
	}
}

// An unrecognised mode must be an error, never a silent fallback to "no
// verification" - a typo would otherwise disable the exact protection it
// was meant to switch on.
func TestParseB2IntegrityModeFailsClosedOnUnknownValue(t *testing.T) {
	for _, raw := range []string{"sha256", "true", "readback", "PROVIDER_CHECKSUM", "strong"} {
		got, err := ParseB2IntegrityMode(raw)
		if err == nil {
			t.Errorf("ParseB2IntegrityMode(%q) = %q, want an error", raw, got)
		}
	}
}

func TestB2IntegrityModeStrongVerification(t *testing.T) {
	if B2IntegrityNone.StrongVerification() {
		t.Error("none must not claim strong verification")
	}
	if !B2IntegrityProviderChecksum.StrongVerification() {
		t.Error("provider_checksum must claim strong verification")
	}
	if !B2IntegrityReadBack.StrongVerification() {
		t.Error("read_back must claim strong verification")
	}
}

func TestSHA256HexToBase64(t *testing.T) {
	// Well-known: SHA-256 of the empty string.
	const emptyHex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	const emptyB64 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="

	got, err := sha256HexToBase64(emptyHex)
	if err != nil {
		t.Fatalf("sha256HexToBase64() error: %v", err)
	}
	if got != emptyB64 {
		t.Errorf("sha256HexToBase64() = %q, want %q", got, emptyB64)
	}

	for _, bad := range []string{"", "zz", "abcd", strings.Repeat("a", 63), strings.Repeat("a", 66)} {
		if _, err := sha256HexToBase64(bad); err == nil {
			t.Errorf("sha256HexToBase64(%q) succeeded, want an error", bad)
		}
	}
}

// provider_checksum against a provider that genuinely verifies the header
// must archive normally.
func TestB2ArchiverProviderChecksumModeArchivesAgainstEnforcingProvider(t *testing.T) {
	f := newArchiveFixture(t).withIntegrityMode(t, B2IntegrityProviderChecksum)
	f.b2.enforceChecksum = true

	result, err := f.archiver.ArchiveEvent(context.Background(), f.eventID, f.generation())
	if err != nil {
		t.Fatalf("ArchiveEvent() error: %v", err)
	}
	if !result.Archived {
		t.Fatalf("ArchiveEvent() did not archive: %s", result.Reason)
	}
}

// The point of the mode: corrupted bytes are rejected by the provider, so
// the pass fails and the event is never recorded as archived.
func TestB2ArchiverProviderChecksumModeDetectsCorruptedBytes(t *testing.T) {
	f := newArchiveFixture(t).withIntegrityMode(t, B2IntegrityProviderChecksum)
	f.b2.enforceChecksum = true
	corruptSpoolFile(t, f.confirmed[0].SpoolPath, int(f.confirmed[0].ByteSize))

	result, err := f.archiver.ArchiveEvent(context.Background(), f.eventID, f.generation())
	if err == nil {
		t.Fatalf("ArchiveEvent() succeeded on corrupted bytes; result=%+v", result)
	}
	if result.Archived {
		t.Error("a rejected upload must never report Archived")
	}
}

// No silent downgrade: if the endpoint refuses the checksum header, the
// archiver must fail rather than retry without it. Retrying bare would
// store the object while quietly voiding the integrity claim.
func TestB2ArchiverProviderChecksumModeNeverSilentlyDowngrades(t *testing.T) {
	f := newArchiveFixture(t).withIntegrityMode(t, B2IntegrityProviderChecksum)
	f.b2.rejectChecksumHeader = true

	result, err := f.archiver.ArchiveEvent(context.Background(), f.eventID, f.generation())
	if err == nil {
		t.Fatalf("ArchiveEvent() succeeded despite an unsupported checksum header; result=%+v", result)
	}
	if result.Archived {
		t.Error("Archived must be false when the checksum header was refused")
	}
	for _, s := range f.confirmed {
		key := B2SegmentKey("", f.eventID, s.SessionID, s.SHA256, s.LocalFileIdentity)
		if f.b2.has(key) {
			t.Errorf("object %q was stored without its checksum; that is a silent downgrade", key)
		}
	}
}

func TestB2ArchiverReadBackModeArchivesAndReadsEveryObject(t *testing.T) {
	f := newArchiveFixture(t).withIntegrityMode(t, B2IntegrityReadBack)

	result, err := f.archiver.ArchiveEvent(context.Background(), f.eventID, f.generation())
	if err != nil {
		t.Fatalf("ArchiveEvent() error: %v", err)
	}
	if !result.Archived {
		t.Fatalf("ArchiveEvent() did not archive: %s", result.Reason)
	}
	// Every segment plus the playlist must have been read back.
	if want := len(f.confirmed) + 1; f.b2.getCount != want {
		t.Errorf("GetObject calls = %d, want %d (each segment plus the playlist)", f.b2.getCount, want)
	}
}

// The scenario read_back exists for: bytes that differ at rest while the
// declared size and the sha256 user metadata both still look correct.
// HEAD alone cannot catch this; hashing the returned bytes must.
func TestB2ArchiverReadBackModeDetectsStoredByteCorruption(t *testing.T) {
	f := newArchiveFixture(t).withIntegrityMode(t, B2IntegrityReadBack)
	corruptSpoolFile(t, f.confirmed[0].SpoolPath, int(f.confirmed[0].ByteSize))

	result, err := f.archiver.ArchiveEvent(context.Background(), f.eventID, f.generation())
	if err == nil {
		t.Fatalf("ArchiveEvent() succeeded on corrupted stored bytes; result=%+v", result)
	}
	if !errors.Is(err, ErrB2IntegrityVerificationFailed) {
		t.Errorf("error = %v, want it to wrap ErrB2IntegrityVerificationFailed", err)
	}
	if result.Archived {
		t.Error("a failed integrity check must never report Archived")
	}
}

// Corruption that read_back catches must be invisible to the default mode,
// which is precisely why the default makes no strong claim.
func TestB2ArchiverNoneModePerformsNoReadBackAndMissesByteCorruption(t *testing.T) {
	f := newArchiveFixture(t).withIntegrityMode(t, B2IntegrityNone)
	corruptSpoolFile(t, f.confirmed[0].SpoolPath, int(f.confirmed[0].ByteSize))

	result, err := f.archiver.ArchiveEvent(context.Background(), f.eventID, f.generation())
	if err != nil {
		t.Fatalf("ArchiveEvent() error: %v", err)
	}
	if !result.Archived {
		t.Fatalf("ArchiveEvent() did not archive: %s", result.Reason)
	}
	if f.b2.getCount != 0 {
		t.Errorf("GetObject calls = %d, want 0 in the default mode", f.b2.getCount)
	}
}

// A strong mode with nothing to verify against must fail closed rather
// than pass an object through unverified.
func TestPutAndVerifyStrongModeRequiresAnExpectedDigest(t *testing.T) {
	f := newArchiveFixture(t).withIntegrityMode(t, B2IntegrityReadBack)

	err := f.archiver.putAndVerify(context.Background(), PutObjectInput{
		Key:         "some/key",
		Body:        strings.NewReader("body"),
		Size:        4,
		ContentType: "text/plain",
	}, 4, "")
	if err == nil {
		t.Fatal("putAndVerify() succeeded with no expected digest under a strong mode")
	}
	if f.b2.has("some/key") {
		t.Error("no object may be written when the strong-mode precondition fails")
	}
}
