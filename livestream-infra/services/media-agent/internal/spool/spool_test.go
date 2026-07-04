package spool

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path string, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o640); err != nil {
		t.Fatalf("write file: %v", err)
	}
}

func TestValidateContainedAcceptsFileInsideRoot(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "live", "stream1", "1700000000-1.ts")
	writeFile(t, src, "segment-data")

	got, err := ValidateContained(root, src)
	if err != nil {
		t.Fatalf("ValidateContained() error: %v", err)
	}
	if got == "" {
		t.Error("resolved path is empty")
	}
}

func TestValidateContainedRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(filepath.Dir(root), "outside.ts")
	writeFile(t, outside, "should not be reachable")

	// A relative candidate containing ".." must be rejected even though
	// ValidateContained joins it onto root first - the traversal escapes
	// after Clean, which is exactly the case a malicious callback-provided
	// relative path would exploit.
	traversal := ".." + string(filepath.Separator) + filepath.Base(outside)
	_, err := ValidateContained(root, traversal)
	if !errors.Is(err, ErrEscapesRoot) {
		t.Fatalf("ValidateContained() error = %v, want ErrEscapesRoot", err)
	}
}

func TestValidateContainedRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "secret.ts")
	writeFile(t, outsideFile, "outside data")

	linkPath := filepath.Join(root, "escape.ts")
	if err := os.Symlink(outsideFile, linkPath); err != nil {
		t.Skipf("symlinks not supported in this environment: %v", err)
	}

	_, err := ValidateContained(root, linkPath)
	if !errors.Is(err, ErrSourceIsSymlink) {
		t.Fatalf("ValidateContained() error = %v, want ErrSourceIsSymlink", err)
	}
}

func TestValidateContainedRejectsSymlinkedParentEscape(t *testing.T) {
	root := t.TempDir()
	outsideDir := t.TempDir()
	writeFile(t, filepath.Join(outsideDir, "seg.ts"), "outside data")

	linkedDir := filepath.Join(root, "linked")
	if err := os.Symlink(outsideDir, linkedDir); err != nil {
		t.Skipf("symlinks not supported in this environment: %v", err)
	}

	_, err := ValidateContained(root, filepath.Join(linkedDir, "seg.ts"))
	if !errors.Is(err, ErrEscapesRoot) {
		t.Fatalf("ValidateContained() error = %v, want ErrEscapesRoot", err)
	}
}

func TestValidateContainedRejectsMissingSource(t *testing.T) {
	root := t.TempDir()
	_, err := ValidateContained(root, filepath.Join(root, "does-not-exist.ts"))
	if !errors.Is(err, ErrSourceMissing) {
		t.Fatalf("ValidateContained() error = %v, want ErrSourceMissing", err)
	}
}

func TestCaptureHardLinksWithinSameFilesystem(t *testing.T) {
	root := t.TempDir()
	hlsRoot := filepath.Join(root, "srs-output")
	spoolRoot := filepath.Join(root, "spool")
	src := filepath.Join(hlsRoot, "live", "stream1", "1700000000-1.ts")
	writeFile(t, src, "segment-bytes")

	result, err := Capture(context.Background(), CaptureInput{
		HLSRoot:    hlsRoot,
		SpoolRoot:  spoolRoot,
		SourceFile: src,
		EventID:    "event-1",
		SessionID:  "session-1",
		SeqNo:      1,
	})
	if err != nil {
		t.Fatalf("Capture() error: %v", err)
	}

	info, err := os.Stat(result.SpoolPath)
	if err != nil {
		t.Fatalf("stat captured file: %v", err)
	}
	if info.Size() != int64(len("segment-bytes")) {
		t.Errorf("captured file size = %d, want %d", info.Size(), len("segment-bytes"))
	}
	if result.ByteSize != int64(len("segment-bytes")) {
		t.Errorf("ByteSize = %d, want %d", result.ByteSize, len("segment-bytes"))
	}
	if result.SHA256 == "" {
		t.Error("SHA256 is empty")
	}

	srcInfo, err := os.Stat(src)
	if err != nil {
		t.Fatalf("stat source file: %v", err)
	}
	if !os.SameFile(info, srcInfo) {
		t.Error("captured file is not a hard link to the source (different inode)")
	}
}

