package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"time"
)

// Finalization intent states and causes (migrations/0007_event_finalization_intents.sql).
const (
	IntentPending    = "pending"
	IntentFinalizing = "finalizing"
	IntentFinalized  = "finalized"
	IntentFailed     = "failed"
	IntentCancelled  = "cancelled"

	IntentCauseRevoked       = "revoked"
	IntentCauseWindowExpired = "window_expired"
	IntentCauseOperator      = "operator"
)

// Claim skip reasons. Fixed, secret-free vocabulary: persisted in
// last_skip_reason, surfaced to operators, and used as metric label values.
const (
	SkipNoIntent          = "no_claimable_intent"
	SkipBackoff           = "retry_backoff"
	SkipClaimHeld         = "claim_held"
	SkipPublishable       = "assignment_publishable"
	SkipSessionOpen       = "session_open"
	SkipNoSession         = "no_session"
	SkipQuietPeriod       = "quiet_period"
	SkipPreRolloutSession = "pre_rollout_session"
	SkipSRSIngestActive   = "srs_ingest_active"
	SkipSRSUnavailable    = "srs_unavailable"
	// SkipSRSAttributionUnknown: SRS reports a live stream this node cannot
	// attribute to any event, so it cannot be proven unrelated (fail closed).
	SkipSRSAttributionUnknown = "srs_attribution_unknown"
	SkipNotEligible           = "finalizer_not_eligible"
)

// FinalizationIntent is one event's durable AutoFinalizer intent row.
type FinalizationIntent struct {
	EventID             string
	State               string
	Cause               string
	Cycle               int64
	IntentAt            time.Time
	Attempts            int
	LastAttemptAt       time.Time
	NextAttemptAt       time.Time
	LastErrorCategory   string
	LastSkipReason      string
	FinalizedGeneration string
	FinalizedAt         time.Time
	UpdatedAt           time.Time
}

// FinalizationClaim is the durable record of a VODFinalizer invocation
// currently running for an event.
type FinalizationClaim struct {
	EventID    string
	Cycle      int64
	Token      string
	LeaseUntil time.Time
	StartedAt  time.Time
	RenewedAt  time.Time
}

// dbtx is the subset of *sql.DB / *sql.Tx the finalization helpers need, so
// the same logic runs standalone or inside ApplyControlPlaneAssignments'
// transaction.
type dbtx interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func fmtTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

// Publishable is the single publishability predicate shared with
// on_publish (internal/srs.handlePublish): enabled AND start <= now <= end.
// The expiry grace period never extends publishability.
func Publishable(enabled bool, start, end, now time.Time) bool {
	return enabled && !now.Before(start) && !now.After(end)
}

type assignmentWindow struct {
	enabled    bool
	start, end time.Time
}

