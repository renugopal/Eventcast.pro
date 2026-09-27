package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// These tests mutate package-level seams, so none of them run in parallel.

var fixedBackupClock = func() time.Time { return time.Date(2026, 9, 27, 1, 2, 3, 4_000_000, time.UTC) }

const fixedBackupName = "media-agent-20260927T010203.004Z.sqlite3"

type backupFixture struct {
	dbPath string
	outDir string
	store  *store.Store
}

func newBackupFixture(t *testing.T) backupFixture {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "db", "media-agent.sqlite3")
	st, err := store.Open(context.Background(), dbPath, 5*time.Second)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	now := time.Now().UTC()
	if _, err := st.ImportAssignments(context.Background(), []store.Assignment{{
		IngestID: "ing-1", EventID: "evt-1", PlaybackID: "pb-1", SecretTokenHash: store.HashToken("t"),
		Enabled: true, PublishWindowStartAt: now.Add(-time.Hour), PublishWindowEndAt: now.Add(time.Hour), ConfigVersion: "1",
	}}); err != nil {
		t.Fatalf("ImportAssignments: %v", err)
	}
	outDir := filepath.Join(dir, "backup")
	if err := os.Mkdir(outDir, 0o750); err != nil {
		t.Fatal(err)
	}
	return backupFixture{dbPath: dbPath, outDir: outDir, store: st}
}

func (f backupFixture) env(key string) string {
	if key == config.EnvDBPath {
		return f.dbPath
	}
	return ""
}

type backupRun struct {
	err    error
	stdout string
	json   map[string]any
}

func runBackup(t *testing.T, f backupFixture, args ...string) backupRun {
	t.Helper()
	var out bytes.Buffer
	err := runDBBackup(context.Background(), args, f.env, &out, fixedBackupClock)
	var parsed map[string]any
	if jerr := json.Unmarshal(out.Bytes(), &parsed); jerr != nil {
		t.Fatalf("stdout is not one JSON object: %q (%v)", out.String(), jerr)
	}
	return backupRun{err: err, stdout: out.String(), json: parsed}
}

// assertFailure checks a failed run: non-nil error, fixed category, exactly
// {ok,error} keys, and no filesystem path in stdout or the error text.
func assertFailure(t *testing.T, r backupRun, f backupFixture, wantCategory string) {
	t.Helper()
	if r.err == nil {
		t.Fatalf("expected failure %q, got success: %s", wantCategory, r.stdout)
	}
	if r.json["ok"] != false || r.json["error"] != wantCategory || len(r.json) != 2 {
		t.Fatalf("stdout = %s, want exactly {\"ok\":false,\"error\":%q}", r.stdout, wantCategory)
	}
	for _, s := range []string{r.stdout, r.err.Error()} {
		for _, p := range []string{f.dbPath, f.outDir, filepath.Dir(f.dbPath), string(filepath.Separator) + "backup"} {
			if strings.Contains(s, p) {
				t.Fatalf("path %q leaked in output %q", p, s)
			}
		}
	}
	if r.err.Error() != "db-backup: "+wantCategory {
		t.Fatalf("stderr error = %q, want category only", r.err.Error())
	}
}

func assertNoPartial(t *testing.T, f backupFixture) {
	t.Helper()
	matches, _ := filepath.Glob(filepath.Join(f.outDir, "*.partial"))
	if len(matches) != 0 {
		t.Fatalf(".partial left behind: %v", matches)
	}
}

func assertValidBackup(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var result string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&result); err != nil || result != "ok" {
		t.Fatalf("integrity_check = %q err=%v", result, err)
	}
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM cached_event_assignments").Scan(&n); err != nil || n != 1 {
		t.Fatalf("backup content: assignments=%d err=%v, want 1", n, err)
	}
}

func TestDBBackup_SuccessConsistentBackup(t *testing.T) {
	f := newBackupFixture(t)
	r := runBackup(t, f, "--out", f.outDir)
	if r.err != nil || r.json["ok"] != true || r.json["file"] != fixedBackupName {
		t.Fatalf("run = %+v stdout=%s", r.err, r.stdout)
	}
	if v, _ := r.json["schema_version"].(float64); v < 7 {
		t.Fatalf("schema_version = %v, want >= 7", r.json["schema_version"])
	}
	assertValidBackup(t, filepath.Join(f.outDir, fixedBackupName))
	assertNoPartial(t, f)
}

