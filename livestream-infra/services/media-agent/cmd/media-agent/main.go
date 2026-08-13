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
	"sync/atomic"
	"syscall"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/config"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/controlplane"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/health"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/metrics"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/operatorauth"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/ratelimit"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/reconcile"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/relay"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/srs"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/upload"
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
	startTime := time.Now()
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

	// metricsReg/sink hold every Prometheus-compatible metric this
	// process exposes (internal/metrics); wiring happens throughout the
	// rest of this function as each subsystem is constructed.
	metricsReg := metrics.NewRegistry()
	sink := metrics.NewSink(metricsReg)
	sink.ControlPlaneEnabled.SetBool(cfg.ControlPlaneEnabled)

	// youtubeKeyStore resolves an event id to its raw YouTube stream key,
	// deliberately never written to or read back from SQLite - see
	// migrations/0002_media_delivery.sql - so it lives only in this
	// process's memory for its whole lifetime. Without continuous
	// control-plane sync it is a fixed snapshot built once from the seed
	// file below; with sync enabled it is instead a live cache
	// (internal/controlplane.StreamKeyCache) internal/controlplane.Syncer
	// keeps current after every successful sync.
	var youtubeKeyStore srs.YouTubeKeyStore
	var cpStreamKeyCache *controlplane.StreamKeyCache
	var staticYouTubeKeys srs.StaticYouTubeKeyStore
	if cfg.ControlPlaneEnabled {
		cpStreamKeyCache = controlplane.NewStreamKeyCache()
		youtubeKeyStore = cpStreamKeyCache
	} else {
		staticYouTubeKeys = make(srs.StaticYouTubeKeyStore)
		youtubeKeyStore = staticYouTubeKeys
	}

	// The local seed file remains a valid bootstrap mechanism even when
	// control-plane sync is enabled (e.g. so a fresh node has at least
	// some cached assignments before its first successful sync
	// completes), but it is imported with source='seed' and
	// ApplyControlPlaneAssignments below never overwrites or revokes a
	// seed-sourced row and never treats it as fresher than real
	// control-plane state; see internal/store.ApplyControlPlaneAssignments
	// and this milestone's requirement that "static assignment seeds ...
	// must not silently override fresher control-plane state." YouTube
	// keys are only ever populated into the static store from the seed
	// file when control-plane sync is disabled - with sync enabled, only
	// the dynamic StreamKeyCache (updated post-sync, below) is used, so
	// there is exactly one live source of truth for raw keys at runtime.
	if cfg.AssignmentSeedPath != "" {
		assignments, err := store.LoadAssignmentsFromFile(cfg.AssignmentSeedPath)
		if err != nil {
			logger.Error("failed to load assignment seed file", slog.String("error", err.Error()))
			return fmt.Errorf("load assignment seed: %w", err)
		}
		// A local seed file must never be able to self-authorize a real
		// publish in a real deployment - see
		// config.EnvAllowSeedEnabledAssignments and
		// store.SanitizeSeedAssignments. Every enabled=true row is forced
		// to disabled unless the dev/test-only opt-in is set; each
		// affected row is logged individually (by ingest_id only, never
		// its secret hash) so a misconfigured deployment's startup log
		// makes the neutralization visible rather than silent.
		if !cfg.AllowSeedEnabledAssignments {
			for _, a := range assignments {
				if a.Enabled {
					logger.Warn("seed assignment had enabled=true; forced to disabled",
						slog.String("ingest_id", a.IngestID),
						slog.String("reason", "EVENTCAST_ALLOW_SEED_ENABLED_ASSIGNMENTS is not set"))
				}
			}
		}
		sanitized := store.SanitizeSeedAssignments(assignments, cfg.AllowSeedEnabledAssignments)
		n, err := st.ImportAssignments(ctx, sanitized)
		if err != nil {
			logger.Error("failed to import assignment seed file", slog.String("error", err.Error()))
			return fmt.Errorf("import assignment seed: %w", err)
		}
		logger.Info("assignment seed imported", slog.Int("assignment_count", n))

		if !cfg.ControlPlaneEnabled {
			for _, a := range assignments {
				if a.YouTubeEnabled {
					staticYouTubeKeys[a.EventID] = a.YouTubeStreamKey
				}
			}
		}
	}

	var cpSyncer *controlplane.Syncer
	if cfg.ControlPlaneEnabled {
		cpClient := controlplane.NewHTTPClient(cfg.ControlPlaneBaseURL, cfg.ControlPlaneNodeToken, &http.Client{Timeout: cfg.ControlPlaneRequestTimeout})
		cpSyncer = controlplane.NewSyncer(st, cpClient, cpStreamKeyCache, controlplane.SyncerConfig{
			NodeID:             cfg.NodeID,
			RequestTimeout:     cfg.ControlPlaneRequestTimeout,
			SyncInterval:       cfg.ControlPlaneSyncInterval,
			BackoffBase:        cfg.ControlPlaneBackoffBase,
			BackoffMax:         cfg.ControlPlaneBackoffMax,
			StaleWarnAfter:     cfg.ControlPlaneStaleWarnAfter,
			StaleCriticalAfter: cfg.ControlPlaneStaleCriticalAfter,
		}, logger)

		logger.Info("performing startup control-plane sync", slog.String("base_url", cfg.ControlPlaneBaseURL))
		startupSyncCtx, cancelStartupSync := context.WithTimeout(ctx, cfg.ControlPlaneRequestTimeout+2*time.Second)
		if err := cpSyncer.SyncOnce(startupSyncCtx); err != nil {
			// Never fatal: an unreachable control plane at startup must
			// not prevent the agent from serving already-cached,
			// unexpired publishers (03_DATA_MODEL_AND_API_CONTRACTS.md
			// "Assignment synchronization").
			logger.Warn("startup control-plane sync failed; continuing on last known good cache", slog.String("error", err.Error()))
		}
		cancelStartupSync()

		cpCtx, cancelCP := context.WithCancel(context.Background())
		var cpWG sync.WaitGroup
		cpWG.Add(1)
		go func() { defer cpWG.Done(); cpSyncer.Run(cpCtx) }()
		defer func() { cancelCP(); cpWG.Wait() }()

		logger.Info("control-plane assignment sync enabled")
	} else {
		logger.Warn("control-plane assignment sync disabled: EVENTCAST_CONTROLPLANE_BASE_URL is not set; relying solely on the static assignment seed")
	}

	if cfg.OperatorAPIToken.Reveal() == "" {
		logger.Warn("EVENTCAST_OPERATOR_API_TOKEN is not set: the VOD finalize and vod-gap operator endpoints are unauthenticated; production deployments must set this")
	}

	// reconcileLastRunAt is read by the metrics refresh function
	// (collectMetrics) to compute how long ago the most recent
	// reconciliation pass completed. It is updated from both the
	// explicit startup call below and every periodic pass via
	// reconciler.OnComplete, so it is a plain atomic value rather than a
	// local variable closed over by only one of those two call sites.
	var reconcileLastRunAt atomic.Int64 // Unix seconds

	recordReconcileReport := func(report reconcile.Report) {
		sink.ReconcileRunsTotal.Inc()
		sink.ReconcileOrphansReconciled.Set(float64(report.OrphanSegmentsReconciled))
		sink.ReconcileStuckCapturesResolved.Set(float64(report.StuckCapturesResolved))
		sink.ReconcileSegmentsMarkedMissing.Set(float64(report.SegmentsMarkedMissing))
		sink.ReconcileSessionsMarkedStale.Set(float64(report.SessionsMarkedStale))
		sink.ReconcileIntegrityOK.SetBool(report.IntegrityOK)
	}

	reconciler := reconcile.New(st, reconcile.Config{
		SpoolRoot:           cfg.SpoolRoot,
		SessionStaleTimeout: cfg.SessionStaleTimeout,
	}, logger)
	reconciler.OnComplete = func(report reconcile.Report, at time.Time) {
		recordReconcileReport(report)
		reconcileLastRunAt.Store(at.Unix())
	}

	logger.Info("running startup reconciliation")
	startupReport, err := reconciler.RunOnce(ctx)
	if err != nil {
		logger.Error("startup reconciliation failed", slog.String("error", err.Error()))
		return fmt.Errorf("startup reconciliation: %w", err)
	}
	recordReconcileReport(startupReport)
	reconcileLastRunAt.Store(time.Now().UTC().Unix())
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

	// YouTube relay supervision is always constructed - it costs nothing
	// idle - but only ever starts a process for a session whose
	// assignment has YouTubeEnabled (internal/srs.Handlers.maybeStartRelay),
	// per ADR-012's "independent, optional per event" design.
	relaySupervisor := relay.New(st, relay.Config{
		FFmpegPath:                cfg.YouTubeFFmpegPath,
		RestartMaxAttempts:        cfg.YouTubeRestartMaxAttempts,
		RestartBackoffBase:        cfg.YouTubeRestartBackoffBase,
		RestartBackoffMax:         cfg.YouTubeRestartBackoffMax,
		ShutdownTimeout:           shutdownTimeout,
		SourceReadyTimeout:        cfg.YouTubeSourceReadyTimeout,
		SourceReadyMinRunDuration: cfg.YouTubeSourceReadyMinRunDuration,
		SourceReadyRetryInterval:  cfg.YouTubeSourceReadyRetryInterval,
	}, logger)
	if n, err := st.ReconcileStaleRelays(ctx, time.Now().UTC()); err != nil {
		logger.Error("failed to reconcile stale relay records", slog.String("error", err.Error()))
	} else if n > 0 {
		logger.Info("stale relay records reconciled at startup", slog.Int("count", n))
	}
	defer relaySupervisor.Shutdown()

	srsHandlers := &srs.Handlers{
		Store:                    st,
		HLSRoot:                  cfg.SRSHLSRoot,
		SpoolRoot:                cfg.SpoolRoot,
		Logger:                   logger,
		Relay:                    relaySupervisor,
		YouTubeSourceRTMPBaseURL: cfg.YouTubeSourceRTMPBaseURL,
		YouTubeStreamKeys:        youtubeKeyStore,
		Metrics:                  sink,
	}

	// Rate limiting and abuse protection (internal/ratelimit), applied to
	// every non-loopback-diagnostic endpoint below: SRS callbacks and the
	// operator endpoints. The client key never trusts a spoofable
	// forwarding header unless the deployment explicitly opts in via
	// EVENTCAST_TRUSTED_PROXY_ENABLED.
	limiter := ratelimit.New(cfg.RateLimitRPS, cfg.RateLimitBurst)
	clientKeyFunc := ratelimit.ClientIP
	if cfg.TrustedProxyEnabled {
		clientKeyFunc = ratelimit.TrustedProxyClientIP
	}
	rateLimited := func(h http.Handler) http.Handler {
		return ratelimit.Middleware(limiter, clientKeyFunc, logger, h)
	}
	operatorProtected := func(h http.Handler) http.Handler {
		return rateLimited(operatorauth.RequireBearerToken(cfg.OperatorAPIToken, logger, h))
	}

	limiterSweepCtx, cancelLimiterSweep := context.WithCancel(context.Background())
	var limiterSweepWG sync.WaitGroup
	limiterSweepWG.Add(1)
	go func() {
		defer limiterSweepWG.Done()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-limiterSweepCtx.Done():
				return
			case <-ticker.C:
				limiter.Sweep(10 * time.Minute)
			}
		}
	}()
	defer func() { cancelLimiterSweep(); limiterSweepWG.Wait() }()

	var shuttingDown atomic.Bool

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.Handler())
	mux.Handle("/readyz", health.ReadinessHandlerWithB2(
		readinessChecks(st, cfg.SpoolRoot, cpSyncer),
		// Booleans only - this is how an operator confirms the B2
		// configuration landed without any credential value being read back.
		health.B2Status{Configured: cfg.B2Configured, ArchivalEnabled: cfg.B2ArchivalEnabled},
	))
	mux.Handle("/metrics", metrics.Handler(metricsReg, collectMetrics(st, cfg, cpSyncer, sink, startTime, &reconcileLastRunAt, &shuttingDown)))
	mux.Handle("/internal/srs/on-publish", rateLimited(srsHandlers.OnPublish()))
	mux.Handle("/internal/srs/on-hls", rateLimited(srsHandlers.OnHLS()))
	mux.Handle("/internal/srs/on-unpublish", rateLimited(srsHandlers.OnUnpublish()))

	if cfg.R2Enabled {
		manifestCfg := upload.ManifestConfig{
			ObjectPrefix:   cfg.R2ObjectPrefix,
			PublicBaseURL:  cfg.R2PublicBaseURL,
			DVRWindow:      cfg.DVRWindow,
			RequestTimeout: cfg.R2RequestTimeout,
		}

		r2Client, err := upload.NewR2Client(upload.R2Config{
			Endpoint:           cfg.R2Endpoint,
			Region:             cfg.R2Region,
			Bucket:             cfg.R2Bucket,
			AccessKeyID:        cfg.R2AccessKeyID,
			SecretAccessKey:    cfg.R2SecretAccessKey,
			InsecureSkipVerify: cfg.R2InsecureSkipVerify,
		})
		if err != nil {
			logger.Error("failed to construct R2 client", slog.String("error", err.Error()))
			return fmt.Errorf("construct r2 client: %w", err)
		}

		manifestManager := upload.NewManifestManager(st, r2Client, manifestCfg, logger)

		uploadWorker := upload.NewWorker(st, r2Client, upload.WorkerConfig{
			ObjectPrefix:   cfg.R2ObjectPrefix,
			Concurrency:    cfg.R2UploadConcurrency,
			LeaseDuration:  cfg.R2UploadLeaseDuration,
			RequestTimeout: cfg.R2RequestTimeout,
			RetryBaseDelay: cfg.R2RetryBaseDelay,
			RetryMaxDelay:  cfg.R2RetryMaxDelay,
			OnConfirmed:    manifestManager.Touch,
		}, logger)

		vodFinalizer := upload.NewVODFinalizer(st, r2Client, manifestCfg, logger)

		retentionWorker := upload.NewRetentionWorker(st, upload.RetentionConfig{
			SpoolRoot:           cfg.SpoolRoot,
			LocalRetentionDelay: cfg.LocalRetentionDelay,
			// With archival on, the local spool is the archiver's only byte
			// source, so the elapsed delay alone must no longer release it.
			B2ArchivalEnabled: cfg.B2ArchivalEnabled,
		}, logger)

		// B2 authoritative archival. Deliberately gated on
		// B2ArchivalEnabled, not merely on B2Configured: holding valid
		// credentials (so the isolated connectivity test can run) must never
		// by itself start archiving real recordings. When this is off, no
		// enqueue happens, no archive row is ever created, and both local
		// finalization and the original 24-hour spool behavior are unchanged.
		var b2ArchiveWorker *upload.B2ArchiveWorker
		var recordingReporter *controlplane.RecordingReporter
		if cfg.B2ArchivalEnabled {
			b2Client, err := upload.NewS3CompatibleClient(upload.S3Config{
				Endpoint:           cfg.B2Endpoint,
				Region:             cfg.B2Region,
				Bucket:             cfg.B2Bucket,
				AccessKeyID:        cfg.B2AccessKeyID,
				SecretAccessKey:    cfg.B2SecretAccessKey,
				InsecureSkipVerify: cfg.B2InsecureSkipVerify,
			})
			if err != nil {
				logger.Error("failed to construct B2 client; B2 archival stays disabled", slog.String("error", err.Error()))
			} else {
				archiver := upload.NewB2Archiver(st, b2Client, upload.B2ArchiveConfig{
					Bucket:         cfg.B2Bucket,
					ObjectPrefix:   cfg.B2ObjectPrefix,
					RequestTimeout: cfg.B2RequestTimeout,
				}, logger)
				b2ArchiveWorker = upload.NewB2ArchiveWorker(st, archiver, upload.B2ArchiveWorkerConfig{
					RetryBaseDelay: cfg.B2RetryBaseDelay,
					RetryMaxDelay:  cfg.B2RetryMaxDelay,
				}, logger)

				// Finalization only ENQUEUES the work; the worker above does
				// the transfer, so an operator finalize request never waits on
				// B2 network I/O.
				vodFinalizer = vodFinalizer.WithB2Enqueuer(upload.NewB2Enqueuer(st))

				if cfg.ControlPlaneEnabled {
					recordingReporter = controlplane.NewRecordingReporter(st,
						controlplane.NewHTTPClient(cfg.ControlPlaneBaseURL, cfg.ControlPlaneNodeToken,
							&http.Client{Timeout: cfg.ControlPlaneRequestTimeout}),
						controlplane.RecordingReporterConfig{
							NodeID:         cfg.NodeID,
							RetryBaseDelay: cfg.B2RetryBaseDelay,
							RetryMaxDelay:  cfg.B2RetryMaxDelay,
						}, logger)
				} else {
					// Archival still proceeds and stays durable; the evidence
					// simply cannot be delivered until a control plane is
					// configured. Nothing is lost - the outbox retains it.
					logger.Warn("B2 archival enabled without a control plane: recording evidence will be archived durably but not reported")
				}

				logger.Info("B2 authoritative archival enabled", slog.String("bucket", cfg.B2Bucket))
			}
		} else if cfg.B2Configured {
			logger.Info("B2 configured but production archival is disabled; only the isolated connectivity test may use it")
		}

		if n, err := st.ReclaimExpiredUploadLeases(ctx, time.Now().UTC()); err != nil {
			logger.Error("failed to reclaim expired upload leases", slog.String("error", err.Error()))
		} else if n > 0 {
			logger.Info("expired upload leases reclaimed at startup", slog.Int("count", n))
		}

		uploadCtx, cancelUpload := context.WithCancel(context.Background())
		var uploadWG sync.WaitGroup
		uploadWG.Add(3)
		go func() { defer uploadWG.Done(); uploadWorker.Run(uploadCtx) }()
		go func() { defer uploadWG.Done(); manifestManager.Run(uploadCtx, cfg.ManifestRebuildInterval) }()
		go func() { defer uploadWG.Done(); retentionWorker.Run(uploadCtx, cfg.CleanupInterval) }()
		if b2ArchiveWorker != nil {
			uploadWG.Add(1)
			go func() { defer uploadWG.Done(); b2ArchiveWorker.Run(uploadCtx, cfg.B2ArchiveInterval) }()
		}
		if recordingReporter != nil {
			uploadWG.Add(1)
			go func() { defer uploadWG.Done(); recordingReporter.Run(uploadCtx, cfg.B2ReportInterval) }()
		}
		defer func() {
			cancelUpload()
			uploadWG.Wait()
		}()

		mux.Handle("POST /internal/events/{event_id}/finalize", operatorProtected(&upload.FinalizeHandler{Finalizer: vodFinalizer, Logger: logger}))
		mux.Handle("/internal/events/{event_id}/vod-gap", operatorProtected(&upload.VODGapHandler{Store: st, Logger: logger}))

		logger.Info("R2 upload/manifest/VOD/retention subsystem enabled",
			slog.String("bucket", cfg.R2Bucket), slog.Int("upload_concurrency", cfg.R2UploadConcurrency))
	} else {
		logger.Warn("R2 upload/manifest/VOD/retention subsystem disabled: EVENTCAST_R2_BUCKET is not set")
	}

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

	shuttingDown.Store(true)
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
// probe using this service's own exact marker file name), that the
// assignment cache table is queryable, and (only when control-plane sync
// is enabled) that the cache is not critically stale. No path, count, or
// other filesystem/database detail is exposed in the response; these
// checks only ever produce a boolean.
func readinessChecks(st *store.Store, spoolRoot string, cpSyncer *controlplane.Syncer) health.ReadinessChecks {
	return health.ReadinessChecks{
		Database: func(ctx context.Context) error {
			return st.Ping(ctx)
		},
		ControlPlaneCache: func(ctx context.Context) error {
			if cpSyncer == nil {
				return nil
			}
			status, err := cpSyncer.Status(ctx)
			if err != nil {
				return err
			}
			if status.CriticallyStale {
				return fmt.Errorf("control-plane assignment cache critically stale")
			}
			return nil
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

// collectMetrics returns GET /metrics's pre-render refresh hook
// (internal/metrics.Handler): it polls durable state and process/host
// facts and updates every gauge in sink that cannot be maintained as a
// true incrementing counter at its point of occurrence (see
// internal/metrics.Sink's doc comment). It is deliberately tolerant of
// individual query failures - one failed probe (e.g. a transient SQLite
// busy error) logs and continues rather than blanking the entire scrape,
// since an operator mid-incident needs whatever metrics are still
// obtainable, not an all-or-nothing endpoint.
func collectMetrics(
	st *store.Store,
	cfg config.Config,
	cpSyncer *controlplane.Syncer,
	sink *metrics.Sink,
	startTime time.Time,
	reconcileLastRunAt *atomic.Int64,
	shuttingDown *atomic.Bool,
) func(ctx context.Context) {
	return func(ctx context.Context) {
		sink.ProcessUptimeSeconds.Set(time.Since(startTime).Seconds())
		sink.ShuttingDown.SetBool(shuttingDown.Load())

		sink.DBHealthy.SetBool(st.Ping(ctx) == nil)

		if free, total, err := metrics.DiskFreeBytes(cfg.SpoolRoot); err == nil {
			sink.SpoolFreeBytes.Set(float64(free))
			sink.SpoolTotalBytes.Set(float64(total))
		}

		if last := reconcileLastRunAt.Load(); last > 0 {
			sink.ReconcileLastRunAgeSeconds.Set(time.Since(time.Unix(last, 0).UTC()).Seconds())
		}

		if cpSyncer != nil {
			if status, err := cpSyncer.Status(ctx); err == nil {
				if !status.LastSuccessAt.IsZero() {
					sink.ControlPlaneLastSuccessAgeSeconds.Set(time.Since(status.LastSuccessAt).Seconds())
				}
				sink.ControlPlaneConsecutiveFailures.Set(float64(status.ConsecutiveFailures))
				sink.ControlPlaneStale.SetBool(status.Stale)
				sink.ControlPlaneCriticallyStale.SetBool(status.CriticallyStale)
			}
		}

		snap, err := st.GetMetricsSnapshot(ctx, time.Now().UTC())
		if err != nil {
			return
		}
		// SetGroup (not a plain Set per key) is required here, not just
		// convenient: a status value absent from this scrape's snapshot -
		// e.g. no session is currently "active", no relay is currently
		// "running" - means that key is also absent from counts, and a
		// plain Set would then simply never touch that series again,
		// leaving it stuck at whatever it last reported (a field-tested
		// bug: sessions/relays showed as active/running long after they
		// had actually ended). SetGroup resets any such now-absent key
		// back to zero instead. Every key here always comes from a small,
		// fixed SQL CHECK-constrained enum column (segment/session/VOD/
		// relay status values), never request-controlled input, so this
		// can never create an unbounded metric label.
		sink.SessionsActive.SetGroup("status", snap.SessionsByStatus)
		sink.SegmentJobs.SetGroup("status", snap.SegmentJobsByStatus)
		sink.SegmentUploadStatus.SetGroup("upload_status", snap.SegmentsByUploadStatus)
		sink.ManifestGenerations.SetGroup("manifest_type", snap.ManifestGenerationsByType)
		sink.VODFinalizations.SetGroup("status", snap.VODFinalizationsByStatus)
		sink.VODGapState.SetGroup("gap_status", snap.VODByGapStatus)
		sink.RelayStatus.SetGroup("status", snap.RelaysByStatus)
		sink.SegmentUploadAttempts.Set(float64(snap.SegmentUploadAttemptsSum))
		sink.RelayRestartsTotal.Set(float64(snap.RelayRestartsSum))
		sink.QueueOldestAgeSeconds.Set(snap.OldestPendingUploadAgeSeconds)
	}
}
