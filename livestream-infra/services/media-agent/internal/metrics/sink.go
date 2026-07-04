package metrics

// Sink is the Media Agent's complete metric catalog, covering every
// surface this milestone requires: publish authorization, active
// sessions, callback outcomes, spool usage, queue depth and age, upload
// attempts and retry/dead-letter states, manifest publication, VOD and
// VOD-gap status, relay status, control-plane synchronization,
// reconciliation, SQLite health, process health, and shutdown behavior.
// Every label used below is a small, fixed, code-controlled enum (a
// status value, a result kind, a boolean) - never an event id, session
// id, ingest id, or anything else unbounded or secret-derived, per this
// milestone's metric-cardinality requirement.
//
// The zero value is not directly usable label-for-label (each field
// still needs NewCounter/NewGauge called on a real *Registry via
// NewSink), but every exported Counter/Gauge is itself safe to call
// unset (see metrics.go), so a caller that never wires a Sink at all
// (nil *Sink, guarded at each call site by cmd/media-agent/main.go) never
// panics.
type Sink struct {
	PublishAuthTotal Counter // labels: result=accepted|rejected
	CallbackTotal    Counter // labels: callback=on_publish|on_hls|on_unpublish, result=ok|rejected|error

	SessionsActive Gauge // labels: status

	SpoolFreeBytes  Gauge
	SpoolTotalBytes Gauge

	SegmentJobs           Gauge // labels: status (capturing/queued/missing/failed)
	SegmentUploadStatus   Gauge // labels: upload_status (pending/leased/confirmed/dead_letter)
	SegmentUploadAttempts Gauge // sum of upload_attempt_count across all segment_jobs
	QueueOldestAgeSeconds Gauge

	ManifestGenerations Gauge // labels: manifest_type (live/vod)

	VODFinalizations Gauge // labels: status
	VODGapState      Gauge // labels: gap_status

	RelayStatus        Gauge // labels: status
	RelayRestartsTotal Gauge // sum of restart_count across youtube_relays

	ControlPlaneEnabled               Gauge
	ControlPlaneLastSuccessAgeSeconds Gauge
	ControlPlaneConsecutiveFailures   Gauge
	ControlPlaneStale                 Gauge
	ControlPlaneCriticallyStale       Gauge

	ReconcileRunsTotal             Counter
	ReconcileOrphansReconciled     Gauge
	ReconcileStuckCapturesResolved Gauge
	ReconcileSegmentsMarkedMissing Gauge
	ReconcileSessionsMarkedStale   Gauge
	ReconcileIntegrityOK           Gauge
	ReconcileLastRunAgeSeconds     Gauge

	DBHealthy Gauge

	ProcessUptimeSeconds Gauge
	ShuttingDown         Gauge
}

// NewSink registers every metric in the catalog against reg and returns
// the populated Sink.
func NewSink(reg *Registry) *Sink {
	return &Sink{
		PublishAuthTotal: reg.NewCounter("media_agent_publish_auth_total", "Publish authorization decisions by result."),
		CallbackTotal:    reg.NewCounter("media_agent_callback_total", "SRS callback outcomes by callback and result."),

		SessionsActive: reg.NewGauge("media_agent_sessions", "Current ingest session count by status."),

		SpoolFreeBytes:  reg.NewGauge("media_agent_spool_free_bytes", "Free bytes on the filesystem containing the durable spool."),
		SpoolTotalBytes: reg.NewGauge("media_agent_spool_total_bytes", "Total bytes on the filesystem containing the durable spool."),

		SegmentJobs:           reg.NewGauge("media_agent_segment_jobs", "Current segment job count by capture status."),
		SegmentUploadStatus:   reg.NewGauge("media_agent_segment_upload_status", "Current segment job count by upload status."),
		SegmentUploadAttempts: reg.NewGauge("media_agent_segment_upload_attempts_sum", "Sum of upload attempt counts across all segment jobs."),
		QueueOldestAgeSeconds: reg.NewGauge("media_agent_queue_oldest_pending_age_seconds", "Age of the oldest segment still awaiting upload."),

		ManifestGenerations: reg.NewGauge("media_agent_manifest_generations", "Total manifest generations recorded by manifest type."),

		VODFinalizations: reg.NewGauge("media_agent_vod_finalizations", "Current VOD finalization record count by status."),
		VODGapState:      reg.NewGauge("media_agent_vod_gap_state", "Current VOD finalization record count by gap status."),

		RelayStatus:        reg.NewGauge("media_agent_youtube_relays", "Current YouTube relay record count by status."),
		RelayRestartsTotal: reg.NewGauge("media_agent_youtube_relay_restarts_sum", "Sum of restart counts across all YouTube relay records."),

		ControlPlaneEnabled:               reg.NewGauge("media_agent_controlplane_enabled", "1 if continuous control-plane assignment sync is enabled."),
		ControlPlaneLastSuccessAgeSeconds: reg.NewGauge("media_agent_controlplane_last_success_age_seconds", "Seconds since the last successful control-plane sync."),
		ControlPlaneConsecutiveFailures:   reg.NewGauge("media_agent_controlplane_consecutive_failures", "Current consecutive control-plane sync failure count."),
		ControlPlaneStale:                 reg.NewGauge("media_agent_controlplane_cache_stale", "1 if the control-plane assignment cache is stale."),
		ControlPlaneCriticallyStale:       reg.NewGauge("media_agent_controlplane_cache_critically_stale", "1 if the control-plane assignment cache is critically stale."),

		ReconcileRunsTotal:             reg.NewCounter("media_agent_reconcile_runs_total", "Total completed reconciliation passes."),
		ReconcileOrphansReconciled:     reg.NewGauge("media_agent_reconcile_last_run_orphan_segments", "Orphan segments reconciled in the most recent pass."),
		ReconcileStuckCapturesResolved: reg.NewGauge("media_agent_reconcile_last_run_stuck_captures", "Stuck captures resolved in the most recent pass."),
		ReconcileSegmentsMarkedMissing: reg.NewGauge("media_agent_reconcile_last_run_segments_missing", "Segments marked missing in the most recent pass."),
		ReconcileSessionsMarkedStale:   reg.NewGauge("media_agent_reconcile_last_run_sessions_stale", "Sessions marked stale in the most recent pass."),
		ReconcileIntegrityOK:           reg.NewGauge("media_agent_reconcile_integrity_ok", "1 if the most recent database integrity check passed."),
		ReconcileLastRunAgeSeconds:     reg.NewGauge("media_agent_reconcile_last_run_age_seconds", "Seconds since the most recent completed reconciliation pass."),

		DBHealthy: reg.NewGauge("media_agent_db_healthy", "1 if the durable SQLite database responded to a health ping."),

		ProcessUptimeSeconds: reg.NewGauge("media_agent_process_uptime_seconds", "Seconds since this process started."),
		ShuttingDown:         reg.NewGauge("media_agent_shutting_down", "1 once graceful shutdown has begun."),
	}
}
