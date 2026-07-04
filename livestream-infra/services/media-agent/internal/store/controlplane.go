package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Assignment source values (migrations/0003_production_readiness.sql).
// "seed" is the development/bootstrap-only local JSON file
// (LoadAssignmentsFromFile / ImportAssignments); "controlplane" is a row
// most recently confirmed by a real control-plane sync
// (ApplyControlPlaneAssignments). A seed row is never allowed to
// overwrite a controlplane row - see ApplyControlPlaneAssignments and
// the media-agent README's control-plane synchronization section.
const (
	AssignmentSourceSeed         = "seed"
	AssignmentSourceControlPlane = "controlplane"
)

// ApplyControlPlaneAssignments durably replaces this node's view of its
// control-plane-sourced assignments with exactly the set the control
// plane just returned (03_DATA_MODEL_AND_API_CONTRACTS.md "Assignment
// synchronization": "the node periodically pulls assignments and stores a
// local cache"). Every incoming assignment is upserted with
// source='controlplane'. Any assignment previously cached with
// source='controlplane' but absent from this response is treated as
// revoked by the control plane and is disabled in place (never deleted,
// preserving it as an audit trail and letting an already-active session
// finish observing on_hls/on_unpublish against a row that still exists).
// Rows with source='seed' are never touched by this function, since a
// seed row this sync is silent about is not evidence of revocation - it
// simply is not the control plane's concern.
//
// The whole operation is one transaction: a partial or malformed response
// can never leave the cache in a mixed state.
func (s *Store) ApplyControlPlaneAssignments(ctx context.Context, assignments []Assignment, now time.Time) (applied, revoked int, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("store: begin apply control-plane assignments: %w", err)
	}
	defer tx.Rollback()

	nowStr := now.UTC().Format(time.RFC3339Nano)

	upsertStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO cached_event_assignments (
			ingest_id, event_id, playback_id, secret_token_hash, enabled,
			publish_window_start_at, publish_window_end_at, config_version, updated_at,
			youtube_enabled, youtube_destination_base_url, source, synced_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(ingest_id) DO UPDATE SET
			event_id = excluded.event_id,
			playback_id = excluded.playback_id,
			secret_token_hash = excluded.secret_token_hash,
			enabled = excluded.enabled,
			publish_window_start_at = excluded.publish_window_start_at,
			publish_window_end_at = excluded.publish_window_end_at,
			config_version = excluded.config_version,
			updated_at = excluded.updated_at,
			youtube_enabled = excluded.youtube_enabled,
			youtube_destination_base_url = excluded.youtube_destination_base_url,
			source = excluded.source,
			synced_at = excluded.synced_at`)
	if err != nil {
		return 0, 0, fmt.Errorf("store: prepare apply control-plane assignments: %w", err)
	}
	defer upsertStmt.Close()

	seenIngestIDs := make(map[string]struct{}, len(assignments))
	for _, a := range assignments {
		if err := a.Validate(); err != nil {
			return 0, 0, fmt.Errorf("store: invalid control-plane assignment: %w", err)
		}
		updatedAt := a.UpdatedAt
		if updatedAt.IsZero() {
			updatedAt = now
		}
		if _, err := upsertStmt.ExecContext(ctx,
			a.IngestID, a.EventID, a.PlaybackID, a.SecretTokenHash, a.Enabled,
			a.PublishWindowStartAt.UTC().Format(time.RFC3339Nano),
			a.PublishWindowEndAt.UTC().Format(time.RFC3339Nano),
			a.ConfigVersion, updatedAt.UTC().Format(time.RFC3339Nano),
			a.YouTubeEnabled, a.YouTubeDestinationBaseURL,
			AssignmentSourceControlPlane, nowStr,
		); err != nil {
			return 0, 0, fmt.Errorf("store: apply control-plane assignment %s: %w", a.IngestID, err)
		}
		seenIngestIDs[a.IngestID] = struct{}{}
		applied++
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT ingest_id FROM cached_event_assignments
		WHERE source = ? AND enabled = 1`, AssignmentSourceControlPlane)
	if err != nil {
		return 0, 0, fmt.Errorf("store: list existing control-plane assignments: %w", err)
	}
	var toRevoke []string
	for rows.Next() {
		var ingestID string
		if err := rows.Scan(&ingestID); err != nil {
			rows.Close()
			return 0, 0, fmt.Errorf("store: scan existing control-plane assignment: %w", err)
		}
		if _, ok := seenIngestIDs[ingestID]; !ok {
			toRevoke = append(toRevoke, ingestID)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, 0, fmt.Errorf("store: iterate existing control-plane assignments: %w", err)
	}
	rows.Close()

	if len(toRevoke) > 0 {
		revokeStmt, err := tx.PrepareContext(ctx, `
			UPDATE cached_event_assignments
			SET enabled = 0, updated_at = ?, synced_at = ?
			WHERE ingest_id = ? AND source = ?`)
		if err != nil {
			return 0, 0, fmt.Errorf("store: prepare revoke control-plane assignments: %w", err)
		}
		defer revokeStmt.Close()
		for _, ingestID := range toRevoke {
			if _, err := revokeStmt.ExecContext(ctx, nowStr, nowStr, ingestID, AssignmentSourceControlPlane); err != nil {
				return 0, 0, fmt.Errorf("store: revoke control-plane assignment %s: %w", ingestID, err)
			}
			revoked++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("store: commit apply control-plane assignments: %w", err)
	}
	return applied, revoked, nil
}

// ControlPlaneSyncState is the durable, single-row health record of the
// control-plane assignment sync (migrations/0003_production_readiness.sql).
type ControlPlaneSyncState struct {
	LastAttemptAt       time.Time
	LastSuccessAt       time.Time
	LastError           string
	ConsecutiveFailures int
	ConfigVersion       string
	UpdatedAt           time.Time
}

// GetControlPlaneSyncState returns the current sync health record. A
// never-synced node returns the zero-value state with no error.
func (s *Store) GetControlPlaneSyncState(ctx context.Context) (ControlPlaneSyncState, error) {
	var st ControlPlaneSyncState
	var lastAttempt, lastSuccess, updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT last_attempt_at, last_success_at, last_error, consecutive_failures, config_version, updated_at
		FROM controlplane_sync_state WHERE id = 1`,
	).Scan(&lastAttempt, &lastSuccess, &st.LastError, &st.ConsecutiveFailures, &st.ConfigVersion, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ControlPlaneSyncState{}, nil
	}
	if err != nil {
		return ControlPlaneSyncState{}, fmt.Errorf("store: get control-plane sync state: %w", err)
	}
	if st.LastAttemptAt, err = parseOptionalTime(lastAttempt); err != nil {
		return ControlPlaneSyncState{}, fmt.Errorf("store: parse last_attempt_at: %w", err)
	}
	if st.LastSuccessAt, err = parseOptionalTime(lastSuccess); err != nil {
		return ControlPlaneSyncState{}, fmt.Errorf("store: parse last_success_at: %w", err)
	}
	if st.UpdatedAt, err = parseOptionalTime(updatedAt); err != nil {
		return ControlPlaneSyncState{}, fmt.Errorf("store: parse updated_at: %w", err)
	}
	return st, nil
}

// RecordControlPlaneSyncAttempt records that a sync attempt started, used
// so an operator can distinguish "never tried" from "tried and is still
// failing" even before the attempt resolves.
func (s *Store) RecordControlPlaneSyncAttempt(ctx context.Context, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO controlplane_sync_state (id, last_attempt_at, updated_at) VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, updated_at = excluded.updated_at`,
		nowStr, nowStr)
	if err != nil {
		return fmt.Errorf("store: record control-plane sync attempt: %w", err)
	}
	return nil
}

