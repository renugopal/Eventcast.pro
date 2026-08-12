package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testAssignment(ingestID string) Assignment {
	now := time.Now().UTC()
	return Assignment{
		IngestID:             ingestID,
		EventID:              "event-" + ingestID,
		PlaybackID:           "pb-" + ingestID,
		SecretTokenHash:      HashToken("super-secret-token-" + ingestID),
		Enabled:              true,
		PublishWindowStartAt: now.Add(-time.Hour),
		PublishWindowEndAt:   now.Add(time.Hour),
		ConfigVersion:        "1",
		UpdatedAt:            now,
	}
}

func TestHashTokenAndVerifyToken(t *testing.T) {
	a := testAssignment("stream-1")
	if !a.VerifyToken("super-secret-token-stream-1") {
		t.Error("VerifyToken() = false for the correct token, want true")
	}
	if a.VerifyToken("wrong-token") {
		t.Error("VerifyToken() = true for an incorrect token, want false")
	}
	if a.VerifyToken("") {
		t.Error("VerifyToken() = true for an empty token, want false")
	}
}

func TestVerifyTokenRejectsMalformedStoredHash(t *testing.T) {
	a := testAssignment("stream-1")
	a.SecretTokenHash = "not-hex"
	if a.VerifyToken("super-secret-token-stream-1") {
		t.Error("VerifyToken() = true with a malformed stored hash, want false")
	}
}

func TestAssignmentValidateRejectsBadInput(t *testing.T) {
	cases := []struct {
		name string
		mod  func(a *Assignment)
	}{
		{"empty ingest id", func(a *Assignment) { a.IngestID = "" }},
		{"empty event id", func(a *Assignment) { a.EventID = "" }},
		{"empty playback id", func(a *Assignment) { a.PlaybackID = "" }},
		{"short hash", func(a *Assignment) { a.SecretTokenHash = "abcd" }},
		{"non-hex hash", func(a *Assignment) { a.SecretTokenHash = "zz" + a.SecretTokenHash[2:] }},
		{"zero start", func(a *Assignment) { a.PublishWindowStartAt = time.Time{} }},
		{"zero end", func(a *Assignment) { a.PublishWindowEndAt = time.Time{} }},
		{"end before start", func(a *Assignment) {
			a.PublishWindowStartAt, a.PublishWindowEndAt = a.PublishWindowEndAt, a.PublishWindowStartAt
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := testAssignment("stream-1")
			tc.mod(&a)
			if err := a.Validate(); err == nil {
				t.Fatalf("Validate() expected error for %s, got nil", tc.name)
			}
		})
	}
}

func TestSanitizeSeedAssignmentsForcesDisabledByDefault(t *testing.T) {
	enabled := testAssignment("stream-1")
	disabled := testAssignment("stream-2")
	disabled.Enabled = false

	got := SanitizeSeedAssignments([]Assignment{enabled, disabled}, false)

	if got[0].Enabled {
		t.Error("SanitizeSeedAssignments(allowEnabled=false)[0].Enabled = true, want false")
	}
	if got[1].Enabled {
		t.Error("SanitizeSeedAssignments(allowEnabled=false)[1].Enabled = true, want false")
	}
	// Every other field must pass through unchanged.
	if got[0].IngestID != enabled.IngestID || got[0].SecretTokenHash != enabled.SecretTokenHash {
		t.Error("SanitizeSeedAssignments(allowEnabled=false) altered a field other than Enabled")
	}
}

func TestSanitizeSeedAssignmentsPassesThroughWhenAllowed(t *testing.T) {
	enabled := testAssignment("stream-1")

	got := SanitizeSeedAssignments([]Assignment{enabled}, true)

	if !got[0].Enabled {
		t.Error("SanitizeSeedAssignments(allowEnabled=true)[0].Enabled = false, want true (unchanged)")
	}
}

func TestSanitizeSeedAssignmentsDoesNotMutateInput(t *testing.T) {
	enabled := testAssignment("stream-1")
	input := []Assignment{enabled}

	_ = SanitizeSeedAssignments(input, false)

	if !input[0].Enabled {
		t.Error("SanitizeSeedAssignments mutated its input slice's Enabled field; want the input left untouched")
	}
}

