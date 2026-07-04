package store

import (
	"context"
	"database/sql"
	"io/fs"
	"testing"
	"testing/fstest"
	"time"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/test.sqlite3?_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestLoadMigrationsOrdersByVersion(t *testing.T) {
	fsys := fstest.MapFS{
		"migrations/0002_second.sql": {Data: []byte("CREATE TABLE second (id INTEGER);")},
		"migrations/0001_first.sql":  {Data: []byte("CREATE TABLE first (id INTEGER);")},
		"migrations/0010_tenth.sql":  {Data: []byte("CREATE TABLE tenth (id INTEGER);")},
	}

	migrations, err := loadMigrations(fsys)
	if err != nil {
		t.Fatalf("loadMigrations() error: %v", err)
	}
	if len(migrations) != 3 {
		t.Fatalf("len(migrations) = %d, want 3", len(migrations))
	}
	wantOrder := []int{1, 2, 10}
	for i, m := range migrations {
		if m.version != wantOrder[i] {
			t.Errorf("migrations[%d].version = %d, want %d", i, m.version, wantOrder[i])
		}
	}
}

func TestLoadMigrationsRejectsDuplicateVersion(t *testing.T) {
	fsys := fstest.MapFS{
		"migrations/0001_first.sql":     {Data: []byte("CREATE TABLE first (id INTEGER);")},
		"migrations/0001_duplicate.sql": {Data: []byte("CREATE TABLE dup (id INTEGER);")},
	}

	if _, err := loadMigrations(fsys); err == nil {
		t.Fatal("loadMigrations() expected error for duplicate version, got nil")
	}
}

func TestLoadMigrationsRejectsMissingVersionPrefix(t *testing.T) {
	fsys := fstest.MapFS{
		"migrations/init.sql": {Data: []byte("CREATE TABLE t (id INTEGER);")},
	}

	if _, err := loadMigrations(fsys); err == nil {
		t.Fatal("loadMigrations() expected error for missing version prefix, got nil")
	}
}

func TestApplyMigrationsAppliesInOrderAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)

	fsys := fstest.MapFS{
		"migrations/0001_first.sql":  {Data: []byte("CREATE TABLE first (id INTEGER PRIMARY KEY);")},
		"migrations/0002_second.sql": {Data: []byte("CREATE TABLE second (id INTEGER PRIMARY KEY);")},
	}

	if err := applyMigrations(ctx, db, fsys); err != nil {
		t.Fatalf("applyMigrations() first run error: %v", err)
	}

	version, err := SchemaVersion(ctx, db)
	if err != nil {
		t.Fatalf("SchemaVersion() error: %v", err)
	}
	if version != 2 {
		t.Errorf("SchemaVersion() = %d, want 2", version)
	}

	if _, err := db.Exec(`INSERT INTO first (id) VALUES (1)`); err != nil {
		t.Fatalf("insert into first: %v", err)
	}

	// Re-applying must not error and must not re-run 0001/0002 (which
	// would fail with "table already exists" if it did).
	if err := applyMigrations(ctx, db, fsys); err != nil {
		t.Fatalf("applyMigrations() second run error: %v", err)
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM first`).Scan(&count); err != nil {
		t.Fatalf("count first: %v", err)
	}
	if count != 1 {
		t.Errorf("row count after idempotent re-apply = %d, want 1 (data preserved, no re-run)", count)
	}
}

func TestApplyMigrationsRollsBackFailedMigration(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)

	// The second statement is invalid SQL; since the whole migration body
	// runs as one transaction, the valid first statement must not survive
	// either, and no schema_migrations row must be recorded for it.
	err := applyMigrations(ctx, db, fstest.MapFS{
		"migrations/0001_first.sql": {Data: []byte(
			"CREATE TABLE first (id INTEGER PRIMARY KEY); CREATE TABLE first (id INTEGER PRIMARY KEY);",
		)},
	})
	if err == nil {
		t.Fatal("applyMigrations() expected an error for a migration that fails partway, got nil")
	}

	version, verErr := SchemaVersion(ctx, db)
	if verErr != nil {
		t.Fatalf("SchemaVersion() error: %v", verErr)
	}
	if version != 0 {
		t.Errorf("SchemaVersion() = %d, want 0 (failed migration must not be recorded)", version)
	}

	var count int
	tableErr := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'first'`).Scan(&count)
	if tableErr != nil {
		t.Fatalf("query sqlite_master: %v", tableErr)
	}
	if count != 0 {
		t.Error("table from a failed migration's earlier statement was not rolled back")
	}
}