// assignmentWindows loads every cached assignment window for eventID.
// Windows are compared in Go, never as SQL strings: RFC3339Nano values are
// variable-length and do not sort lexically.
func assignmentWindows(ctx context.Context, q dbtx, eventID string) ([]assignmentWindow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT enabled, publish_window_start_at, publish_window_end_at
		FROM cached_event_assignments WHERE event_id = ?`, eventID)
	if err != nil {
		return nil, fmt.Errorf("store: list assignment windows for %s: %w", eventID, err)
	}
	defer rows.Close()
	var out []assignmentWindow
	for rows.Next() {
		var w assignmentWindow
		var startStr, endStr string
		if err := rows.Scan(&w.enabled, &startStr, &endStr); err != nil {
			return nil, fmt.Errorf("store: scan assignment window: %w", err)
		}
		if w.start, err = time.Parse(time.RFC3339Nano, startStr); err != nil {
			return nil, fmt.Errorf("store: parse publish_window_start_at: %w", err)
		}
		if w.end, err = time.Parse(time.RFC3339Nano, endStr); err != nil {
			return nil, fmt.Errorf("store: parse publish_window_end_at: %w", err)
		}
		out = append(out, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate assignment windows: %w", err)
	}
	return out, nil
}

func eventPublishable(ctx context.Context, q dbtx, eventID string, now time.Time) (bool, error) {
	windows, err := assignmentWindows(ctx, q, eventID)
	if err != nil {
		return false, err
	}
	for _, w := range windows {
		if Publishable(w.enabled, w.start, w.end, now) {
			return true, nil
		}
	}
	return false, nil
}

// ResolveLiveIngestCandidates returns every event that could legitimately
// own a live SRS stream named ingestID, conservatively (fail-closed):
//   - open sessions exist: all open-session event ids + current cached-assignment owner
//   - no open session:     current cached-assignment owner + most recent historical session owner
//
// The result is de-duplicated and sorted, from one consistent SQLite
// snapshot. An empty result means no event can be attributed; a caller
// scanning a LIVE stream must treat that as unknown attribution and fail
// closed. Any error must also be treated as "cannot prove not-live".
func (s *Store) ResolveLiveIngestCandidates(ctx context.Context, ingestID string) ([]string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("store: begin resolve ingest candidates: %w", err)
	}
	defer tx.Rollback()

	set := map[string]struct{}{}
	rows, err := tx.QueryContext(ctx,
		`SELECT event_id, status, started_at FROM ingest_sessions WHERE ingest_id = ?`, ingestID)
	if err != nil {
		return nil, fmt.Errorf("store: list sessions for ingest %s: %w", ingestID, err)
	}
	open := false
	var recentEvent string
	var recentStart time.Time
	for rows.Next() {
		var eventID, status, startedStr string
		if err := rows.Scan(&eventID, &status, &startedStr); err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: scan session for ingest %s: %w", ingestID, err)
		}
		started, err := time.Parse(time.RFC3339Nano, startedStr)
		if err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: parse started_at for ingest %s: %w", ingestID, err)
		}
		if status == SessionStarting || status == SessionActive {
			open = true
			set[eventID] = struct{}{}
		}
		if recentEvent == "" || started.After(recentStart) {
			recentEvent, recentStart = eventID, started
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("store: iterate sessions for ingest %s: %w", ingestID, err)
	}
	rows.Close()

	var cachedOwner string
	switch err := tx.QueryRowContext(ctx,
		`SELECT event_id FROM cached_event_assignments WHERE ingest_id = ?`, ingestID).Scan(&cachedOwner); {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return nil, fmt.Errorf("store: read cached owner for ingest %s: %w", ingestID, err)
	default:
		set[cachedOwner] = struct{}{}
	}
	if !open && recentEvent != "" {
		set[recentEvent] = struct{}{}
	}

	out := make([]string, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, nil
}

// EventPublishable reports whether any cached assignment for eventID is
// publishable at now.
func (s *Store) EventPublishable(ctx context.Context, eventID string, now time.Time) (bool, error) {
	return eventPublishable(ctx, s.db, eventID, now)
}

// reactivateIntentTx implements rule R1: a newly publishable event's
// pending, failed, finalizing, or finalized intent becomes 'cancelled' at
// cycle+1 with every retry/backoff/skip/generation field cleared. A
// 'cancelled' row is left untouched (idempotent across repeated syncs).
// Claims are never touched here - a running attempt keeps its
// publish-blocking claim until its finalizer has returned.
func reactivateIntentTx(ctx context.Context, q dbtx, eventID string, now time.Time) (bool, error) {
	res, err := q.ExecContext(ctx, `
		UPDATE event_finalization_intents
		SET state = ?, cycle = cycle + 1, attempts = 0, next_attempt_at = '',
		    last_error_category = '', last_skip_reason = '',
		    finalized_generation = '', finalized_at = '', updated_at = ?
		WHERE event_id = ? AND state IN (?, ?, ?, ?)`,
		IntentCancelled, fmtTime(now), eventID,
		IntentPending, IntentFailed, IntentFinalizing, IntentFinalized)
	if err != nil {
		return false, fmt.Errorf("store: reactivate intent %s: %w", eventID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: reactivate intent %s: rows affected: %w", eventID, err)
	}
	return n > 0, nil
}

// createIntentTx implements rule R2 for an event already known not to be
// publishable: insert a pending intent at cycle 0, or re-open a cancelled
// one as pending (same, already-bumped cycle, every per-attempt field
// cleared). pending/failed/finalizing/finalized rows are left untouched.
func createIntentTx(ctx context.Context, q dbtx, eventID, cause string, now time.Time) (bool, error) {
	nowStr := fmtTime(now)
	var state string
	err := q.QueryRowContext(ctx, `SELECT state FROM event_finalization_intents WHERE event_id = ?`, eventID).Scan(&state)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if _, err := q.ExecContext(ctx, `
			INSERT INTO event_finalization_intents (event_id, state, cause, cycle, intent_at, updated_at)
			VALUES (?, ?, ?, 0, ?, ?)`, eventID, IntentPending, cause, nowStr, nowStr); err != nil {
			return false, fmt.Errorf("store: insert intent %s: %w", eventID, err)
		}
		return true, nil
	case err != nil:
		return false, fmt.Errorf("store: read intent %s: %w", eventID, err)
	case state != IntentCancelled:
		return false, nil
	}
	res, err := q.ExecContext(ctx, `
		UPDATE event_finalization_intents
		SET state = ?, cause = ?, intent_at = ?, attempts = 0, last_attempt_at = '', next_attempt_at = '',
		    last_error_category = '', last_skip_reason = '', finalized_generation = '', finalized_at = '',
		    updated_at = ?
		WHERE event_id = ? AND state = ?`,
		IntentPending, cause, nowStr, nowStr, eventID, IntentCancelled)
	if err != nil {
		return false, fmt.Errorf("store: reopen intent %s: %w", eventID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: reopen intent %s: rows affected: %w", eventID, err)
	}
	return n > 0, nil
}

// CreateFinalizationIntent creates (or re-opens) an intent for eventID
// under rule R2, but only if no cached assignment is publishable at now.
// publishableNow=true means nothing was written.
func (s *Store) CreateFinalizationIntent(ctx context.Context, eventID, cause string, now time.Time) (created, publishableNow bool, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, false, fmt.Errorf("store: begin create intent: %w", err)
	}
	defer tx.Rollback()
	pub, err := eventPublishable(ctx, tx, eventID, now)
	if err != nil {
		return false, false, err
	}
	if pub {
		return false, true, nil
	}
	created, err = createIntentTx(ctx, tx, eventID, cause, now)
	if err != nil {
		return false, false, err
	}
	if err := tx.Commit(); err != nil {
		return false, false, fmt.Errorf("store: commit create intent: %w", err)
	}
	return created, false, nil
}

// GetFinalizationIntent returns eventID's intent row, or found=false.
func (s *Store) GetFinalizationIntent(ctx context.Context, eventID string) (FinalizationIntent, bool, error) {
	var in FinalizationIntent
	var intentAt, lastAttempt, nextAttempt, finalizedAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT event_id, state, cause, cycle, intent_at, attempts, last_attempt_at, next_attempt_at,
		       last_error_category, last_skip_reason, finalized_generation, finalized_at, updated_at
		FROM event_finalization_intents WHERE event_id = ?`, eventID,
	).Scan(&in.EventID, &in.State, &in.Cause, &in.Cycle, &intentAt, &in.Attempts, &lastAttempt, &nextAttempt,
		&in.LastErrorCategory, &in.LastSkipReason, &in.FinalizedGeneration, &finalizedAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FinalizationIntent{}, false, nil
	}
	if err != nil {
		return FinalizationIntent{}, false, fmt.Errorf("store: get intent %s: %w", eventID, err)
	}
	for _, f := range []struct {
		dst *time.Time
		src string
	}{{&in.IntentAt, intentAt}, {&in.LastAttemptAt, lastAttempt}, {&in.NextAttemptAt, nextAttempt}, {&in.FinalizedAt, finalizedAt}, {&in.UpdatedAt, updatedAt}} {
		t, err := parseOptionalTime(f.src)
		if err != nil {
			return FinalizationIntent{}, false, fmt.Errorf("store: parse intent time: %w", err)
		}
		*f.dst = t
	}
	return in, true, nil
}

