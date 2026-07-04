// Package spool implements the Media Agent's durable local capture of
// completed SRS HLS segments (02_V1_ARCHITECTURE_SPEC.md "Local staging
// and durable spool", ADR-007). A segment is not considered protected -
// and the owning on_hls callback must not return success - until
// Capture has returned without error.
package spool

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// Sentinel errors returned by ValidateContained and Capture. Callers
// (internal/srs) map these to stable, non-secret SRS callback rejection
// reasons.
var (
	// ErrEscapesRoot means the callback-provided file path resolves
	// outside the configured root after symlink resolution - a path
	// traversal or symlink-escape attempt.
	ErrEscapesRoot = errors.New("spool: path resolves outside the configured root")
	// ErrSourceIsSymlink means the final path component itself is a
	// symlink, which is never followed for a callback-provided path.
	ErrSourceIsSymlink = errors.New("spool: source path is a symlink")
	// ErrSourceMissing means the validated source file does not exist.
	ErrSourceMissing = errors.New("spool: source file does not exist")
	// ErrDestinationExists means the computed spool destination path
	// already exists. Capture never overwrites an existing file.
	ErrDestinationExists = errors.New("spool: destination already exists")
)

// ValidateContained resolves candidate (which may be relative to root
// or absolute) and verifies the result is root itself or strictly
// inside it, after resolving symlinks on root and on candidate's parent
// directory chain. It never follows a symlink at the final path
// component: if candidate itself is a symlink, that is rejected
// regardless of where it points. Untrusted, callback-provided paths
// (SRS on_hls "file") must always pass through this before any
// filesystem operation reads them.
func ValidateContained(root, candidate string) (string, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("spool: resolve root: %w", err)
	}
	realRoot, err := filepath.EvalSymlinks(absRoot)
	if err != nil {
		return "", fmt.Errorf("spool: resolve root symlinks: %w", err)
	}

	absCandidate := candidate
	if !filepath.IsAbs(absCandidate) {
		absCandidate = filepath.Join(absRoot, absCandidate)
	}
	cleanCandidate := filepath.Clean(absCandidate)

	parentDir := filepath.Dir(cleanCandidate)
	realParent, err := filepath.EvalSymlinks(parentDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", fmt.Errorf("%w: %w", ErrSourceMissing, err)
		}
		return "", fmt.Errorf("spool: resolve parent directory: %w", err)
	}

	realCandidate := filepath.Join(realParent, filepath.Base(cleanCandidate))

	rel, err := filepath.Rel(realRoot, realCandidate)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", ErrEscapesRoot
	}

	info, err := os.Lstat(realCandidate)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", fmt.Errorf("%w: %w", ErrSourceMissing, err)
		}
		return "", fmt.Errorf("spool: stat candidate: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", ErrSourceIsSymlink
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("spool: candidate is not a regular file")
	}

	return realCandidate, nil
}

// CaptureInput identifies one completed SRS segment to durably capture.
type CaptureInput struct {
	// HLSRoot is the configured SRS staging root SourceFile must resolve
	// inside of.
	HLSRoot string
	// SpoolRoot is the configured Media Agent durable spool root.
	SpoolRoot string
	// SourceFile is the callback-provided SRS file path, untrusted until
	// validated.
	SourceFile string
	// EventID and SessionID namespace the destination path with only
	// internal identifiers, never the publishing secret, per
	// 02_V1_ARCHITECTURE_SPEC.md.
	EventID   string
	SessionID string
	// SeqNo is the SRS sequence number, used for collision-safe,
	// human-diagnosable destination naming.
	SeqNo int64
}

// CaptureResult describes the durably-captured file.
type CaptureResult struct {
	SpoolPath string
	ByteSize  int64
	SHA256    string
}

// SegmentFileName is the collision-safe destination file name Capture
// uses for a given SRS sequence number and source basename: the
// sequence number keeps ordering obvious for operators, and the
// sanitized basename keeps the original SRS timestamp-sequence naming
// for diagnosability. Callers that need to compute the same durable
// queue idempotency key before calling Capture (internal/srs) must use
// this exact helper so the two never disagree, and so reconciliation
// can read a discovered file's name directly as its local file
// identity without a separate reconstruction rule.
func SegmentFileName(seqNo int64, sourceBasename string) string {
	return fmt.Sprintf("%d-%s", seqNo, sanitizeComponent(sourceBasename))
}