func TestApplyMigrationsAppliesOnlyNewVersions(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)

	if err := applyMigrations(ctx, db, fstest.MapFS{
		"migrations/0001_first.sql": {Data: []byte("CREATE TABLE first (id INTEGER PRIMARY KEY);")},
	}); err != nil {
		t.Fatalf("applyMigrations() first run error: %v", err)
	}

	// A second, larger migration set (as if the binary was upgraded)
	// including the already-applied 0001 must only apply 0002.
	if err := applyMigrations(ctx, db, fstest.MapFS{
		"migrations/0001_first.sql":  {Data: []byte("CREATE TABLE first (id INTEGER PRIMARY KEY);")},
		"migrations/0002_second.sql": {Data: []byte("CREATE TABLE second (id INTEGER PRIMARY KEY);")},
	}); err != nil {
		t.Fatalf("applyMigrations() second run error: %v", err)
	}

	version, err := SchemaVersion(ctx, db)
	if err != nil {
		t.Fatalf("SchemaVersion() error: %v", err)
	}
	if version != 2 {
		t.Errorf("SchemaVersion() = %d, want 2", version)
	}
}

// TestRealMigration0002UpgradesAnExistingV1Database applies only the
// real, production 0001_init.sql (as if this database were created
// under the previous "v1.2 ingest control and durability" milestone),
// inserts data using that schema, then runs the real full embedded
// migration set (which adds 0002_media_delivery.sql and
// 0003_production_readiness.sql) and confirms existing data survives
// and the new columns/tables from both later migrations are usable.
func TestRealMigration0002UpgradesAnExistingV1Database(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)

	v1SQL, err := fs.ReadFile(embeddedMigrations, "migrations/0001_init.sql")
	if err != nil {
		t.Fatalf("read real 0001_init.sql: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
		)`); err != nil {
		t.Fatalf("create schema_migrations: %v", err)
	}
	if _, err := db.ExecContext(ctx, string(v1SQL)); err != nil {
		t.Fatalf("apply real 0001_init.sql: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, '0001_init.sql', ?)`,
		time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("record v1 schema version: %v", err)
	}

	// Data written under the v1-only schema (no upload/manifest/VOD/relay
	// columns or tables exist yet at this point).
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.ExecContext(ctx, `
		INSERT INTO cached_event_assignments (
			ingest_id, event_id, playback_id, secret_token_hash, enabled,
			publish_window_start_at, publish_window_end_at, updated_at
		) VALUES ('ingest-1', 'event-1', 'pb-1', 'deadbeef', 1, ?, ?, ?)`, now, now, now); err != nil {
		t.Fatalf("insert v1 assignment: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO segment_jobs (
			idempotency_key, event_id, session_id, local_file_identity, seq_no, duration_seconds,
			spool_path, byte_size, sha256, status, created_at, updated_at
		) VALUES ('k1', 'event-1', 'sess-1', 'k1', 1, 4, '/spool/k1', 100, 'deadbeef', 'queued', ?, ?)`, now, now); err != nil {
		t.Fatalf("insert v1 segment job: %v", err)
	}

	// Now apply the real, full production migration set - this is the
	// exact function and embedded files store.Open uses.
	if err := applyMigrations(ctx, db, embeddedMigrations); err != nil {
		t.Fatalf("applyMigrations() upgrade to v2 error: %v", err)
	}

	version, err := SchemaVersion(ctx, db)
	if err != nil {
		t.Fatalf("SchemaVersion() error: %v", err)
	}
	if version != 3 {
		t.Errorf("SchemaVersion() after upgrade = %d, want 3", version)
	}

	// Pre-existing data must survive untouched, and new columns must
	// have taken their documented defaults.
	var eventID string
	var youtubeEnabled bool
	if err := db.QueryRowContext(ctx,
		`SELECT event_id, youtube_enabled FROM cached_event_assignments WHERE ingest_id = 'ingest-1'`,
	).Scan(&eventID, &youtubeEnabled); err != nil {
		t.Fatalf("query upgraded assignment: %v", err)
	}
	if eventID != "event-1" {
		t.Errorf("event_id = %q, want %q (data must survive upgrade)", eventID, "event-1")
	}
	if youtubeEnabled {
		t.Error("youtube_enabled default = true, want false")
	}

	var uploadStatus, manifestCommitStatus string
	if err := db.QueryRowContext(ctx,
		`SELECT upload_status, manifest_commit_status FROM segment_jobs WHERE idempotency_key = 'k1'`,
	).Scan(&uploadStatus, &manifestCommitStatus); err != nil {
		t.Fatalf("query upgraded segment job: %v", err)
	}
	if uploadStatus != UploadPending {
		t.Errorf("upload_status default = %q, want %q", uploadStatus, UploadPending)
	}
	if manifestCommitStatus != ManifestCommitPending {
		t.Errorf("manifest_commit_status default = %q, want %q", manifestCommitStatus, ManifestCommitPending)
	}

	// New tables must be immediately usable.
	if _, err := db.ExecContext(ctx,
		`INSERT INTO manifest_generations (event_id, manifest_type, generation, segment_ids, published_at) VALUES ('event-1', 'live', 1, '[]', ?)`, now); err != nil {
		t.Errorf("insert into new manifest_generations table: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO vod_finalizations (event_id, status, updated_at) VALUES ('event-1', 'pending', ?)`, now); err != nil {
		t.Errorf("insert into new vod_finalizations table: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO youtube_relays (event_id, session_id, status, updated_at) VALUES ('event-1', 'sess-1', 'starting', ?)`, now); err != nil {
		t.Errorf("insert into new youtube_relays table: %v", err)
	}

	// 0003_production_readiness.sql's new columns must have taken their
	// documented defaults on the pre-existing assignment row.
	var source, gapStatus string
	if err := db.QueryRowContext(ctx,
		`SELECT source FROM cached_event_assignments WHERE ingest_id = 'ingest-1'`,
	).Scan(&source); err != nil {
		t.Fatalf("query upgraded assignment source: %v", err)
	}
	if source != AssignmentSourceSeed {
		t.Errorf("source default = %q, want %q", source, AssignmentSourceSeed)
	}

	if _, err := db.ExecContext(ctx,
		`INSERT INTO vod_finalizations (event_id, status, updated_at) VALUES ('event-2', 'pending', ?)`, now); err != nil {
		t.Fatalf("insert second vod_finalizations row: %v", err)
	}
	if err := db.QueryRowContext(ctx,
		`SELECT gap_status FROM vod_finalizations WHERE event_id = 'event-2'`,
	).Scan(&gapStatus); err != nil {
		t.Fatalf("query gap_status default: %v", err)
	}
	if gapStatus != VODGapNone {
		t.Errorf("gap_status default = %q, want %q", gapStatus, VODGapNone)
	}

	if _, err := db.ExecContext(ctx,
		`INSERT INTO controlplane_sync_state (id, updated_at) VALUES (1, ?)`, now); err != nil {
		t.Errorf("insert into new controlplane_sync_state table: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO vod_gap_audit (event_id, action, actor, gap_count, created_at) VALUES ('event-2', 'acknowledge', 'operator-1', 0, ?)`, now); err != nil {
		t.Errorf("insert into new vod_gap_audit table: %v", err)
	}

	// Re-applying the full migration set again (as a second process
	// restart would) must remain a no-op.
	if err := applyMigrations(ctx, db, embeddedMigrations); err != nil {
		t.Fatalf("re-applying migrations must be idempotent: %v", err)
	}
}
