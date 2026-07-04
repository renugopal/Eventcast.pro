// Command media-agent is the EventCast Media Agent entrypoint. It
// starts an HTTP server exposing GET /healthz, GET /readyz, and the SRS
// callback routes (on-publish, on-hls, on-unpublish) backed by the
// durable SQLite assignment cache, session lifecycle, and segment
// queue, and runs startup plus periodic reconciliation. R2/Wasabi
// upload and relay logic are implemented in later phases.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/health"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/reconcile"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/srs"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

const (
	// healthCheckTimeout bounds the self-check request issued by the
	// "healthcheck" subcommand, used by the container HEALTHCHECK
	// instruction so the runtime image needs no extra HTTP client tool.
	healthCheckTimeout = 3 * time.Second

	// shutdownTimeout bounds graceful drain of in-flight requests after
	// a termination signal.
	shutdownTimeout = 10 * time.Second

	// spoolWriteProbeName is the exact, service-owned marker file name
	// the readiness spool-writable check creates and immediately
	// removes. It intentionally matches no naming pattern relied on
	// elsewhere so it can never be mistaken for durable media or a
	// crash-recovery temp file.
	spoolWriteProbeName = ".readyz-write-probe"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := runHealthCheck(os.Getenv); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// run starts the Media Agent HTTP server and blocks until ctx is
// cancelled (normal termination) or the server fails. It is separated
// from main, with the environment and log destination injected, so
// tests can drive a complete startup/shutdown cycle in-process.
func run(ctx context.Context, getenv func(string) string, stdout io.Writer) error {
	bootstrapLogger := logging.New(stdout, slog.LevelInfo)

	cfg, err := config.Load(getenv)
	if err != nil {
		bootstrapLogger.Error("invalid configuration", slog.String("error", err.Error()))
		return err
	}

	level, err := logging.ParseLevel(cfg.LogLevel)
	if err != nil {
		bootstrapLogger.Error("invalid configuration", slog.String("error", err.Error()))
		return err
	}
	logger := logging.New(stdout, level)

	logger.Info("media-agent starting",
		slog.String("node_id", cfg.NodeID),
		slog.String("http_addr", cfg.HTTPAddr),
		slog.String("log_level", cfg.LogLevel),
		slog.String("version", health.Version),
	)

	if err := os.MkdirAll(cfg.SpoolRoot, 0o750); err != nil {
		logger.Error("failed to prepare spool root", slog.String("error", err.Error()))
		return fmt.Errorf("prepare spool root: %w", err)
	}

	st, err := store.Open(ctx, cfg.DBPath, cfg.DBBusyTimeout)
	if err != nil {
		logger.Error("failed to open durable database", slog.String("error", err.Error()))
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	if cfg.AssignmentSeedPath != "" {
		assignments, err := store.LoadAssignmentsFromFile(cfg.AssignmentSeedPath)
		if err != nil {
			logger.Error("failed to load assignment seed file", slog.String("error", err.Error()))
			return fmt.Errorf("load assignment seed: %w", err)
		}
		n, err := st.ImportAssignments(ctx, assignments)
		if err != nil {
			logger.Error("failed to import assignment seed file", slog.String("error", err.Error()))
			return fmt.Errorf("import assignment seed: %w", err)
		}
		logger.Info("assignment seed imported", slog.Int("assignment_count", n))
	}

	reconciler := reconcile.New(st, reconcile.Config{
		SpoolRoot:           cfg.SpoolRoot,
		SessionStaleTimeout: cfg.SessionStaleTimeout,
	}, logger)

	logger.Info("running startup reconciliation")
	startupReport, err := reconciler.RunOnce(ctx)
	if err != nil {
		logger.Error("startup reconciliation failed", slog.String("error", err.Error()))
		return fmt.Errorf("startup reconciliation: %w", err)
	}
	logger.Info("startup reconciliation complete",
		slog.Int("orphan_segments_reconciled", startupReport.OrphanSegmentsReconciled),
		slog.Int("stuck_captures_resolved", startupReport.StuckCapturesResolved),
		slog.Int("segments_marked_missing", startupReport.SegmentsMarkedMissing),
		slog.Int("sessions_marked_stale", startupReport.SessionsMarkedStale),
		slog.Int("temp_files_cleaned", startupReport.TempFilesCleaned),
		slog.Bool("integrity_ok", startupReport.IntegrityOK),
	)

	reconcileCtx, cancelReconcile := context.WithCancel(context.Background())
	var reconcileWG sync.WaitGroup
	reconcileWG.Add(1)
	go func() {
		defer reconcileWG.Done()
		reconciler.RunPeriodic(reconcileCtx, cfg.ReconcileInterval)
	}()
	defer func() {
		cancelReconcile()
		reconcileWG.Wait()
	}()

	srsHandlers := &srs.Handlers{
		Store:     st,
		HLSRoot:   cfg.SRSHLSRoot,
		SpoolRoot: cfg.SpoolRoot,
		Logger:    logger,
	}

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.Handler())
	mux.Handle("/readyz", health.ReadinessHandler(readinessChecks(st, cfg.SpoolRoot)))
	mux.Handle("/internal/srs/on-publish", srsHandlers.OnPublish())
	mux.Handle("/internal/srs/on-hls", srsHandlers.OnHLS())
	mux.Handle("/internal/srs/on-unpublish", srsHandlers.OnUnpublish())

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		// Route the server's internal error messages (bad TLS
		// handshakes, handler panics) through the structured logger.
		ErrorLog: slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

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

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", slog.String("error", err.Error()))
		return fmt.Errorf("shutdown: %w", err)
	}

	// Surface a listener failure that raced the termination signal;
	// without this drain, a failed bind concurrent with shutdown would
	// be misreported as a clean stop.
	if err := <-serveErr; err != nil {
		logger.Error("http server failed", slog.String("error", err.Error()))
		return fmt.Errorf("http server: %w", err)
	}

	logger.Info("media-agent stopped cleanly")
	return nil
}

// readinessChecks wires GET /readyz's dependency probes: the database
// connection, spool directory writability (via a create-then-remove
// probe using this service's own exact marker file name), and that the
// assignment cache table is queryable. No path, count, or other
// filesystem/database detail is exposed in the response; these checks
// only ever produce a boolean.
func readinessChecks(st *store.Store, spoolRoot string) health.ReadinessChecks {
	return health.ReadinessChecks{
		Database: func(ctx context.Context) error {
			return st.Ping(ctx)
		},
		SpoolWritable: func(ctx context.Context) error {
			probe := spoolRoot + string(os.PathSeparator) + spoolWriteProbeName
			f, err := os.OpenFile(probe, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
			if err != nil {
				return err
			}
			f.Close()
			return os.Remove(probe)
		},
		AssignmentCache: func(ctx context.Context) error {
			_, err := st.AssignmentCount(ctx)
			return err
		},
	}
}

// runHealthCheck implements the "media-agent healthcheck" subcommand
// used by the Docker HEALTHCHECK instruction. It reads the same
// EVENTCAST_MEDIA_AGENT_HTTP_ADDR the server binds to and issues a
// single GET /healthz request against it, avoiding the need for curl
// or wget in the minimal runtime image.
func runHealthCheck(getenv func(string) string) error {
	cfg, err := config.Load(getenv)
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
