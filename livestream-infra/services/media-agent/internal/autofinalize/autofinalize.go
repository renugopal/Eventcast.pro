// Package autofinalize implements the Livestream Reliability & Operations
// Package's AutoFinalizer: durable, idempotent, claim-guarded VOD
// finalization driven by the node's own durable state
// (internal/store event_finalization_intents / event_finalization_claims,
// local migration 0007).
//
// Invariant I1: never finalize while a stream/session is still
// legitimately active. Every attempt - background or operator - requires,
// in order: an in-process registry slot for the event, a durable claim
// (ClaimFinalization: no publishable assignment, no open session, and for
// background attempts the quiet period and rollout cutoff), and a
// fail-closed SRS check that no live SRS stream could belong to the event.
// While an attempt runs, on_publish for the event is blocked by BOTH the
// registry entry and the renewed claim lease (PublishBlocked); the
// registry entry is removed only after the VODFinalizer invocation has
// returned, so no new publish can start while old-cycle finalization side
// effects are still running.
package autofinalize

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/metrics"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/telemetry"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/upload"
)

// Finalizer is the VOD finalizer the AutoFinalizer drives
// (*upload.VODFinalizer in production).
type Finalizer interface {
	Finalize(ctx context.Context, eventID string) (upload.FinalizeResult, error)
}

// StreamLister reports the streams SRS currently has live
// (*telemetry.SRSClient in production).
type StreamLister interface {
	FetchStreams(ctx context.Context) ([]telemetry.SRSStream, error)
}

// intentStore is the narrow durable-state surface the Guard uses.
// *store.Store satisfies it unchanged; the indirection exists so tests can
// inject store failures without altering production behavior.
type intentStore interface {
	GetFinalizationIntent(ctx context.Context, eventID string) (store.FinalizationIntent, bool, error)
	CreateFinalizationIntent(ctx context.Context, eventID, cause string, now time.Time) (bool, bool, error)
	ClaimFinalization(ctx context.Context, eventID string, in store.ClaimInput) (store.ClaimResult, error)
	CompleteFinalizationIntent(ctx context.Context, eventID string, cycle int64, token string, out store.IntentOutcome, now time.Time) (bool, error)
	CompleteRecoveryClaim(ctx context.Context, eventID string, cycle int64, token, gen string, now time.Time) (bool, error)
	RenewFinalizationClaim(ctx context.Context, eventID, token string, now time.Time, lease time.Duration) (bool, error)
	ReleaseFinalizationClaim(ctx context.Context, eventID, token string) error
	HasActiveFinalizationClaim(ctx context.Context, eventID string, now time.Time) (bool, error)
	ResolveLiveIngestCandidates(ctx context.Context, ingestID string) ([]string, error)
	ListWindowExpiredCandidates(ctx context.Context, now time.Time, grace time.Duration, cutoff time.Time) ([]string, error)
	ListClaimableIntentEventIDs(ctx context.Context, limit int) ([]string, error)
}

// Registry is the in-process set of events with a finalization attempt
// currently running. It is the authoritative "side effects still in
// flight" signal: an entry exists from before the claim until after the
// VODFinalizer invocation has returned.
type Registry struct {
	mu      sync.Mutex
	running map[string]struct{}
}

// NewRegistry returns an empty Registry.
func NewRegistry() *Registry { return &Registry{running: map[string]struct{}{}} }

func (r *Registry) tryEnter(eventID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, busy := r.running[eventID]; busy {
		return false
	}
	r.running[eventID] = struct{}{}
	return true
}

func (r *Registry) exit(eventID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.running, eventID)
}

// Running reports whether an attempt for eventID is running in this process.
func (r *Registry) Running(eventID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, busy := r.running[eventID]
	return busy
}

// Config configures a Guard.
type Config struct {
	// Enabled gates only the background loop; the operator entry point and
	// the on_publish guard always work.
	Enabled        bool
	Interval       time.Duration
	QuietPeriod    time.Duration
	Grace          time.Duration
	Lease          time.Duration
	RolloutCutoff  time.Time
	RetryBaseDelay time.Duration
	RetryMaxDelay  time.Duration
	BatchSize      int
}

