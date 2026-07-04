package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed migrations/*.sql
var embeddedMigrations embed.FS

// migration is one versioned, ordered schema change. Version is parsed
// from the leading digits of the file name (e.g. "0001_init.sql" -> 1)
// so ordering is explicit and file names remain human-readable.
type migration struct {
	version int
	name    string
	sql     string
}

// loadMigrations reads every "*.sql" file from src and returns them
// sorted by version. It is parameterized over fs.FS (rather than always
// reading embeddedMigrations) so tests can exercise the runner against a
// synthetic multi-version migration set without adding throwaway real
// migrations to the production schema.
func loadMigrations(src fs.FS) ([]migration, error) {
	entries, err := fs.Glob(src, "migrations/*.sql")
	if err != nil {
		return nil, fmt.Errorf("store: list migrations: %w", err)
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("store: no migrations found")
	}

	migrations := make([]migration, 0, len(entries))
	seen := make(map[int]string, len(entries))
	for _, path := range entries {
		base := path
		if idx := strings.LastIndexByte(path, '/'); idx >= 0 {
			base = path[idx+1:]
		}
		versionStr, _, ok := strings.Cut(base, "_")
		if !ok {
			return nil, fmt.Errorf("store: migration file %q must be named <version>_<name>.sql", base)
		}
		version, err := strconv.Atoi(versionStr)
		if err != nil || version <= 0 {
			return nil, fmt.Errorf("store: migration file %q has an invalid version prefix", base)
		}
		if prior, ok := seen[version]; ok {
			return nil, fmt.Errorf("store: duplicate migration version %d (%q and %q)", version, prior, base)
		}
		seen[version] = base

		contents, err := fs.ReadFile(src, path)
		if err != nil {
			return nil, fmt.Errorf("store: read migration %q: %w", base, err)
		}
		migrations = append(migrations, migration{version: version, name: base, sql: string(contents)})
	}

	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })
	return migrations, nil
}

// applyMigrations runs every migration in src whose version is not
// already present in schema_migrations, each in its own transaction, in
// ascending version order. It is safe to call on every startup: an
// already-fully-migrated database applies zero migrations.
func applyMigrations(ctx context.Context, db *sql.DB, src fs.FS) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER PRIMARY KEY,
			name       TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)`); err != nil {
		return fmt.Errorf("store: create schema_migrations: %w", err)
	}

	migrations, err := loadMigrations(src)
	if err != nil {
		return err
	}

	applied := make(map[int]bool)
	rows, err := db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("store: read schema_migrations: %w", err)
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return fmt.Errorf("store: scan schema_migrations: %w", err)
		}
		applied[v] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("store: iterate schema_migrations: %w", err)
	}
	rows.Close()

	for _, m := range migrations {
		if applied[m.version] {
			continue
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("store: begin migration %q: %w", m.name, err)
		}
		if _, err := tx.ExecContext(ctx, m.sql); err != nil {
			tx.Rollback()
			return fmt.Errorf("store: apply migration %q: %w", m.name, err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
			m.version, m.name, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			tx.Rollback()
			return fmt.Errorf("store: record migration %q: %w", m.name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("store: commit migration %q: %w", m.name, err)
		}
	}

	return nil
}

// SchemaVersion returns the highest applied migration version, used by
// readiness checks to confirm the schema is at least as new as this
// build expects.
func SchemaVersion(ctx context.Context, db *sql.DB) (int, error) {
	var version sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT MAX(version) FROM schema_migrations`).Scan(&version); err != nil {
		return 0, fmt.Errorf("store: read schema version: %w", err)
	}
	return int(version.Int64), nil
}
