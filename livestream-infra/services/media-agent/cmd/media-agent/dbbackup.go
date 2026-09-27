package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
)

// db-backup: a consistent, validated copy of the live Media Agent SQLite
// database (Livestream Reliability & Operations Package, locked decision
// D5). The live database is opened READ-ONLY - never through store.Open,
// which would apply pending migrations - and copied with SQLite's
// transactionally consistent VACUUM INTO. The command writes nowhere except
// --out, never overwrites or removes an existing backup, makes a best-effort
// attempt to remove its temporary .partial file on every exit path, and
// carries no encryption, upload, or retention logic (the host backup script
// owns those). Output is one JSON line with a fixed, secret-free vocabulary.

// Fixed db-backup error categories.
const (
	backupErrInvalidArguments = "invalid_arguments"
	backupErrOpenFailed       = "open_failed"
	backupErrVacuumFailed     = "vacuum_failed"
	backupErrValidationFailed = "validation_failed"
	backupErrCommitFailed     = "commit_failed"
	backupErrOutputExists     = "output_exists"
)

type backupResult struct {
	OK            bool   `json:"ok"`
	File          string `json:"file,omitempty"`
	Bytes         int64  `json:"bytes,omitempty"`
	SchemaVersion int    `json:"schema_version,omitempty"`
	Error         string `json:"error,omitempty"`
}

// backupError carries only a fixed category outward; the underlying cause
// stays internal (it may contain local paths).
type backupError struct {
	category string
	cause    error
}

func (e *backupError) Error() string { return "db-backup: " + e.category }
func (e *backupError) Unwrap() error { return e.cause }

// Test-only seams (production values shown). They let tests inject a
// partial-removal failure, a directory-fsync failure, and changes to the
// partial file before validation.
var (
	removeFile           = os.Remove
	syncDirFn            = syncDir
	beforeBackupValidate func(partialPath string) // nil in production
)

// runDBBackup implements `media-agent db-backup --out <dir>`.
func runDBBackup(ctx context.Context, args []string, getenv func(string) string, stdout io.Writer, now func() time.Time) error {
	res, err := dbBackup(ctx, args, getenv, now)
	if err != nil {
		cat := backupErrOpenFailed
		var be *backupError
		if errors.As(err, &be) {
			cat = be.category
		}
		_ = json.NewEncoder(stdout).Encode(backupResult{OK: false, Error: cat})
		return &backupError{category: cat} // outward error carries the category only
	}
	_ = json.NewEncoder(stdout).Encode(res)
	return nil
}

