//go:build !linux

package metrics

import "fmt"

// DiskFreeBytes is not implemented on non-Linux platforms; see
// diskstat_linux.go. The Media Agent only ships and runs as a Linux
// container, so this path is never exercised in production - it exists
// solely so the package still compiles for a contributor running tooling
// on another OS.
func DiskFreeBytes(path string) (free, total uint64, err error) {
	return 0, 0, fmt.Errorf("metrics: DiskFreeBytes is not implemented on this platform")
}
