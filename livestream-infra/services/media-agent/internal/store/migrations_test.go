package store

import (
	"context"
	"database/sql"
	"testing"
	"testing/fstest"

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
