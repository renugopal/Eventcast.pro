package controlplane

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand"
	"sync/atomic"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// SyncerConfig bounds the periodic assignment sync workflow.
type SyncerConfig struct {
	// NodeID identifies this node to the control plane.
	NodeID string
	// RequestTimeout bounds each individual fetch attempt.
	RequestTimeout time.Duration
	// SyncInterval is the steady-state period between successful syncs.
	SyncInterval time.Duration
	// BackoffBase and BackoffMax bound retry delay after a failed sync,
	// using the same exponential-backoff-with-full-jitter shape as
	// internal/upload's upload retry (backoffDelay) and internal/relay's
	// restart policy (restartBackoff): consecutive failures back off
	// exponentially up to BackoffMax, with the actual delay drawn
	// uniformly from [0, cap] so many nodes failing at once do not
	// resynchronize their retries into a self-inflicted request storm.
	BackoffBase time.Duration
	BackoffMax  time.Duration
	// StaleWarnAfter and StaleCriticalAfter classify Status().Stale and
	// Status().CriticallyStale, matching this milestone's documented
	// alert thresholds (docs/operations "stale assignment cache").
	// StaleCriticalAfter also gates the readiness check
	// (cmd/media-agent/main.go): the agent keeps operating on its last
	// known good cache throughout (02_V1_ARCHITECTURE_SPEC.md /
	// 03_DATA_MODEL_AND_API_CONTRACTS.md "Assignment synchronization"),
	// but a critically stale cache is surfaced as not-ready so an
	// orchestrator can stop routing new work to this node.
	StaleWarnAfter     time.Duration
	StaleCriticalAfter time.Duration
}

// Syncer runs the Media Agent's continuous control-plane assignment
// synchronization workflow: startup sync, periodic refresh, exponential
// backoff with jitter on failure, last-known-good operation across
// outages, and a durable, readable sync-health record
// (internal/store.ControlPlaneSyncState).
type Syncer struct {
	store    *store.Store
	client   Client
	keyCache *StreamKeyCache
	cfg      SyncerConfig
	logger   *slog.Logger

	consecutiveFailures atomic.Int64
}

// NewSyncer returns a Syncer. keyCache may be nil if YouTube relay is not
// in use; logger must not be nil.
func NewSyncer(st *store.Store, client Client, keyCache *StreamKeyCache, cfg SyncerConfig, logger *slog.Logger) *Syncer {
	return &Syncer{store: st, client: client, keyCache: keyCache, cfg: cfg, logger: logger}
}

// SyncOnce performs exactly one fetch-and-apply cycle, bounded by
// cfg.RequestTimeout regardless of ctx's own deadline. It always records
// the attempt outcome durably (RecordControlPlaneSyncAttempt plus either
// RecordControlPlaneSyncSuccess or RecordControlPlaneSyncFailure) before
// returning, so Status() and the readiness/metrics surface never observe
// a sync that neither succeeded nor left an error behind. A returned
// error means the durable assignment cache was left completely
// unchanged: callers must treat this as "continue operating on the
// existing cache," never as a reason to reject already-valid publishers.
func (s *Syncer) SyncOnce(ctx context.Context) error {
	now := time.Now().UTC()
	if err := s.store.RecordControlPlaneSyncAttempt(ctx, now); err != nil {
		s.logger.Error("controlplane: record sync attempt failed", slog.String("error", err.Error()))
	}

	fetchCtx, cancel := context.WithTimeout(ctx, s.cfg.RequestTimeout)
	defer cancel()

	resp, err := s.client.FetchAssignments(fetchCtx, s.cfg.NodeID)
	if err != nil {
		s.consecutiveFailures.Add(1)
		sanitized := sanitizeSyncError(err)
		if recErr := s.store.RecordControlPlaneSyncFailure(ctx, sanitized, time.Now().UTC()); recErr != nil {
			s.logger.Error("controlplane: record sync failure failed", slog.String("error", recErr.Error()))
		}
		return fmt.Errorf("controlplane: fetch assignments: %w", err)
	}

	applied, revoked, err := s.store.ApplyControlPlaneAssignments(ctx, resp.Assignments, time.Now().UTC())
	if err != nil {
		s.consecutiveFailures.Add(1)
		sanitized := sanitizeSyncError(err)
		if recErr := s.store.RecordControlPlaneSyncFailure(ctx, sanitized, time.Now().UTC()); recErr != nil {
			s.logger.Error("controlplane: record sync failure failed", slog.String("error", recErr.Error()))
		}
		return fmt.Errorf("controlplane: apply assignments: %w", err)
	}

	if s.keyCache != nil {
		keys := make(map[string]logging.Secret, len(resp.Assignments))
		for _, a := range resp.Assignments {
			if a.YouTubeEnabled {
				keys[a.EventID] = a.YouTubeStreamKey
			}
		}
		s.keyCache.Replace(keys)
	}

	if err := s.store.RecordControlPlaneSyncSuccess(ctx, resp.ConfigVersion, time.Now().UTC()); err != nil {
		s.logger.Error("controlplane: record sync success failed", slog.String("error", err.Error()))
	}
	s.consecutiveFailures.Store(0)

	s.logger.Info("control-plane assignment sync succeeded",
		slog.Int("applied", applied), slog.Int("revoked", revoked), slog.String("config_version", resp.ConfigVersion))
	return nil
}