// Guard is the AutoFinalizer plus the shared claim guard used by the
// operator /finalize endpoint and on_publish.
type Guard struct {
	store   intentStore
	fin     Finalizer
	srs     StreamLister
	reg     *Registry
	cfg     Config
	logger  *slog.Logger
	metrics *metrics.Sink
	now     func() time.Time
}

// New returns a Guard. logger must not be nil; sink may be nil.
func New(st *store.Store, fin Finalizer, srs StreamLister, reg *Registry, cfg Config, logger *slog.Logger, sink *metrics.Sink) *Guard {
	return newGuard(st, fin, srs, reg, cfg, logger, sink)
}

func newGuard(st intentStore, fin Finalizer, srs StreamLister, reg *Registry, cfg Config, logger *slog.Logger, sink *metrics.Sink) *Guard {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 16
	}
	return &Guard{store: st, fin: fin, srs: srs, reg: reg, cfg: cfg, logger: logger, metrics: sink, now: time.Now}
}

// RecoverStaleClaims deletes every durable claim. It MUST run once at agent
// startup before SRS callbacks are accepted and before the background loop
// starts: one agent process owns the database, so any surviving claim
// belongs to a dead process whose side effects have already stopped.
func RecoverStaleClaims(ctx context.Context, st *store.Store, logger *slog.Logger, sink *metrics.Sink) error {
	n, err := st.DeleteAllFinalizationClaims(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		logger.Warn("stale finalization claims recovered at startup", slog.Int("count", n))
		if sink != nil {
			sink.AutoFinalizeClaimsRecoveredTotal.Add(int64(n))
		}
	}
	return nil
}

// PublishBlocked implements the on_publish guard: true while an attempt
// for eventID is running in this process, or a durable claim with an
// unexpired lease exists.
func (g *Guard) PublishBlocked(ctx context.Context, eventID string, now time.Time) (bool, error) {
	if g.reg.Running(eventID) {
		return true, nil
	}
	return g.store.HasActiveFinalizationClaim(ctx, eventID, now)
}

// Finalize is the operator /finalize entry point (it satisfies
// upload.Finalizer). It is the ONLY caller that ever sets Operator=true.
func (g *Guard) Finalize(ctx context.Context, eventID string) (upload.FinalizeResult, error) {
	now := g.now().UTC()
	_, pub, err := g.store.CreateFinalizationIntent(ctx, eventID, store.IntentCauseOperator, now)
	if err != nil {
		return upload.FinalizeResult{}, err
	}
	if pub {
		return upload.FinalizeResult{Reason: reasonText(store.SkipPublishable)}, nil
	}
	return g.attempt(ctx, eventID, store.ClaimInput{Now: now, Lease: g.cfg.Lease, Operator: true})
}

// Run executes RunOnce immediately and then every cfg.Interval until ctx is
// cancelled.
func (g *Guard) Run(ctx context.Context) {
	g.RunOnce(ctx)
	ticker := time.NewTicker(g.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			g.RunOnce(ctx)
		}
	}
}