func TestCaptureRejectsDestinationCollision(t *testing.T) {
	root := t.TempDir()
	hlsRoot := filepath.Join(root, "srs-output")
	spoolRoot := filepath.Join(root, "spool")
	src := filepath.Join(hlsRoot, "live", "stream1", "1700000000-1.ts")
	writeFile(t, src, "segment-bytes")

	in := CaptureInput{
		HLSRoot:    hlsRoot,
		SpoolRoot:  spoolRoot,
		SourceFile: src,
		EventID:    "event-1",
		SessionID:  "session-1",
		SeqNo:      1,
	}
	if _, err := Capture(context.Background(), in); err != nil {
		t.Fatalf("Capture() first call error: %v", err)
	}
	if _, err := Capture(context.Background(), in); !errors.Is(err, ErrDestinationExists) {
		t.Fatalf("Capture() second call error = %v, want ErrDestinationExists", err)
	}
}

func TestCaptureRejectsSourceOutsideHLSRoot(t *testing.T) {
	root := t.TempDir()
	hlsRoot := filepath.Join(root, "srs-output")
	spoolRoot := filepath.Join(root, "spool")
	outside := filepath.Join(root, "outside.ts")
	writeFile(t, outside, "not allowed")
	if err := os.MkdirAll(hlsRoot, 0o750); err != nil {
		t.Fatalf("mkdir hls root: %v", err)
	}

	_, err := Capture(context.Background(), CaptureInput{
		HLSRoot:    hlsRoot,
		SpoolRoot:  spoolRoot,
		SourceFile: outside,
		EventID:    "event-1",
		SessionID:  "session-1",
		SeqNo:      1,
	})
	if !errors.Is(err, ErrEscapesRoot) {
		t.Fatalf("Capture() error = %v, want ErrEscapesRoot", err)
	}
}

func TestCaptureRejectsMissingSource(t *testing.T) {
	root := t.TempDir()
	hlsRoot := filepath.Join(root, "srs-output")
	spoolRoot := filepath.Join(root, "spool")
	if err := os.MkdirAll(hlsRoot, 0o750); err != nil {
		t.Fatalf("mkdir hls root: %v", err)
	}

	_, err := Capture(context.Background(), CaptureInput{
		HLSRoot:    hlsRoot,
		SpoolRoot:  spoolRoot,
		SourceFile: filepath.Join(hlsRoot, "gone.ts"),
		EventID:    "event-1",
		SessionID:  "session-1",
		SeqNo:      1,
	})
	if !errors.Is(err, ErrSourceMissing) {
		t.Fatalf("Capture() error = %v, want ErrSourceMissing", err)
	}
}

func TestCopyFallbackProducesDurableAtomicCopy(t *testing.T) {
	root := t.TempDir()
	destDir := filepath.Join(root, "spool", "event-1", "session-1")
	if err := os.MkdirAll(destDir, 0o750); err != nil {
		t.Fatalf("mkdir dest dir: %v", err)
	}
	src := filepath.Join(root, "source.ts")
	writeFile(t, src, "copied-content")
	destPath := filepath.Join(destDir, "1-source.ts")

	result, err := copyFallback(src, destDir, destPath)
	if err != nil {
		t.Fatalf("copyFallback() error: %v", err)
	}
	if result.SpoolPath != destPath {
		t.Errorf("SpoolPath = %q, want %q", result.SpoolPath, destPath)
	}

	got, err := os.ReadFile(destPath)
	if err != nil {
		t.Fatalf("read destination: %v", err)
	}
	if string(got) != "copied-content" {
		t.Errorf("destination contents = %q, want %q", got, "copied-content")
	}

	entries, err := os.ReadDir(destDir)
	if err != nil {
		t.Fatalf("read dest dir: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("dest dir has %d entries, want 1 (no leftover temp file)", len(entries))
	}
}

func TestSegmentFileNameSanitizesUnsafeCharacters(t *testing.T) {
	name := SegmentFileName(7, "../../etc/passwd")
	if filepath.Base(name) != name {
		t.Errorf("SegmentFileName() = %q, contains a path separator", name)
	}
}
