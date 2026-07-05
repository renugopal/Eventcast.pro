// Package store implements the Media Agent's local SQLite WAL-backed
// durable database: the cached event assignment table used to
// authorize publishers, the ingest session lifecycle table, and the
// segment job queue for durably-captured HLS segments awaiting upload.
// See 03_DATA_MODEL_AND_API_CONTRACTS.md "Local SQLite schema
// responsibilities" and 09_CLAUDE_CODE_EXECUTION_RULES.md "Database
// rules".
package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver: no CGO, compatible with the static distroless build
)

// Store wraps a single SQLite connection pool configured for WAL-mode
// durability, plus repository methods for every table it owns.
type Store struct {
	db *sql.DB
}

// Open opens (creating if necessary) the SQLite database at path,
// applies WAL mode, foreign keys, busy_timeout, and a durable
// synchronous setting, then runs every pending migration. It is safe to
// call at every process startup.
//
// SQLite's WAL mode does not support meaningful connection pooling for
// writers in the way typical server databases do: concurrent writers
// still serialize at the database level. A single shared *sql.DB with
// busy_timeout configured lets database/sql's own connection pool queue
// callers safely instead of surfacing spurious "database is locked"
// errors under concurrent handler activity.
func Open(ctx context.Context, path string, busyTimeout time.Duration) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("store: create database directory: %w", err)
	}

	// modernc.org/sqlite accepts PRAGMAs via DSN query parameters, applied
	// to every new connection the pool opens - required because
	// PRAGMA foreign_keys and PRAGMA synchronous are per-connection, not
	// persisted in the database file itself.
	//
	// _txlock=immediate makes every explicit BeginTx acquire SQLite's
	// RESERVED write lock at BEGIN, before that transaction's first
	// statement, instead of the driver default ("deferred"), which only
	// escalates to a write lock on the transaction's first write
	// statement. A deferred transaction that reads before it writes (e.g.
	// RecordManifestGeneration's "read the max generation, then insert
	// the next one") establishes its snapshot at that first read; if a
	// concurrent writer commits anything to the database file in between
	// - even to an unrelated table, since a SQLite snapshot covers the
	// whole file - the later write fails with SQLITE_BUSY in a way
	// busy_timeout cannot resolve by waiting, because the snapshot itself
	// is stale, not merely lock-contended. Acquiring the write lock up
	// front removes that window entirely: busy_timeout's wait-and-retry
	// then correctly covers the only remaining case, a lock actually held
	// by another writer.
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=synchronous(FULL)&_pragma=busy_timeout(%d)&_txlock=immediate",
		path, busyTimeout.Milliseconds(),
	)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open %s: %w", path, err)
	}

	// SQLite has no benefit from many concurrent writer connections; a
	// small pool avoids busy_timeout contention turning into unnecessary
	// queuing depth while still allowing concurrent readers.
	db.SetMaxOpenConns(8)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: ping %s: %w", path, err)
	}

	if err := applyMigrations(ctx, db, embeddedMigrations); err != nil {
		db.Close()
		return nil, err
	}

	return &Store{db: db}, nil
}

// Close releases the underlying connection pool.
func (s *Store) Close() error {
	return s.db.Close()
}

// Ping verifies the database is reachable, used by the readiness
// endpoint.
func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

// SchemaVersion reports the highest applied migration version.
func (s *Store) SchemaVersion(ctx context.Context) (int, error) {
	return SchemaVersion(ctx, s.db)
}

// Checkpoint runs a passive WAL checkpoint, folding committed WAL
// frames back into the main database file. PASSIVE mode never blocks a
// concurrent writer or reader (unlike FULL/RESTART/TRUNCATE), so it is
// safe to call periodically from reconciliation without risking a
// stall of in-flight callback handling. See
// 03_DATA_MODEL_AND_API_CONTRACTS.md "SQLite MUST use WAL mode ...
// periodic checkpointing".
func (s *Store) Checkpoint(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "PRAGMA wal_checkpoint(PASSIVE)"); err != nil {
		return fmt.Errorf("store: checkpoint: %w", err)
	}
	return nil
}

// IntegrityCheck runs SQLite's built-in integrity check and returns an
// error if it reports anything other than "ok". See
// 03_DATA_MODEL_AND_API_CONTRACTS.md "SQLite MUST use WAL mode ...
// regular integrity checks".
func (s *Store) IntegrityCheck(ctx context.Context) error {
	var result string
	if err := s.db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return fmt.Errorf("store: integrity check: %w", err)
	}
	if result != "ok" {
		return fmt.Errorf("store: integrity check reported: %s", result)
	}
	return nil
}