// CountFinalizationIntentsByState returns the intent count per state, for
// metrics.
func (s *Store) CountFinalizationIntentsByState(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT state, COUNT(*) FROM event_finalization_intents GROUP BY state`)
	if err != nil {
		return nil, fmt.Errorf("store: count intents: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, fmt.Errorf("store: scan intent count: %w", err)
		}
		out[st] = n
	}
	return out, rows.Err()
}

// ListClaimableIntentEventIDs returns event ids whose intent is in a state
// that may become claimable (pending, failed, finalizing). Final
// eligibility is decided inside ClaimFinalization's transaction.
func (s *Store) ListClaimableIntentEventIDs(ctx context.Context, limit int) ([]string, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("store: list claimable intents: limit must be positive, got %d", limit)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT event_id FROM event_finalization_intents WHERE state IN (?, ?, ?)
		ORDER BY updated_at ASC LIMIT ?`, IntentPending, IntentFailed, IntentFinalizing, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list claimable intents: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("store: scan claimable intent: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ListWindowExpiredCandidates returns events that should receive a
// window_expired intent: no intent or only a cancelled one, no open
// session, a newest session disconnect at or after cutoff, every cached
// assignment non-publishable, and the latest publish_window_end_at + grace
// already past. Creation itself re-checks publishability (R2).
func (s *Store) ListWindowExpiredCandidates(ctx context.Context, now time.Time, grace time.Duration, cutoff time.Time) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT s.event_id
		FROM ingest_sessions s
		LEFT JOIN event_finalization_intents i ON i.event_id = s.event_id
		WHERE s.disconnected_at IS NOT NULL AND (i.event_id IS NULL OR i.state = ?)`, IntentCancelled)
	if err != nil {
		return nil, fmt.Errorf("store: list window-expired candidates: %w", err)
	}
	var eventIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: scan window-expired candidate: %w", err)
		}
		eventIDs = append(eventIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("store: iterate window-expired candidates: %w", err)
	}
	rows.Close()

	var out []string
	for _, id := range eventIDs {
		ok, err := s.windowExpired(ctx, id, now, grace, cutoff)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, id)
		}
	}
	return out, nil
}

func (s *Store) windowExpired(ctx context.Context, eventID string, now time.Time, grace time.Duration, cutoff time.Time) (bool, error) {
	sessions, err := s.ListSessionsByEvent(ctx, eventID)
	if err != nil {
		return false, err
	}
	var newestDisconnect time.Time
	for _, sess := range sessions {
		if sess.Status == SessionStarting || sess.Status == SessionActive {
			return false, nil
		}
		if sess.DisconnectedAt.Valid && sess.DisconnectedAt.Time.After(newestDisconnect) {
			newestDisconnect = sess.DisconnectedAt.Time
		}
	}
	if newestDisconnect.IsZero() || (!cutoff.IsZero() && newestDisconnect.Before(cutoff)) {
		return false, nil
	}
	windows, err := assignmentWindows(ctx, s.db, eventID)
	if err != nil {
		return false, err
	}
	if len(windows) == 0 {
		return false, nil
	}
	var latestEnd time.Time
	for _, w := range windows {
		if Publishable(w.enabled, w.start, w.end, now) {
			return false, nil
		}
		if w.end.After(latestEnd) {
			latestEnd = w.end
		}
	}
	return now.After(latestEnd.Add(grace)), nil
}

// ClaimInput parameterizes ClaimFinalization.
type ClaimInput struct {
	Now           time.Time
	Lease         time.Duration
	QuietPeriod   time.Duration
	RolloutCutoff time.Time
	// Operator marks an explicit, operator-token-authenticated /finalize
	// request. It may bypass ONLY the rollout cutoff, the quiet period, and
	// a failed intent's backoff (for this one claim), and may claim a
	// 'finalized' intent as a recovery claim. It NEVER bypasses the
	// publishable, open-session, or claim-held checks (nor, in the caller,
	// the in-process registry or SRS checks). The background AutoFinalizer
	// always passes Operator=false.
	Operator bool
}

// ClaimResult reports a ClaimFinalization outcome. SkipReason is one of
// the Skip* constants when Claimed is false.
type ClaimResult struct {
	Claimed    bool
	Cycle      int64
	Token      string
	SkipReason string
	// Recovery is true for an operator claim that started from
	// IntentFinalized: the claim row was inserted but the intent itself was
	// NOT modified, and the attempt must complete via CompleteRecoveryClaim
	// (success only) - never CompleteFinalizationIntent.
	Recovery bool
}

// ClaimFinalization is rule R3's claim step: in one transaction it
// verifies every durable eligibility condition and, only if all hold,
// inserts the claim row and moves the intent to 'finalizing' (clearing any
// stale error/backoff/skip metadata). The caller must already have
// confirmed no in-process attempt is running for the event (the registry),
// since an expired claim row alone is deleted here.
func (s *Store) ClaimFinalization(ctx context.Context, eventID string, in ClaimInput) (ClaimResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ClaimResult{}, fmt.Errorf("store: begin claim: %w", err)
	}
	defer tx.Rollback()
	now := in.Now.UTC()

	var state, nextAttemptStr string
	var cycle int64
	err = tx.QueryRowContext(ctx, `SELECT state, cycle, next_attempt_at FROM event_finalization_intents WHERE event_id = ?`, eventID).
		Scan(&state, &cycle, &nextAttemptStr)
	if errors.Is(err, sql.ErrNoRows) {
		return ClaimResult{SkipReason: SkipNoIntent}, nil
	}
	if err != nil {
		return ClaimResult{}, fmt.Errorf("store: read intent for claim %s: %w", eventID, err)
	}
	recovery := false
	switch {
	case state == IntentPending, state == IntentFinalizing:
		// claimable for both callers (finalizing only proceeds with an
		// absent/expired claim - checked below)
	case state == IntentFinalized && in.Operator:
		// operator-only recovery claim (idempotent re-finalize / B2 enqueue
		// recovery); the intent is left untouched at claim time
		recovery = true
	case state == IntentFailed:
		nextAttempt, err := parseOptionalTime(nextAttemptStr)
		if err != nil {
			return ClaimResult{}, fmt.Errorf("store: parse next_attempt_at: %w", err)
		}
		if now.Before(nextAttempt) && !in.Operator {
			return ClaimResult{SkipReason: SkipBackoff}, nil
		}
		// operator: one explicit attempt now; next_attempt_at is only ever
		// rewritten by this attempt's own outcome, via normal backoff
	default:
		return ClaimResult{SkipReason: SkipNoIntent}, nil
	}

	var leaseStr string
	err = tx.QueryRowContext(ctx, `SELECT lease_until FROM event_finalization_claims WHERE event_id = ?`, eventID).Scan(&leaseStr)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return ClaimResult{}, fmt.Errorf("store: read claim %s: %w", eventID, err)
	default:
		lease, err := time.Parse(time.RFC3339Nano, leaseStr)
		if err != nil {
			return ClaimResult{}, fmt.Errorf("store: parse lease_until: %w", err)
		}
		if now.Before(lease) {
			return ClaimResult{SkipReason: SkipClaimHeld}, nil
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM event_finalization_claims WHERE event_id = ?`, eventID); err != nil {
			return ClaimResult{}, fmt.Errorf("store: delete expired claim %s: %w", eventID, err)
		}
	}

	skip := func(reason string) (ClaimResult, error) {
		if _, err := tx.ExecContext(ctx, `
			UPDATE event_finalization_intents SET last_skip_reason = ?, updated_at = ?
			WHERE event_id = ? AND state IN (?, ?)`, reason, fmtTime(now), eventID, IntentPending, IntentFailed); err != nil {
			return ClaimResult{}, fmt.Errorf("store: record skip for %s: %w", eventID, err)
		}
		if err := tx.Commit(); err != nil {
			return ClaimResult{}, fmt.Errorf("store: commit skip: %w", err)
		}
		return ClaimResult{SkipReason: reason}, nil
	}

	pub, err := eventPublishable(ctx, tx, eventID, now)
	if err != nil {
		return ClaimResult{}, err
	}
	if pub {
		return skip(SkipPublishable)
	}

	rows, err := tx.QueryContext(ctx, `SELECT status, disconnected_at FROM ingest_sessions WHERE event_id = ?`, eventID)
	if err != nil {
		return ClaimResult{}, fmt.Errorf("store: list sessions for claim %s: %w", eventID, err)
	}
	var newestDisconnect time.Time
	open, sessions := false, 0
	for rows.Next() {
		var status string
		var disconnected sql.NullString
		if err := rows.Scan(&status, &disconnected); err != nil {
			rows.Close()
			return ClaimResult{}, fmt.Errorf("store: scan session for claim: %w", err)
		}
		sessions++
		if status == SessionStarting || status == SessionActive {
			open = true
		}
		if disconnected.Valid && disconnected.String != "" {
			t, err := time.Parse(time.RFC3339Nano, disconnected.String)
			if err != nil {
				rows.Close()
				return ClaimResult{}, fmt.Errorf("store: parse disconnected_at: %w", err)
			}
			if t.After(newestDisconnect) {
				newestDisconnect = t
			}
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return ClaimResult{}, fmt.Errorf("store: iterate sessions for claim: %w", err)
	}
	rows.Close()
	switch {
	case open:
		return skip(SkipSessionOpen)
	case sessions == 0 || newestDisconnect.IsZero():
		return skip(SkipNoSession)
	case !in.Operator && !in.RolloutCutoff.IsZero() && newestDisconnect.Before(in.RolloutCutoff):
		return skip(SkipPreRolloutSession)
	case !in.Operator && now.Before(newestDisconnect.Add(in.QuietPeriod)):
		return skip(SkipQuietPeriod)
	}

	token, err := newID("claim")
	if err != nil {
		return ClaimResult{}, err
	}
	nowStr := fmtTime(now)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO event_finalization_claims (event_id, cycle, claim_token, lease_until, started_at, renewed_at)
		VALUES (?, ?, ?, ?, ?, ?)`, eventID, cycle, token, fmtTime(now.Add(in.Lease)), nowStr, nowStr); err != nil {
		return ClaimResult{}, fmt.Errorf("store: insert claim %s: %w", eventID, err)
	}
	if !recovery {
		if _, err := tx.ExecContext(ctx, `
			UPDATE event_finalization_intents
			SET state = ?, attempts = attempts + 1, last_attempt_at = ?,
			    last_error_category = '', next_attempt_at = '', last_skip_reason = '', updated_at = ?
			WHERE event_id = ? AND cycle = ?`, IntentFinalizing, nowStr, nowStr, eventID, cycle); err != nil {
			return ClaimResult{}, fmt.Errorf("store: mark intent finalizing %s: %w", eventID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return ClaimResult{}, fmt.Errorf("store: commit claim: %w", err)
	}
	return ClaimResult{Claimed: true, Cycle: cycle, Token: token, Recovery: recovery}, nil
}

// CompleteRecoveryClaim records the outcome of a SUCCESSFUL operator
// recovery re-finalize of an already-finalized intent. It must be called
// only after a successful recovery Finalize result - failed, skipped, and
// not-eligible recovery attempts write nothing to the intent, so a prior
// success can never be downgraded.
//
// The compare-and-set requires the intent still to be 'finalized' at this
// cycle AND the caller to still hold this exact claim token. A reactivation
// during the attempt (R1: finalized -> cancelled at cycle+1) therefore makes
// this return applied=false; it can never write finalized state back over
// the new cycle.
//
//   - newGeneration empty or equal to the current finalized_generation: no
//     column changes (applied reports the intent is still the one this
//     recovery started from).
//   - newGeneration differs: finalized_generation and finalized_at are
//     updated - the VODFinalizer's own semantics, where a new generation
//     exists only when the confirmed segment set changed.
func (s *Store) CompleteRecoveryClaim(ctx context.Context, eventID string, cycle int64, claimToken, newGeneration string, now time.Time) (bool, error) {
	if claimToken == "" {
		return false, fmt.Errorf("store: complete recovery %s: claim token is required", eventID)
	}
	nowStr := fmtTime(now)
	res, err := s.db.ExecContext(ctx, `
		UPDATE event_finalization_intents
		SET finalized_generation = CASE WHEN ? <> '' AND ? <> finalized_generation THEN ? ELSE finalized_generation END,
		    finalized_at         = CASE WHEN ? <> '' AND ? <> finalized_generation THEN ? ELSE finalized_at END,
		    updated_at           = CASE WHEN ? <> '' AND ? <> finalized_generation THEN ? ELSE updated_at END
		WHERE event_id = ? AND cycle = ? AND state = ?`+ownedClaimPredicate,
		newGeneration, newGeneration, newGeneration,
		newGeneration, newGeneration, nowStr,
		newGeneration, newGeneration, nowStr,
		eventID, cycle, IntentFinalized, cycle, claimToken)
	if err != nil {
		return false, fmt.Errorf("store: complete recovery %s: %w", eventID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: complete recovery %s: rows affected: %w", eventID, err)
	}
	return n > 0, nil
}

// RenewFinalizationClaim extends a running claim's lease. The
// compare-and-set is on (event_id, claim_token) only - never cycle - so
// renewal keeps a superseded attempt's publish block alive until its
// finalizer has actually returned. ok=false means the claim no longer
// exists under this token.
func (s *Store) RenewFinalizationClaim(ctx context.Context, eventID, token string, now time.Time, lease time.Duration) (bool, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE event_finalization_claims SET lease_until = ?, renewed_at = ?
		WHERE event_id = ? AND claim_token = ?`, fmtTime(now.Add(lease)), fmtTime(now), eventID, token)
	if err != nil {
		return false, fmt.Errorf("store: renew claim %s: %w", eventID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: renew claim %s: rows affected: %w", eventID, err)
	}
	return n > 0, nil
}