// Run blocks until ctx is cancelled, calling SyncOnce on cfg.SyncInterval
// while healthy and backing off exponentially with full jitter (bounded
// by cfg.BackoffMax) after each consecutive failure. It never returns an
// error: every failure is logged and durably recorded by SyncOnce, and
// the loop always continues retrying, since a node that gives up
// resyncing forever would eventually serve only an unrecoverably stale
// cache. Callers should invoke an initial SyncOnce themselves before
// calling Run, if a best-effort startup sync is desired (see
// cmd/media-agent/main.go); Run's own first iteration also begins with a
// sync, so this is an optional latency optimization, not a correctness
// requirement.
func (s *Syncer) Run(ctx context.Context) {
	delay := s.cfg.SyncInterval
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}

		if err := s.SyncOnce(ctx); err != nil {
			s.logger.Warn("control-plane assignment sync failed; continuing on last known good cache",
				slog.String("error", err.Error()), slog.Int64("consecutive_failures", s.consecutiveFailures.Load()))
			delay = syncBackoffDelay(int(s.consecutiveFailures.Load()), s.cfg.BackoffBase, s.cfg.BackoffMax)
			continue
		}
		delay = s.cfg.SyncInterval
	}
}

// Status is the point-in-time control-plane sync health snapshot read by
// readiness checks and metrics (cmd/media-agent/main.go).
type Status struct {
	Enabled             bool
	LastAttemptAt       time.Time
	LastSuccessAt       time.Time
	LastError           string
	ConsecutiveFailures int
	ConfigVersion       string
	Stale               bool
	CriticallyStale     bool
}

// Status returns the current sync health snapshot from durable state.
func (s *Syncer) Status(ctx context.Context) (Status, error) {
	st, err := s.store.GetControlPlaneSyncState(ctx)
	if err != nil {
		return Status{}, err
	}
	now := time.Now().UTC()
	result := Status{
		Enabled:             true,
		LastAttemptAt:       st.LastAttemptAt,
		LastSuccessAt:       st.LastSuccessAt,
		LastError:           st.LastError,
		ConsecutiveFailures: st.ConsecutiveFailures,
		ConfigVersion:       st.ConfigVersion,
	}
	if st.LastSuccessAt.IsZero() {
		// Never successfully synced: treat as stale/critically-stale only
		// if the sync workflow has actually had a chance to run and fail
		// (last_attempt_at set); a node that has not attempted a sync yet
		// (e.g. still within its first RequestTimeout) is not yet stale.
		result.Stale = !st.LastAttemptAt.IsZero()
		result.CriticallyStale = !st.LastAttemptAt.IsZero() && now.Sub(st.LastAttemptAt) > s.cfg.StaleCriticalAfter
		return result, nil
	}
	age := now.Sub(st.LastSuccessAt)
	result.Stale = age > s.cfg.StaleWarnAfter
	result.CriticallyStale = age > s.cfg.StaleCriticalAfter
	return result, nil
}

// syncBackoffDelay mirrors internal/upload.backoffDelay and
// internal/relay.restartBackoff: exponential backoff with full jitter,
// bounded by maxDelay.
func syncBackoffDelay(attempt int, base, maxDelay time.Duration) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	capDelay := base
	for i := 1; i < attempt && capDelay < maxDelay; i++ {
		capDelay *= 2
		if capDelay > maxDelay {
			capDelay = maxDelay
			break
		}
	}
	if capDelay > maxDelay {
		capDelay = maxDelay
	}
	if capDelay <= 0 {
		return 0
	}
	return time.Duration(rand.Int63n(int64(capDelay) + 1))
}

// sanitizeSyncError returns a message safe to persist and log: it must
// never contain an Authorization header, bearer token, or signed URL. The
// underlying errors here originate from net/http (transport/status
// errors) and encoding/json (parse errors), neither of which include
// request headers in their Error() strings, but this is an explicit,
// documented boundary rather than an incidental property.
func sanitizeSyncError(err error) string {
	return err.Error()
}