func TestDBBackup_LiveDBStillReadableAndWritable(t *testing.T) {
	f := newBackupFixture(t)
	if r := runBackup(t, f, "--out", f.outDir); r.err != nil {
		t.Fatalf("backup failed: %s", r.stdout)
	}
	ctx := context.Background()
	if _, found, err := f.store.GetAssignment(ctx, "ing-1"); err != nil || !found {
		t.Fatalf("live read after backup: found=%v err=%v", found, err)
	}
	if _, err := f.store.CreateSession(ctx, "evt-1", "ing-1", "pb-1", time.Now().UTC()); err != nil {
		t.Fatalf("live write after backup: %v", err)
	}
}

func TestDBBackup_InvalidOrMissingOutput(t *testing.T) {
	f := newBackupFixture(t)
	for name, args := range map[string][]string{
		"no-flag":      {},
		"relative":     {"--out", "backup"},
		"missing-dir":  {"--out", filepath.Join(f.outDir, "does-not-exist")},
		"unknown-flag": {"--nope"},
	} {
		t.Run(name, func(t *testing.T) {
			assertFailure(t, runBackup(t, f, args...), f, backupErrInvalidArguments)
			assertNoPartial(t, f)
		})
	}
}

func TestDBBackup_ExistingFinalTargetUnchanged(t *testing.T) {
	f := newBackupFixture(t)
	final := filepath.Join(f.outDir, fixedBackupName)
	if err := os.WriteFile(final, []byte("sentinel"), 0o640); err != nil {
		t.Fatal(err)
	}
	assertFailure(t, runBackup(t, f, "--out", f.outDir), f, backupErrOutputExists)
	if b, _ := os.ReadFile(final); string(b) != "sentinel" {
		t.Fatalf("existing target modified: %q", b)
	}
	assertNoPartial(t, f)
}

func TestDBBackup_LinkRaceTargetUnchanged(t *testing.T) {
	f := newBackupFixture(t)
	final := filepath.Join(f.outDir, fixedBackupName)
	beforeBackupValidate = func(string) { _ = os.WriteFile(final, []byte("sentinel"), 0o640) }
	t.Cleanup(func() { beforeBackupValidate = nil })
	assertFailure(t, runBackup(t, f, "--out", f.outDir), f, backupErrOutputExists)
	if b, _ := os.ReadFile(final); string(b) != "sentinel" {
		t.Fatalf("raced target modified: %q", b)
	}
	assertNoPartial(t, f)
}

func TestDBBackup_CorruptedPartial_ValidationFailed(t *testing.T) {
	f := newBackupFixture(t)
	beforeBackupValidate = func(p string) {
		data, _ := os.ReadFile(p)
		if len(data) > 200 {
			for i := 100; i < len(data); i++ {
				data[i] = 0xFF
			}
		}
		_ = os.WriteFile(p, data, 0o640)
	}
	t.Cleanup(func() { beforeBackupValidate = nil })
	assertFailure(t, runBackup(t, f, "--out", f.outDir), f, backupErrValidationFailed)
	if _, err := os.Stat(filepath.Join(f.outDir, fixedBackupName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("final backup published despite validation failure")
	}
	assertNoPartial(t, f)
}

func TestDBBackup_SchemaVersionMismatch_ValidationFailed(t *testing.T) {
	f := newBackupFixture(t)
	beforeBackupValidate = func(p string) {
		db, err := sql.Open("sqlite", "file:"+p)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		if _, err := db.Exec(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'x', 'x')`); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { beforeBackupValidate = nil })
	assertFailure(t, runBackup(t, f, "--out", f.outDir), f, backupErrValidationFailed)
	assertNoPartial(t, f)
}

func TestDBBackup_PartialRemovalFailure_CommitFailed_NoPartialLeft(t *testing.T) {
	f := newBackupFixture(t)
	removeFile = func(string) error { return errors.New("injected remove failure") }
	t.Cleanup(func() { removeFile = os.Remove })
	assertFailure(t, runBackup(t, f, "--out", f.outDir), f, backupErrCommitFailed)
	assertValidBackup(t, filepath.Join(f.outDir, fixedBackupName)) // valid final kept
	assertNoPartial(t, f)                                          // deferred best-effort cleanup removed it
}

func TestDBBackup_DirectorySyncFailure_CommitFailed_NoPartialLeft(t *testing.T) {
	f := newBackupFixture(t)
	syncDirFn = func(string) error { return errors.New("injected dir fsync failure") }
	t.Cleanup(func() { syncDirFn = syncDir })
	assertFailure(t, runBackup(t, f, "--out", f.outDir), f, backupErrCommitFailed)
	assertValidBackup(t, filepath.Join(f.outDir, fixedBackupName)) // valid final kept
	assertNoPartial(t, f)
}