// ReleaseFinalizationClaim deletes the claim row created under token. It
// must only be called after the VODFinalizer invocation has returned, and
// after CompleteFinalizationIntent (whose ownership predicate needs the
// row).
func (s *Store) ReleaseFinalizationClaim(ctx context.Context, eventID, token string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM event_finalization_claims WHERE event_id = ? AND claim_token = ?`, eventID, token); err != nil {
		return fmt.Errorf("store: release claim %s: %w", eventID, err)
	}
	return nil
}

// GetFinalizationClaim returns eventID's claim row, or found=false.
func (s *Store) GetFinalizationClaim(ctx context.Context, eventID string) (FinalizationClaim, bool, error) {
	var c FinalizationClaim
	var lease, started, renewed string
	err := s.db.QueryRowContext(ctx, `
		SELECT event_id, cycle, claim_token, lease_until, started_at, renewed_at
		FROM event_finalization_claims WHERE event_id = ?`, eventID).
		Scan(&c.EventID, &c.Cycle, &c.Token, &lease, &started, &renewed)
	if errors.Is(err, sql.ErrNoRows) {
		return FinalizationClaim{}, false, nil
	}
	if err != nil {
		return FinalizationClaim{}, false, fmt.Errorf("store: get claim %s: %w", eventID, err)
	}
	var perr error
	if c.LeaseUntil, perr = time.Parse(time.RFC3339Nano, lease); perr != nil {
		return FinalizationClaim{}, false, fmt.Errorf("store: parse lease_until: %w", perr)
	}
	if c.StartedAt, perr = time.Parse(time.RFC3339Nano, started); perr != nil {
		return FinalizationClaim{}, false, fmt.Errorf("store: parse started_at: %w", perr)
	}
	if c.RenewedAt, perr = time.Parse(time.RFC3339Nano, renewed); perr != nil {
		return FinalizationClaim{}, false, fmt.Errorf("store: parse renewed_at: %w", perr)
	}
	return c, true, nil
}

// HasActiveFinalizationClaim reports whether a claim with lease_until > now
// exists for eventID - one half of the on_publish block (the other half is
// the in-process registry).
func (s *Store) HasActiveFinalizationClaim(ctx context.Context, eventID string, now time.Time) (bool, error) {
	c, found, err := s.GetFinalizationClaim(ctx, eventID)
	if err != nil || !found {
		return false, err
	}
	return now.Before(c.LeaseUntil), nil
}

// DeleteAllFinalizationClaims removes every claim row. Called once at agent
// startup, before SRS callbacks are accepted: one agent process owns this
// database, so no claim can outlive the process that created it.
func (s *Store) DeleteAllFinalizationClaims(ctx context.Context) (int, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM event_finalization_claims`)
	if err != nil {
		return 0, fmt.Errorf("store: delete all claims: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("store: delete all claims: rows affected: %w", err)
	}
	return int(n), nil
}

