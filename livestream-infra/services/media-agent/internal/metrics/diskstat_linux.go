//go:build linux

package metrics

import "syscall"

// DiskFreeBytes reports the free and total byte capacity of the
// filesystem containing path, using the standard library's syscall
// package directly (no third-party dependency - see the package doc for
// why). The Media Agent only ever runs in a Linux container in
// production, but a non-Linux build (e.g. a contributor's native `go
// vet` on another OS) falls back to diskstat_other.go instead of failing
// to compile.
func DiskFreeBytes(path string) (free, total uint64, err error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, err
	}
	free = stat.Bavail * uint64(stat.Bsize)
	total = stat.Blocks * uint64(stat.Bsize)
	return free, total, nil
}