// RunOnce performs one background pass: create window-expired intents,
// then attempt every claimable intent. Background attempts always use
// Operator=false, so they never start a recovery claim, never bypass the
// quiet period or rollout cutoff, and never process pre-cutoff sessions.
func (g *Guard) RunOnce(ctx context.Context) {
	if !g.cfg.Enabled {
		return
	}
	now := g.now().UTC()
	candidates, err := g.store.ListWindowExpiredCandidates(ctx, now, g.cfg.Grace, g.cfg.RolloutCutoff)
	if err != nil {
		g.logger.Error("autofinalize: list window-expired candidates failed", slog.String("error", err.Error()))
	}
	for _, eventID := range candidates {
		if _, _, err := g.store.CreateFinalizationIntent(ctx, eventID, store.IntentCauseWindowExpired, now); err != nil {
			g.logger.Error("autofinalize: create window-expired intent failed",
				slog.String("event_id", eventID), slog.String("error", err.Error()))
		}
	}

	ids, err := g.store.ListClaimableIntentEventIDs(ctx, g.cfg.BatchSize)
	if err != nil {
		g.logger.Error("autofinalize: list claimable intents failed", slog.String("error", err.Error()))
		return
	}
	for _, eventID := range ids {
		if ctx.Err() != nil {
			return
		}
		if _, err := g.attempt(ctx, eventID, store.ClaimInput{
			Now: g.now().UTC(), Lease: g.cfg.Lease, QuietPeriod: g.cfg.QuietPeriod, RolloutCutoff: g.cfg.RolloutCutoff,
		}); err != nil {
			g.logger.Warn("autofinalize: attempt failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
		}
	}
}

// attempt is the single shared attempt routine for background and operator
// requests.
func (g *Guard) attempt(ctx context.Context, eventID string, in store.ClaimInput) (upload.FinalizeResult, error) {
	if !g.reg.tryEnter(eventID) {
		g.skip(store.SkipClaimHeld)
		return upload.FinalizeResult{Reason: reasonText(store.SkipClaimHeld)}, nil
	}
	defer g.reg.exit(eventID) // runs last: only after Finalize has returned

	prior, _, err := g.store.GetFinalizationIntent(ctx, eventID)
	if err != nil {
		return upload.FinalizeResult{}, err
	}
	claim, err := g.store.ClaimFinalization(ctx, eventID, in)
	if err != nil {
		return upload.FinalizeResult{}, err
	}
	if !claim.Claimed {
		g.skip(claim.SkipReason)
		return upload.FinalizeResult{Reason: reasonText(claim.SkipReason)}, nil
	}

	// From here a claim is held: completion (if any) happens before release,
	// and release happens before the registry exit.
	bg := context.WithoutCancel(ctx)
	defer func() {
		if err := g.store.ReleaseFinalizationClaim(bg, eventID, claim.Token); err != nil {
			g.logger.Error("autofinalize: release claim failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
		}
	}()

	// A. SRS fail-closed skip
	if reason := g.srsCheck(ctx, eventID); reason != "" {
		if claim.Recovery {
			g.recovery(reason) // recovery path: no intent write
			return upload.FinalizeResult{Reason: reasonText(reason)}, nil
		}
		applied, err := g.completeNormal(bg, eventID, claim,
			store.IntentOutcome{State: store.IntentPending, SkipReason: reason, UncountAttempt: true})
		if err != nil {
			return upload.FinalizeResult{}, err // do not report a skip that did not persist
		}
		if !applied {
			return supersededResult(), nil
		}
		g.skip(reason)
		return upload.FinalizeResult{Reason: reasonText(reason)}, nil
	}

	result, finErr := g.runWithRenewal(ctx, eventID, claim.Token)

	if claim.Recovery {
		return g.finishRecovery(bg, eventID, claim, prior.FinalizedGeneration, result, finErr)
	}

	switch {
	// B. finalizer error
	case finErr != nil:
		category := errorCategory(finErr)
		_, perr := g.completeNormal(bg, eventID, claim, store.IntentOutcome{
			State:         store.IntentFailed,
			ErrorCategory: category,
			NextAttemptAt: g.now().UTC().Add(backoff(prior.Attempts+1, g.cfg.RetryBaseDelay, g.cfg.RetryMaxDelay)),
		})
		g.attemptMetric("failed")
		if perr != nil {
			// Surface the persistence failure while keeping the original
			// failure's context; both are internal error values, never shown
			// verbatim to a client (the HTTP handler returns a generic 500).
			return upload.FinalizeResult{}, fmt.Errorf(
				"autofinalize: finalizer failed (category=%s) and persisting the failed state also failed: %w",
				category, errors.Join(finErr, perr))
		}
		// applied or cleanly superseded: the finalizer error is still the
		// caller's result either way
		return upload.FinalizeResult{}, finErr

	// C. not eligible
	case !result.Finalized:
		applied, err := g.completeNormal(bg, eventID, claim,
			store.IntentOutcome{State: store.IntentPending, SkipReason: store.SkipNotEligible, UncountAttempt: true})
		if err != nil {
			return upload.FinalizeResult{}, err
		}
		if !applied {
			return supersededResult(), nil
		}
		g.attemptMetric("not_eligible")
		return result, nil

	// D. finalized success
	default:
		applied, err := g.completeNormal(bg, eventID, claim,
			store.IntentOutcome{State: store.IntentFinalized, Generation: result.Generation})
		if err != nil {
			return upload.FinalizeResult{}, err // never report finalized after a DB completion error
		}
		if !applied {
			return supersededResult(), nil // Finalized=false: not the durable finalized state
		}
		g.attemptMetric("finalized")
		return result, nil // Finalized=true only when the transition was applied
	}
}

// completeNormal applies a normal claim's outcome via the token-aware CAS
// and distinguishes three results:
//
//	(true,  nil)  applied - the durable state transition happened
//	(false, nil)  cleanly superseded by a newer cycle (expected; logged and
//	              counted, never an error, never overwrites the new cycle)
//	(false, err)  the store failed - the caller MUST propagate err and MUST
//	              NOT report the attempt's outcome as if it had persisted
func (g *Guard) completeNormal(ctx context.Context, eventID string, claim store.ClaimResult, out store.IntentOutcome) (bool, error) {
	applied, err := g.store.CompleteFinalizationIntent(ctx, eventID, claim.Cycle, claim.Token, out, g.now().UTC())
	if err != nil {
		return false, fmt.Errorf("autofinalize: persist %s outcome for event %s: %w", out.State, eventID, err)
	}
	if !applied {
		g.logger.Info("autofinalize: attempt superseded by a newer cycle; result discarded", slog.String("event_id", eventID))
		g.attemptMetric("superseded")
	}
	return applied, nil
}

// supersededResult is what a caller receives when this attempt's outcome
// was discarded because a newer cycle superseded it. It never claims this
// attempt became the durable finalized state.
func supersededResult() upload.FinalizeResult {
	return upload.FinalizeResult{Reason: "superseded by a newer publish cycle; this attempt's result was discarded"}
}

// finishRecovery handles an operator recovery claim's result. Only a
// successful Finalize result ever writes to the intent (CompleteRecoveryClaim);
// every other outcome leaves the already-finalized intent untouched.
func (g *Guard) finishRecovery(ctx context.Context, eventID string, claim store.ClaimResult, priorGeneration string, result upload.FinalizeResult, finErr error) (upload.FinalizeResult, error) {
	switch {
	case finErr != nil:
		g.recovery("finalizer_error")
		return upload.FinalizeResult{}, finErr
	case !result.Finalized:
		g.recovery("not_eligible")
		return result, nil
	}
	applied, err := g.store.CompleteRecoveryClaim(ctx, eventID, claim.Cycle, claim.Token, result.Generation, g.now().UTC())
	if err != nil {
		return upload.FinalizeResult{}, fmt.Errorf("autofinalize: persist recovery outcome for event %s: %w", eventID, err)
	}
	switch {
	case !applied:
		g.logger.Info("autofinalize: recovery superseded by a newer cycle; result discarded", slog.String("event_id", eventID))
		g.recovery("superseded")
		return supersededResult(), nil
	case result.Generation != "" && result.Generation != priorGeneration:
		g.recovery("new_generation")
	default:
		g.recovery("unchanged")
	}
	return result, nil
}

// srsCheck returns "" only when SRS proves no live stream could belong to
// eventID. Every uncertainty fails closed: SRS unreachable or a resolution
// error -> srs_unavailable; a live stream no event can be attributed to ->
// srs_attribution_unknown; the event among a live stream's candidates ->
// srs_ingest_active.
func (g *Guard) srsCheck(ctx context.Context, eventID string) string {
	streams, err := g.srs.FetchStreams(ctx)
	if err != nil {
		return store.SkipSRSUnavailable
	}
	for _, s := range streams {
		candidates, err := g.store.ResolveLiveIngestCandidates(ctx, s.Name)
		if err != nil {
			return store.SkipSRSUnavailable
		}
		if len(candidates) == 0 {
			return store.SkipSRSAttributionUnknown
		}
		if slices.Contains(candidates, eventID) {
			return store.SkipSRSIngestActive
		}
	}
	return ""
}

// runWithRenewal runs Finalize while renewing the claim lease every
// Lease/3. A failed renewal cancels the finalize context; the claim and
// registry entry still stand until Finalize has actually returned.
func (g *Guard) runWithRenewal(ctx context.Context, eventID, token string) (upload.FinalizeResult, error) {
	finCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		interval := g.cfg.Lease / 3
		if interval <= 0 {
			interval = time.Second
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				ok, err := g.store.RenewFinalizationClaim(context.WithoutCancel(ctx), eventID, token, g.now().UTC(), g.cfg.Lease)
				if err != nil || !ok {
					g.logger.Error("autofinalize: claim renewal failed; cancelling finalize", slog.String("event_id", eventID))
					if g.metrics != nil {
						g.metrics.AutoFinalizeRenewalFailuresTotal.Inc()
					}
					cancel()
					return
				}
			}
		}
	}()

	result, err := g.fin.Finalize(finCtx, eventID)
	close(stop)
	<-done
	return result, err
}