// RecordControlPlaneSyncSuccess durably records a successful sync,
// resetting the consecutive-failure counter and last_error.
func (s *Store) RecordControlPlaneSyncSuccess(ctx context.Context, configVersion string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO controlplane_sync_state (id, last_attempt_at, last_success_at, last_error, consecutive_failures, config_version, updated_at)
		VALUES (1, ?, ?, '', 0, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			last_attempt_at = excluded.last_attempt_at,
			last_success_at = excluded.last_success_at,
			last_error = '',
			consecutive_failures = 0,
			config_version = excluded.config_version,
			updated_at = excluded.updated_at`,
		nowStr, nowStr, configVersion, nowStr)
	if err != nil {
		return fmt.Errorf("store: record control-plane sync success: %w", err)
	}
	return nil
}

// RecordControlPlaneSyncFailure durably records a failed sync attempt and
// increments the consecutive-failure counter, read back by
// GetControlPlaneSyncState for the stale-cache and backoff policy.
// lastError must already be sanitized: it must never contain a token,
// authorization header, or signed URL.
func (s *Store) RecordControlPlaneSyncFailure(ctx context.Context, lastError string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO controlplane_sync_state (id, last_attempt_at, last_error, consecutive_failures, updated_at)
		VALUES (1, ?, ?, 1, ?)
		ON CONFLICT(id) DO UPDATE SET
			last_attempt_at = excluded.last_attempt_at,
			last_error = excluded.last_error,
			consecutive_failures = consecutive_failures + 1,
			updated_at = excluded.updated_at`,
		nowStr, lastError, nowStr)
	if err != nil {
		return fmt.Errorf("store: record control-plane sync failure: %w", err)
	}
	return nil
}