func TestImportAssignmentsInsertsAndUpdates(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	a := testAssignment("stream-1")
	n, err := st.ImportAssignments(ctx, []Assignment{a})
	if err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}
	if n != 1 {
		t.Fatalf("ImportAssignments() imported = %d, want 1", n)
	}

	got, found, err := st.GetAssignment(ctx, "stream-1")
	if err != nil {
		t.Fatalf("GetAssignment() error: %v", err)
	}
	if !found {
		t.Fatal("GetAssignment() found = false, want true")
	}
	if got.EventID != a.EventID || got.PlaybackID != a.PlaybackID {
		t.Errorf("GetAssignment() = %+v, want event/playback matching %+v", got, a)
	}

	// Re-import with a changed field must update in place, not duplicate.
	a.Enabled = false
	a.ConfigVersion = "2"
	if _, err := st.ImportAssignments(ctx, []Assignment{a}); err != nil {
		t.Fatalf("ImportAssignments() update error: %v", err)
	}

	updated, found, err := st.GetAssignment(ctx, "stream-1")
	if err != nil {
		t.Fatalf("GetAssignment() error: %v", err)
	}
	if !found {
		t.Fatal("GetAssignment() found = false after update, want true")
	}
	if updated.Enabled {
		t.Error("Enabled = true after update, want false")
	}
	if updated.ConfigVersion != "2" {
		t.Errorf("ConfigVersion = %q, want %q", updated.ConfigVersion, "2")
	}

	count, err := st.AssignmentCount(ctx)
	if err != nil {
		t.Fatalf("AssignmentCount() error: %v", err)
	}
	if count != 1 {
		t.Errorf("AssignmentCount() = %d, want 1 (update must not duplicate)", count)
	}
}

func TestImportAssignmentsIsAllOrNothing(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	valid := testAssignment("stream-1")
	invalid := testAssignment("stream-2")
	invalid.EventID = ""

	if _, err := st.ImportAssignments(ctx, []Assignment{valid, invalid}); err == nil {
		t.Fatal("ImportAssignments() expected error for a batch containing an invalid assignment, got nil")
	}

	_, found, err := st.GetAssignment(ctx, "stream-1")
	if err != nil {
		t.Fatalf("GetAssignment() error: %v", err)
	}
	if found {
		t.Error("GetAssignment() found the valid half of a rejected batch; import must be all-or-nothing")
	}
}

func TestGetAssignmentNotFound(t *testing.T) {
	st := openTestStore(t)
	_, found, err := st.GetAssignment(context.Background(), "unknown-stream")
	if err != nil {
		t.Fatalf("GetAssignment() error: %v", err)
	}
	if found {
		t.Error("GetAssignment() found = true for an unknown ingest id, want false")
	}
}

func TestLoadAssignmentsFromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "assignments.json")
	body := `[{
		"ingest_id": "stream-1",
		"event_id": "event-1",
		"playback_id": "pb-1",
		"stream_secret_hash": "` + HashToken("secret") + `",
		"enabled": true,
		"publish_window_start_at": "2026-01-01T00:00:00Z",
		"publish_window_end_at": "2026-01-01T04:00:00Z",
		"config_version": "1"
	}]`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write seed file: %v", err)
	}

	assignments, err := LoadAssignmentsFromFile(path)
	if err != nil {
		t.Fatalf("LoadAssignmentsFromFile() error: %v", err)
	}
	if len(assignments) != 1 {
		t.Fatalf("len(assignments) = %d, want 1", len(assignments))
	}
	if assignments[0].IngestID != "stream-1" {
		t.Errorf("IngestID = %q, want %q", assignments[0].IngestID, "stream-1")
	}
}

func TestLoadAssignmentsFromFileRejectsInvalidEntry(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "assignments.json")
	body := `[{"ingest_id": "stream-1"}]` // missing required fields
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write seed file: %v", err)
	}

	if _, err := LoadAssignmentsFromFile(path); err == nil {
		t.Fatal("LoadAssignmentsFromFile() expected error for an invalid entry, got nil")
	}
}

func TestLoadAssignmentsFromFileRejectsMissingFile(t *testing.T) {
	if _, err := LoadAssignmentsFromFile(filepath.Join(t.TempDir(), "does-not-exist.json")); err == nil {
		t.Fatal("LoadAssignmentsFromFile() expected error for a missing file, got nil")
	}
}