func dbBackup(ctx context.Context, args []string, getenv func(string) string, now func() time.Time) (backupResult, error) {
	fs := flag.NewFlagSet("db-backup", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	out := fs.String("out", "", "existing directory to write the backup into")
	if err := fs.Parse(args); err != nil || *out == "" || !filepath.IsAbs(*out) {
		return backupResult{}, &backupError{backupErrInvalidArguments, err}
	}
	dbPath := getenv(config.EnvDBPath)
	if dbPath == "" || !filepath.IsAbs(dbPath) {
		return backupResult{}, &backupError{backupErrInvalidArguments, nil}
	}
	if info, err := os.Stat(*out); err != nil || !info.IsDir() {
		return backupResult{}, &backupError{backupErrInvalidArguments, err}
	}

	name := "media-agent-" + now().UTC().Format("20060102T150405.000Z") + ".sqlite3"
	finalPath := filepath.Join(*out, name)
	partialPath := finalPath + ".partial"
	if _, err := os.Lstat(finalPath); err == nil {
		return backupResult{}, &backupError{backupErrOutputExists, nil}
	}
	if _, err := os.Lstat(partialPath); err == nil {
		return backupResult{}, &backupError{backupErrOutputExists, nil}
	}

	src, err := openReadOnly(dbPath)
	if err != nil {
		return backupResult{}, &backupError{backupErrOpenFailed, err}
	}
	defer src.Close()
	srcVersion, err := schemaVersion(ctx, src)
	if err != nil {
		return backupResult{}, &backupError{backupErrOpenFailed, err}
	}

	// Cleanup: on EVERY exit path (success or failure) make a best-effort
	// attempt to remove partialPath. It never touches finalPath. On success
	// partialPath is already gone, so this is a harmless no-op. Under a
	// persistent filesystem error the removal can itself fail; that is the
	// only case in which a .partial may remain.
	defer func() { _ = os.Remove(partialPath) }()

	if _, err := src.ExecContext(ctx, "VACUUM INTO ?", partialPath); err != nil {
		return backupResult{}, &backupError{backupErrVacuumFailed, err}
	}
	if beforeBackupValidate != nil {
		beforeBackupValidate(partialPath)
	}
	size, err := validateBackup(ctx, partialPath, srcVersion)
	if err != nil {
		return backupResult{}, &backupError{backupErrValidationFailed, err}
	}

	// 1. Make the file data durable before it gets its final name.
	if err := syncFile(partialPath); err != nil {
		return backupResult{}, &backupError{backupErrCommitFailed, err}
	}

	// 2. Publish under the final name WITHOUT overwriting: os.Link fails with
	//    ErrExist if finalPath already exists (os.Rename would silently
	//    replace it on POSIX). An existing backup is never modified or removed.
	if err := os.Link(partialPath, finalPath); err != nil {
		if errors.Is(err, os.ErrExist) {
			return backupResult{}, &backupError{backupErrOutputExists, err}
		}
		return backupResult{}, &backupError{backupErrCommitFailed, err}
	}

	// From here finalPath exists, is complete, validated, and fsynced (it
	// shares the partial's data). It is never removed on failure: it is a
	// valid backup and removing it would destroy good data.

	// 3. Drop the temporary name. On failure: commit_failed; the deferred
	//    cleanup retries the removal (best effort).
	if err := removeFile(partialPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return backupResult{}, &backupError{backupErrCommitFailed, err}
	}

	// 4. Make the directory entries durable. If this fails AFTER finalPath
	//    exists: report commit_failed (crash durability of the entry is not
	//    proven), leave the valid final file in place; the partial was already
	//    removed in step 3. The host script treats commit_failed as a failed
	//    run and retries.
	if err := syncDirFn(*out); err != nil {
		return backupResult{}, &backupError{backupErrCommitFailed, err}
	}

	// Success: finalPath present, partialPath absent, data + entry fsynced.
	return backupResult{OK: true, File: name, Bytes: size, SchemaVersion: srcVersion}, nil
}

func openReadOnly(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro&_pragma=busy_timeout(5000)", path))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func schemaVersion(ctx context.Context, db *sql.DB) (int, error) {
	var v sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT MAX(version) FROM schema_migrations`).Scan(&v); err != nil {
		return 0, err
	}
	if !v.Valid || v.Int64 <= 0 {
		return 0, errors.New("no applied schema version")
	}
	return int(v.Int64), nil
}

// validateBackup requires a non-empty file that passes integrity_check and
// carries exactly the live database's schema version.
func validateBackup(ctx context.Context, path string, wantVersion int) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	if info.Size() == 0 {
		return 0, errors.New("empty backup")
	}
	db, err := openReadOnly(path)
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var result string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return 0, err
	}
	if result != "ok" {
		return 0, errors.New("integrity check failed")
	}
	got, err := schemaVersion(ctx, db)
	if err != nil {
		return 0, err
	}
	if got != wantVersion {
		return 0, fmt.Errorf("schema version %d, want %d", got, wantVersion)
	}
	return info.Size(), nil
}

func syncFile(path string) error {
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// syncDir fsyncs a directory so its new entries are durable. Windows does
// not permit fsync on a directory handle, so the step is skipped there
// (local tests only - production runs on Linux).
func syncDir(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	d, err := os.Open(path)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