func (g *Guard) skip(reason string) {
	if g.metrics != nil && reason != "" {
		g.metrics.AutoFinalizeSkipsTotal.Inc(metrics.Label{Name: "reason", Value: reason})
	}
}

func (g *Guard) attemptMetric(result string) {
	if g.metrics != nil {
		g.metrics.AutoFinalizeAttemptsTotal.Inc(metrics.Label{Name: "result", Value: result})
	}
}

func (g *Guard) recovery(result string) {
	switch result {
	case store.SkipSRSIngestActive:
		result = "srs_active"
	case store.SkipSRSUnavailable:
		result = "srs_unavailable"
	case store.SkipSRSAttributionUnknown:
		result = "srs_attribution_unknown"
	}
	g.logger.Info("autofinalize: recovery outcome", slog.String("result", result))
	if g.metrics != nil {
		g.metrics.AutoFinalizeRecoveryTotal.Inc(metrics.Label{Name: "result", Value: result})
	}
}

// errorCategory maps a finalizer error onto a fixed, secret-free category.
func errorCategory(err error) string {
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return "cancelled"
	case errors.Is(err, upload.ErrObjectMismatch):
		return "object_mismatch"
	default:
		return "finalizer_error"
	}
}

// backoff grows exponentially from base, bounded by max.
func backoff(attempt int, base, max time.Duration) time.Duration {
	if base <= 0 {
		base = 30 * time.Second
	}
	d := base
	for i := 1; i < attempt && (max <= 0 || d < max); i++ {
		d *= 2
	}
	if max > 0 && d > max {
		d = max
	}
	return d
}