func TestLoadAssignmentsFromFileRejectsMalformedJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "assignments.json")
	if err := os.WriteFile(path, []byte(`{not valid json`), 0o600); err != nil {
		t.Fatalf("write seed file: %v", err)
	}

	if _, err := LoadAssignmentsFromFile(path); err == nil {
		t.Fatal("LoadAssignmentsFromFile() expected error for malformed JSON, got nil")
	}
}

func TestGetAssignmentByEventID(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	a := testAssignment("stream-1")
	if _, err := st.ImportAssignments(ctx, []Assignment{a}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}

	got, found, err := st.GetAssignmentByEventID(ctx, a.EventID)
	if err != nil || !found {
		t.Fatalf("GetAssignmentByEventID() found=%v err=%v", found, err)
	}
	if got.PlaybackID != a.PlaybackID {
		t.Errorf("PlaybackID = %q, want %q", got.PlaybackID, a.PlaybackID)
	}

	if _, found, err := st.GetAssignmentByEventID(ctx, "no-such-event"); err != nil || found {
		t.Errorf("GetAssignmentByEventID() for unknown event: found=%v err=%v", found, err)
	}
}

// TestGetAssignmentByEventIDSelectsCurrentControlPlaneRowByConfigVersion
// reproduces the exact production failure shape observed on validation
// event b68d4796-e234-42af-9efc-39576125e9a0: many historical rows for
// the same event_id, inserted out of order relative to config_version,
// where the current row is neither the newest by insertion nor the only
// enabled one. This must select purely by (source, config_version),
// never by physical insertion order.
func TestGetAssignmentByEventIDSelectsCurrentControlPlaneRowByConfigVersion(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	old := testAssignment("ingest-old")
	old.EventID = "event-multi"
	old.PlaybackID = "pb-old"
	old.Enabled = false
	old.ConfigVersion = "2"

	current := testAssignment("ingest-current")
	current.EventID = "event-multi"
	current.PlaybackID = "pb-current"
	current.Enabled = true
	current.ConfigVersion = "26"

	// Deliberately imported current-before-old so a physical/insertion-
	// order-based query would pick the wrong row.
	if _, err := st.ImportAssignments(ctx, []Assignment{current, old}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}
	markControlPlaneSourced(t, st, "ingest-old", "ingest-current")

	got, found, err := st.GetAssignmentByEventID(ctx, "event-multi")
	if err != nil || !found {
		t.Fatalf("GetAssignmentByEventID() found=%v err=%v", found, err)
	}
	if got.PlaybackID != "pb-current" {
		t.Errorf("PlaybackID = %q, want %q (the current, higher config_version row)", got.PlaybackID, "pb-current")
	}
	if got.ConfigVersion != "26" {
		t.Errorf("ConfigVersion = %q, want %q", got.ConfigVersion, "26")
	}
}

// TestGetAssignmentByEventIDPrefersHigherConfigVersionOverEnabled proves
// the inverse of the naive "just filter enabled=true" fix: a newer,
// disabled row (the real current state - e.g. deactivated pending
// reactivation) must still beat an older, enabled historical row.
// enabled/disabled is assignment state, not row freshness, and must
// never be used as the selection signal.
func TestGetAssignmentByEventIDPrefersHigherConfigVersionOverEnabled(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	olderEnabled := testAssignment("ingest-older-enabled")
	olderEnabled.EventID = "event-disabled-current"
	olderEnabled.PlaybackID = "pb-older-enabled"
	olderEnabled.Enabled = true
	olderEnabled.ConfigVersion = "4"

	newerDisabled := testAssignment("ingest-newer-disabled")
	newerDisabled.EventID = "event-disabled-current"
	newerDisabled.PlaybackID = "pb-newer-disabled"
	newerDisabled.Enabled = false
	newerDisabled.ConfigVersion = "6"

	if _, err := st.ImportAssignments(ctx, []Assignment{olderEnabled, newerDisabled}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}
	markControlPlaneSourced(t, st, "ingest-older-enabled", "ingest-newer-disabled")

	got, found, err := st.GetAssignmentByEventID(ctx, "event-disabled-current")
	if err != nil || !found {
		t.Fatalf("GetAssignmentByEventID() found=%v err=%v", found, err)
	}
	if got.PlaybackID != "pb-newer-disabled" {
		t.Errorf("PlaybackID = %q, want %q (higher config_version wins even though disabled)", got.PlaybackID, "pb-newer-disabled")
	}
	if got.Enabled {
		t.Error("Enabled = true, want false (the correct current row is disabled)")
	}
}

