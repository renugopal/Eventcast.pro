package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "media-agent.sqlite3")
	st, err := Open(context.Background(), path, 5*time.Second)
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestOpenAppliesMigrationsAndWALMode(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	version, err := st.SchemaVersion(ctx)
	if err != nil {
		t.Fatalf("SchemaVersion() error: %v", err)
	}
	if version < 1 {
		t.Errorf("SchemaVersion() = %d, want >= 1", version)
	}

	var journalMode string
	if err := st.db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journalMode); err != nil {
		t.Fatalf("query journal_mode: %v", err)
	}
	if journalMode != "wal" {
		t.Errorf("journal_mode = %q, want %q", journalMode, "wal")
	}

	var foreignKeys int
	if err := st.db.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
		t.Fatalf("query foreign_keys: %v", err)
	}
	if foreignKeys != 1 {
		t.Errorf("foreign_keys = %d, want 1 (enabled)", foreignKeys)
	}
}

func TestOpenIsReentrantOnExistingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media-agent.sqlite3")
	ctx := context.Background()

	first, err := Open(ctx, path, time.Second)
	if err != nil {
		t.Fatalf("Open() first error: %v", err)
	}
	if _, err := first.CreateSession(ctx, "event-1", "ingest-1", time.Now()); err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close() error: %v", err)
	}

	second, err := Open(ctx, path, time.Second)
	if err != nil {
		t.Fatalf("Open() second error: %v", err)
	}
	defer second.Close()

	sess, found, err := second.FindMostRecentByIngestID(ctx, "ingest-1")
	if err != nil {
		t.Fatalf("FindMostRecentByIngestID() error: %v", err)
	}
	if !found {
		t.Fatal("expected session created before reopen to survive restart")
	}
	if sess.EventID != "event-1" {
		t.Errorf("EventID = %q, want %q", sess.EventID, "event-1")
	}
}

func TestPingReportsHealthyDatabase(t *testing.T) {
	st := openTestStore(t)
	if err := st.Ping(context.Background()); err != nil {
		t.Errorf("Ping() error: %v", err)
	}
}

func TestCheckpointSucceeds(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	if _, err := st.CreateSession(ctx, "event-1", "ingest-1", time.Now()); err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	if err := st.Checkpoint(ctx); err != nil {
		t.Errorf("Checkpoint() error: %v", err)
	}
}

func TestIntegrityCheckReportsOKOnAFreshDatabase(t *testing.T) {
	st := openTestStore(t)
	if err := st.IntegrityCheck(context.Background()); err != nil {
		t.Errorf("IntegrityCheck() error: %v", err)
	}
}