// reasonText is the fixed, secret-free operator-facing text for a skip.
func reasonText(reason string) string {
	switch reason {
	case store.SkipPublishable:
		return "an assignment for this event is still publishable; end the stream first"
	case store.SkipSessionOpen:
		return "a session is still starting or active for this event"
	case store.SkipClaimHeld:
		return "a finalization is already running for this event"
	case store.SkipNoSession:
		return "no session has ever been recorded for this event"
	case store.SkipQuietPeriod:
		return "waiting for the post-disconnect quiet period"
	case store.SkipPreRolloutSession:
		return "event predates AutoFinalizer rollout; operator finalization required"
	case store.SkipBackoff:
		return "previous attempt failed; waiting for retry backoff"
	case store.SkipNoIntent:
		return "no finalization is pending for this event"
	case store.SkipSRSIngestActive:
		return "SRS still reports a live stream for this event"
	case store.SkipSRSUnavailable:
		return "SRS could not be checked; finalization skipped (fail closed)"
	case store.SkipSRSAttributionUnknown:
		return "SRS reports a live stream that cannot be attributed; finalization skipped (fail closed)"
	case store.SkipNotEligible:
		return "the finalizer reported the event not yet eligible"
	default:
		return fmt.Sprintf("finalization skipped (%s)", reason)
	}
}