// TestGetAssignmentByEventIDPrefersControlPlaneOverSeedRegardlessOfVersion
// proves the documented precedence (controlplane.go: "a seed row is
// never allowed to overwrite a controlplane row") holds even when a
// seed row's arbitrary, operator-supplied config_version number is
// numerically higher than the real control-plane row's.
func TestGetAssignmentByEventIDPrefersControlPlaneOverSeedRegardlessOfVersion(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	seedRow := testAssignment("ingest-seed")
	seedRow.EventID = "event-seed-vs-cp"
	seedRow.PlaybackID = "pb-seed"
	seedRow.ConfigVersion = "999"

	cpRow := testAssignment("ingest-cp")
	cpRow.EventID = "event-seed-vs-cp"
	cpRow.PlaybackID = "pb-cp"
	cpRow.ConfigVersion = "3"

	// seedRow stays source='seed' (ImportAssignments' default); only
	// cpRow is marked controlplane-sourced.
	if _, err := st.ImportAssignments(ctx, []Assignment{seedRow, cpRow}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}
	markControlPlaneSourced(t, st, "ingest-cp")

	got, found, err := st.GetAssignmentByEventID(ctx, "event-seed-vs-cp")
	if err != nil || !found {
		t.Fatalf("GetAssignmentByEventID() found=%v err=%v", found, err)
	}
	if got.PlaybackID != "pb-cp" {
		t.Errorf("PlaybackID = %q, want %q (controlplane source must win despite the seed row's higher config_version)", got.PlaybackID, "pb-cp")
	}
}

// markControlPlaneSourced sets source='controlplane' for the given
// ingest_ids. ImportAssignments (the seed-file path) never touches
// source, so every row it inserts keeps the column's own schema default
// ('seed') unless a test explicitly promotes it here - this exercises
// GetAssignmentByEventID's source precedence without duplicating
// ApplyControlPlaneAssignments' own separately-tested upsert logic.
func markControlPlaneSourced(t *testing.T, st *Store, ingestIDs ...string) {
	t.Helper()
	for _, id := range ingestIDs {
		if _, err := st.db.Exec(`UPDATE cached_event_assignments SET source = 'controlplane' WHERE ingest_id = ?`, id); err != nil {
			t.Fatalf("markControlPlaneSourced(%s): %v", id, err)
		}
	}
}

func TestYouTubeFieldsPersistExceptTheRawStreamKey(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	a := testAssignment("stream-1")
	a.YouTubeEnabled = true
	a.YouTubeDestinationBaseURL = "rtmp://a.rtmp.youtube.com/live2"
	a.YouTubeStreamKey = "super-secret-stream-key"
	if _, err := st.ImportAssignments(ctx, []Assignment{a}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}

	got, found, err := st.GetAssignment(ctx, a.IngestID)
	if err != nil || !found {
		t.Fatalf("GetAssignment() found=%v err=%v", found, err)
	}
	if !got.YouTubeEnabled {
		t.Error("expected YouTubeEnabled to persist as true")
	}
	if got.YouTubeDestinationBaseURL != a.YouTubeDestinationBaseURL {
		t.Errorf("YouTubeDestinationBaseURL = %q, want %q", got.YouTubeDestinationBaseURL, a.YouTubeDestinationBaseURL)
	}
	// The raw stream key must never round-trip through the database:
	// there is no column for it (see migrations/0002_media_delivery.sql).
	if got.YouTubeStreamKey.Reveal() != "" {
		t.Error("expected YouTubeStreamKey to never be persisted to or read back from SQLite")
	}
}

func TestAssignmentValidateRequiresYouTubeFieldsWhenEnabled(t *testing.T) {
	a := testAssignment("stream-1")
	a.YouTubeEnabled = true
	if err := a.Validate(); err == nil {
		t.Fatal("Validate() expected an error when youtube_enabled is true but destination/key are empty")
	}
	a.YouTubeDestinationBaseURL = "rtmp://a.rtmp.youtube.com/live2"
	a.YouTubeStreamKey = "key"
	if err := a.Validate(); err != nil {
		t.Errorf("Validate() unexpected error with all YouTube fields set: %v", err)
	}
}
