// Command controlplane-mock runs internal/controlplane's deterministic
// mock control-plane server as a standalone process, for local
// development and isolated integration/failure-injection testing (see
// infra/media-node/compose). It is never deployed in production; the
// real Media Agent talks to it exactly like a real control plane through
// internal/controlplane.HTTPClient, using the documented contract in
// internal/controlplane/client.go.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/controlplane"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	addr := os.Getenv("CONTROLPLANE_MOCK_HTTP_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8090"
	}
	token := os.Getenv("CONTROLPLANE_MOCK_NODE_TOKEN")
	seedPath := os.Getenv("CONTROLPLANE_MOCK_SEED_PATH")

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	mock := controlplane.NewMockServer(token)
	if seedPath != "" {
		data, err := os.ReadFile(seedPath)
		if err != nil {
			return fmt.Errorf("controlplane-mock: read seed file: %w", err)
		}
		var seeded controlplane.AssignmentsResponse
		if err := json.Unmarshal(data, &seeded); err != nil {
			return fmt.Errorf("controlplane-mock: parse seed file: %w", err)
		}
		mock.SetAssignments(seeded.ConfigVersion, seeded.Assignments)
		logger.Info("controlplane-mock seeded", slog.Int("assignment_count", len(seeded.Assignments)))
	}

	server := &http.Server{
		Addr:              addr,
		Handler:           mock.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("controlplane-mock listening", slog.String("addr", addr))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case <-ctx.Done():
	case err := <-serveErr:
		return err
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}
