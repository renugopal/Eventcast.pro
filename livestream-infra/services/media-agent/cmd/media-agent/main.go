// Command media-agent is the EventCast Media Agent entrypoint. This
// Phase 0 skeleton starts an HTTP server exposing GET /healthz only;
// SRS callbacks, the durable spool, the SQLite queue, R2/Wasabi
// upload, and relay logic are implemented in later phases.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/health"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

// healthCheckTimeout bounds the self-check request issued by the
// "healthcheck" subcommand, used by the container HEALTHCHECK
// instruction so the runtime image needs no extra HTTP client tool.
const healthCheckTimeout = 3 * time.Second

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := runHealthCheck(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	bootstrapLogger := logging.New(os.Stdout, slog.LevelInfo)

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		bootstrapLogger.Error("invalid configuration", slog.String("error", err.Error()))
		return err
	}

	level, err := logging.ParseLevel(cfg.LogLevel)
	if err != nil {
		bootstrapLogger.Error("invalid configuration", slog.String("error", err.Error()))
		return err
	}
	logger := logging.New(os.Stdout, level)

	logger.Info("media-agent starting",
		slog.String("node_id", cfg.NodeID),
		slog.String("http_addr", cfg.HTTPAddr),
		slog.String("log_level", cfg.LogLevel),
		slog.String("version", health.Version),
	)

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.Handler())

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("http server listening", slog.String("addr", cfg.HTTPAddr))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	case err := <-serveErr:
		if err != nil {
			logger.Error("http server failed", slog.String("error", err.Error()))
			return fmt.Errorf("http server: %w", err)
		}
		return nil
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", slog.String("error", err.Error()))
		return fmt.Errorf("shutdown: %w", err)
	}

	logger.Info("media-agent stopped cleanly")
	return nil
}

// runHealthCheck implements the "media-agent healthcheck" subcommand
// used by the Docker HEALTHCHECK instruction. It reads the same
// EVENTCAST_MEDIA_AGENT_HTTP_ADDR the server binds to and issues a
// single GET /healthz request against it, avoiding the need for curl
// or wget in the minimal runtime image.
func runHealthCheck() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}

	client := http.Client{Timeout: healthCheckTimeout}
	resp, err := client.Get(fmt.Sprintf("http://%s/healthz", cfg.HTTPAddr))
	if err != nil {
		return fmt.Errorf("healthcheck: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck: unexpected status %d", resp.StatusCode)
	}
	return nil
}
