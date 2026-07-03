package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
)

func envMap(m map[string]string) func(string) string {
	return func(key string) string {
		return m[key]
	}
}

// freeLoopbackAddr reserves an ephemeral loopback port and releases it
// so the code under test can bind it. The tiny window between release
// and rebind is acceptable because tests in this package do not run in
// parallel.
func freeLoopbackAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to reserve loopback port: %v", err)
	}
	addr := l.Addr().String()
	if err := l.Close(); err != nil {
		t.Fatalf("failed to release reserved port: %v", err)
	}
	return addr
}

// waitForHealthz polls GET /healthz until it returns 200, failing the
// test if run() exits early, a non-200 status arrives, or the deadline
// passes.
func waitForHealthz(t *testing.T, addr string, done <-chan error) {
	t.Helper()
	client := &http.Client{Timeout: time.Second}
	url := fmt.Sprintf("http://%s/healthz", addr)
	deadline := time.Now().Add(10 * time.Second)
	for {
		select {
		case err := <-done:
			t.Fatalf("run() returned before shutdown was requested: %v", err)
		default:
		}

		resp, err := client.Get(url)
		if err == nil {
			status := resp.StatusCode
			resp.Body.Close()
			if status == http.StatusOK {
				return
			}
			t.Fatalf("GET /healthz status = %d, want %d", status, http.StatusOK)
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not start serving /healthz: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestRunServesHealthAndShutsDownCleanly(t *testing.T) {
	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- run(ctx, envMap(map[string]string{
			config.EnvNodeID:   "test-node",
			config.EnvHTTPAddr: addr,
		}), io.Discard)
	}()

	waitForHealthz(t, addr, done)
	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run() = %v, want nil after graceful shutdown", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run() did not return after context cancellation")
	}
}

func TestRunFailsFastOnInvalidConfig(t *testing.T) {
	ctx := context.Background()

	err := run(ctx, envMap(map[string]string{}), io.Discard)
	if err == nil {
		t.Fatal("run() expected error for missing required configuration, got nil")
	}
}

func TestRunFailsWhenAddressAlreadyBound(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to occupy a loopback port: %v", err)
	}
	defer l.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	runErr := run(ctx, envMap(map[string]string{
		config.EnvNodeID:   "test-node",
		config.EnvHTTPAddr: l.Addr().String(),
	}), io.Discard)
	if runErr == nil {
		t.Fatal("run() expected error when the address is already bound, got nil")
	}
	if ctx.Err() != nil {
		t.Fatal("run() only returned because the test context expired, not because the bind failed")
	}
}

func TestRunHealthCheckSucceedsAgainstHealthyServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	addr := strings.TrimPrefix(server.URL, "http://")
	err := runHealthCheck(envMap(map[string]string{
		config.EnvNodeID:   "test-node",
		config.EnvHTTPAddr: addr,
	}))
	if err != nil {
		t.Fatalf("runHealthCheck() = %v, want nil", err)
	}
}

func TestRunHealthCheckFailsOnNonOKStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	addr := strings.TrimPrefix(server.URL, "http://")
	err := runHealthCheck(envMap(map[string]string{
		config.EnvNodeID:   "test-node",
		config.EnvHTTPAddr: addr,
	}))
	if err == nil {
		t.Fatal("runHealthCheck() expected error for non-200 status, got nil")
	}
}

func TestRunHealthCheckFailsWhenServerUnreachable(t *testing.T) {
	err := runHealthCheck(envMap(map[string]string{
		config.EnvNodeID:   "test-node",
		config.EnvHTTPAddr: freeLoopbackAddr(t),
	}))
	if err == nil {
		t.Fatal("runHealthCheck() expected error for unreachable server, got nil")
	}
}

func TestRunHealthCheckFailsFastOnInvalidConfig(t *testing.T) {
	err := runHealthCheck(envMap(map[string]string{}))
	if err == nil {
		t.Fatal("runHealthCheck() expected error for missing required configuration, got nil")
	}
}