// Capture validates SourceFile against HLSRoot, then durably protects it
// under SpoolRoot: a hard link when source and destination share a
// filesystem, or a temp-file-plus-fsync-plus-atomic-rename-plus-fsync
// copy fallback otherwise. It never overwrites an existing destination.
// The returned error is one of the sentinel errors above (safe to map
// to a stable rejection reason) or a wrapped filesystem error.
func Capture(ctx context.Context, in CaptureInput) (CaptureResult, error) {
	realSource, err := ValidateContained(in.HLSRoot, in.SourceFile)
	if err != nil {
		return CaptureResult{}, err
	}

	destDir := filepath.Join(in.SpoolRoot, sanitizeComponent(in.EventID), sanitizeComponent(in.SessionID))
	if err := os.MkdirAll(destDir, 0o750); err != nil {
		return CaptureResult{}, fmt.Errorf("spool: create destination directory: %w", err)
	}

	destName := SegmentFileName(in.SeqNo, filepath.Base(realSource))
	destPath := filepath.Join(destDir, destName)

	if _, err := os.Lstat(destPath); err == nil {
		return CaptureResult{}, ErrDestinationExists
	} else if !errors.Is(err, fs.ErrNotExist) {
		return CaptureResult{}, fmt.Errorf("spool: stat destination: %w", err)
	}

	if err := ctx.Err(); err != nil {
		return CaptureResult{}, err
	}

	linkErr := os.Link(realSource, destPath)
	switch {
	case linkErr == nil:
		size, sum, err := hashFile(destPath)
		if err != nil {
			return CaptureResult{}, fmt.Errorf("spool: hash captured file: %w", err)
		}
		if err := fsyncDir(destDir); err != nil {
			return CaptureResult{}, fmt.Errorf("spool: fsync spool directory: %w", err)
		}
		return CaptureResult{SpoolPath: destPath, ByteSize: size, SHA256: sum}, nil

	case isCrossDevice(linkErr):
		return copyFallback(realSource, destDir, destPath)

	default:
		return CaptureResult{}, fmt.Errorf("spool: hard link capture: %w", linkErr)
	}
}

// copyFallback durably copies src to destPath via a same-directory
// temp file, so the final rename is atomic on the destination
// filesystem: write, fsync the file, close, atomically rename, then
// fsync the containing directory so the new directory entry survives a
// crash (02_V1_ARCHITECTURE_SPEC.md "Local staging and durable spool").
func copyFallback(src, destDir, destPath string) (CaptureResult, error) {
	source, err := os.Open(src)
	if err != nil {
		return CaptureResult{}, fmt.Errorf("spool: open source for copy: %w", err)
	}
	defer source.Close()

	tmp, err := os.CreateTemp(destDir, ".tmp-eventcast-*")
	if err != nil {
		return CaptureResult{}, fmt.Errorf("spool: create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	// Best-effort cleanup: if any step below fails, the temp file is
	// removed immediately rather than left for periodic reconciliation,
	// which only cleans up temp files that survived a crash (i.e. this
	// process never got the chance to clean up after itself).
	succeeded := false
	defer func() {
		if !succeeded {
			tmp.Close()
			os.Remove(tmpPath)
		}
	}()

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(tmp, hasher), source)
	if err != nil {
		return CaptureResult{}, fmt.Errorf("spool: copy source: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		return CaptureResult{}, fmt.Errorf("spool: fsync temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return CaptureResult{}, fmt.Errorf("spool: close temp file: %w", err)
	}
	if err := os.Chmod(tmpPath, 0o640); err != nil {
		return CaptureResult{}, fmt.Errorf("spool: set spool file permissions: %w", err)
	}
	if err := os.Rename(tmpPath, destPath); err != nil {
		return CaptureResult{}, fmt.Errorf("spool: rename temp file into place: %w", err)
	}
	succeeded = true

	if err := fsyncDir(destDir); err != nil {
		return CaptureResult{}, fmt.Errorf("spool: fsync spool directory: %w", err)
	}

	return CaptureResult{SpoolPath: destPath, ByteSize: written, SHA256: hex.EncodeToString(hasher.Sum(nil))}, nil
}

func hashFile(path string) (int64, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, "", err
	}
	defer f.Close()

	hasher := sha256.New()
	written, err := io.Copy(hasher, f)
	if err != nil {
		return 0, "", err
	}
	return written, hex.EncodeToString(hasher.Sum(nil)), nil
}

func fsyncDir(path string) error {
	d, err := os.Open(path)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

func isCrossDevice(err error) bool {
	var linkErr *os.LinkError
	if !errors.As(err, &linkErr) {
		return false
	}
	return errors.Is(linkErr.Err, syscall.EXDEV)
}

// sanitizeComponent restricts s to a safe filesystem path-component
// character set, defense in depth for path components that ultimately
// derive from callback-provided input (the source file's basename) even
// though ValidateContained has already confirmed containment. Path
// separators and any other unexpected byte become '_', so the result
// can never introduce an additional path segment.
func sanitizeComponent(s string) string {
	if s == "" {
		return "_"
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '.', c == '_', c == '-':
			b.WriteByte(c)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	if out == "." || out == ".." {
		return "_"
	}
	return out
}