// IntentOutcome is how one claimed attempt ended.
type IntentOutcome struct {
	// State is IntentFinalized, IntentPending, or IntentFailed.
	State         string
	Generation    string
	ErrorCategory string
	SkipReason    string
	NextAttemptAt time.Time
	// UncountAttempt reverses the attempt increment made at claim time, for
	// a fail-closed skip that never reached the finalizer (e.g. SRS
	// unavailable).
	UncountAttempt bool
}

// ownedClaimPredicate proves, inside the same UPDATE statement that applies
// the outcome, that the completing attempt still holds the claim it was
// granted: a row in event_finalization_claims with this exact event_id,
// cycle, and claim_token. Because the check and the write are one SQLite
// statement, claim ownership cannot change between verification and
// update. A released, superseded, expired-and-reclaimed, or never-issued
// token matches no row, so the UPDATE affects zero rows.
const ownedClaimPredicate = `
	AND EXISTS (
		SELECT 1 FROM event_finalization_claims c
		WHERE c.event_id = event_finalization_intents.event_id
		  AND c.cycle = ?
		  AND c.claim_token = ?
	)`

// CompleteFinalizationIntent applies an attempt's outcome only if ALL of
// these still hold at write time:
//   - the intent is at this cycle and in 'finalizing' (a reactivation bumps
//     the intent cycle, so a superseded attempt never matches), and
//   - a claim row with this exact (event_id, cycle, claim_token) exists
//     (a stale, wrong, released, or re-issued token never matches).
//
// applied=false means the outcome was discarded and the intent was left
// byte-for-byte unchanged. It must be called BEFORE
// ReleaseFinalizationClaim - release deletes the very row this predicate
// requires - and release itself stays a separate step that runs only after
// the VODFinalizer invocation has returned.
func (s *Store) CompleteFinalizationIntent(ctx context.Context, eventID string, cycle int64, claimToken string, out IntentOutcome, now time.Time) (bool, error) {
	if claimToken == "" {
		return false, fmt.Errorf("store: complete intent %s: claim token is required", eventID)
	}
	nowStr := fmtTime(now)
	var res sql.Result
	var err error
	switch out.State {
	case IntentFinalized:
		res, err = s.db.ExecContext(ctx, `
			UPDATE event_finalization_intents
			SET state = ?, finalized_generation = ?, finalized_at = ?, next_attempt_at = '',
			    last_error_category = '', last_skip_reason = '', updated_at = ?
			WHERE event_id = ? AND cycle = ? AND state = ?`+ownedClaimPredicate,
			IntentFinalized, out.Generation, nowStr, nowStr,
			eventID, cycle, IntentFinalizing, cycle, claimToken)
	case IntentPending:
		uncount := 0
		if out.UncountAttempt {
			uncount = 1
		}
		res, err = s.db.ExecContext(ctx, `
			UPDATE event_finalization_intents
			SET state = ?, attempts = MAX(attempts - ?, 0), last_skip_reason = ?,
			    last_error_category = '', next_attempt_at = '', updated_at = ?
			WHERE event_id = ? AND cycle = ? AND state = ?`+ownedClaimPredicate,
			IntentPending, uncount, out.SkipReason, nowStr,
			eventID, cycle, IntentFinalizing, cycle, claimToken)
	case IntentFailed:
		res, err = s.db.ExecContext(ctx, `
			UPDATE event_finalization_intents
			SET state = ?, last_error_category = ?, next_attempt_at = ?, last_skip_reason = '', updated_at = ?
			WHERE event_id = ? AND cycle = ? AND state = ?`+ownedClaimPredicate,
			IntentFailed, out.ErrorCategory, formatOptionalTime(out.NextAttemptAt), nowStr,
			eventID, cycle, IntentFinalizing, cycle, claimToken)
	default:
		return false, fmt.Errorf("store: complete intent %s: invalid outcome state %q", eventID, out.State)
	}
	if err != nil {
		return false, fmt.Errorf("store: complete intent %s: %w", eventID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: complete intent %s: rows affected: %w", eventID, err)
	}
	return n > 0, nil
}
