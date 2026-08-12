package store

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

// Assignment is the Media Agent's local, durable copy of a control-plane
// event assignment (03_DATA_MODEL_AND_API_CONTRACTS.md "Assignment
// synchronization"): the frozen credential and event model on_publish
// authorizes against. SecretTokenHash is a hex-encoded SHA-256 digest of
// the RTMP publish secret token; the raw secret itself is never stored.
//
// The control-plane network client that keeps this cache continuously
// synchronized belongs to a later milestone (see the media-agent README
// "Expected responsibilities": internal/controlplane is "not yet
// created"). Until it exists, the cache is populated deterministically
// at startup from an optional local JSON seed file (LoadAssignmentsFromFile)
// and/or directly via Import, both exercised by repository-backed tests.
type Assignment struct {
	IngestID             string    `json:"ingest_id"`
	EventID              string    `json:"event_id"`
	PlaybackID           string    `json:"playback_id"`
	SecretTokenHash      string    `json:"stream_secret_hash"`
	Enabled              bool      `json:"enabled"`
	PublishWindowStartAt time.Time `json:"publish_window_start_at"`
	PublishWindowEndAt   time.Time `json:"publish_window_end_at"`
	ConfigVersion        string    `json:"config_version"`
	UpdatedAt            time.Time `json:"updated_at"`

	// YouTube relay authorization. These three fields are parsed from
	// the seed file (the same approved secret source stream tokens use)
	// but are deliberately never written to cached_event_assignments -
	// ImportAssignments' INSERT lists columns explicitly and does not
	// include them. internal/relay resolves them directly from the
	// in-memory slice LoadAssignmentsFromFile returns, at startup, so
	// the raw stream key is never persisted to SQLite, logged, or
	// exposed through GetAssignment/GetAssignmentByEventID.
	YouTubeEnabled            bool           `json:"youtube_enabled"`
	YouTubeDestinationBaseURL string         `json:"youtube_destination_base_url"`
	YouTubeStreamKey          logging.Secret `json:"youtube_stream_key"`
}

// HashToken returns the hex-encoded SHA-256 digest of a raw secret
// token, the form persisted as Assignment.SecretTokenHash. Seed-file
// producers (and tests) use this to avoid ever writing a raw secret to
// the cache.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// VerifyToken reports whether token hashes to the assignment's stored
// digest, using a constant-time comparison so a mistyped or
// brute-forced token cannot be distinguished by timing.
func (a Assignment) VerifyToken(token string) bool {
	want, err := hex.DecodeString(a.SecretTokenHash)
	if err != nil || len(want) != sha256.Size {
		return false
	}
	got := sha256.Sum256([]byte(token))
	return subtle.ConstantTimeCompare(got[:], want) == 1
}

// Validate reports whether the assignment is well-formed enough to
// import. It does not check the publish window against wall-clock time
// (that is an authorization-time concern, not an import-time one).
func (a Assignment) Validate() error {
	if a.IngestID == "" {
		return fmt.Errorf("assignment: ingest_id is required")
	}
	if a.EventID == "" {
		return fmt.Errorf("assignment: %s: event_id is required", a.IngestID)
	}
	if a.PlaybackID == "" {
		return fmt.Errorf("assignment: %s: playback_id is required", a.IngestID)
	}
	if raw, err := hex.DecodeString(a.SecretTokenHash); err != nil || len(raw) != sha256.Size {
		return fmt.Errorf("assignment: %s: stream_secret_hash must be a 64-character hex-encoded SHA-256 digest", a.IngestID)
	}
	if a.PublishWindowStartAt.IsZero() || a.PublishWindowEndAt.IsZero() {
		return fmt.Errorf("assignment: %s: publish window start and end are required", a.IngestID)
	}
	if !a.PublishWindowEndAt.After(a.PublishWindowStartAt) {
		return fmt.Errorf("assignment: %s: publish_window_end_at must be after publish_window_start_at", a.IngestID)
	}
	if a.YouTubeEnabled {
		if a.YouTubeDestinationBaseURL == "" {
			return fmt.Errorf("assignment: %s: youtube_destination_base_url is required when youtube_enabled", a.IngestID)
		}
		if a.YouTubeStreamKey.Reveal() == "" {
			return fmt.Errorf("assignment: %s: youtube_stream_key is required when youtube_enabled", a.IngestID)
		}
	}
	return nil
}

// LoadAssignmentsFromFile reads a JSON array of assignments from path.
// This is the deterministic, production-safe seed mechanism used until
// a later milestone's control-plane client keeps the cache
// continuously synchronized: an operator (or a provisioning pipeline)
// writes the file, already containing hashed secrets, and the agent
// imports it at startup.
func LoadAssignmentsFromFile(path string) ([]Assignment, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("store: read assignment seed file: %w", err)
	}
	var assignments []Assignment
	if err := json.Unmarshal(data, &assignments); err != nil {
		return nil, fmt.Errorf("store: parse assignment seed file: %w", err)
	}
	for _, a := range assignments {
		if err := a.Validate(); err != nil {
			return nil, fmt.Errorf("store: invalid assignment in seed file: %w", err)
		}
	}
	return assignments, nil
}

// SanitizeSeedAssignments enforces that a local JSON seed file can never
// self-authorize a real publish in a real deployment. A seed file is
// operator-supplied local disk content on a single VM - not the
// authenticated, operator-activated control plane
// (`ApplyControlPlaneAssignments`) - so unless allowEnabled is true (the
// dev/test-only opt-in, config.EnvAllowSeedEnabledAssignments), every
// returned assignment has Enabled forced to false, regardless of what the
// seed file itself claims. Callers should log a warning identifying which
// ingest_ids were affected; this function only sanitizes, it does not log.
//
// Deliberately operates on and returns a fresh slice rather than mutating
// its input in place, and deliberately only touches the Enabled field -
// every other field (including YouTube relay fields, handled separately by
// the caller) passes through unchanged.
func SanitizeSeedAssignments(assignments []Assignment, allowEnabled bool) []Assignment {
	if allowEnabled {
		return assignments
	}
	sanitized := make([]Assignment, len(assignments))
	for i, a := range assignments {
		a.Enabled = false
		sanitized[i] = a
	}
	return sanitized
}

// ImportAssignments upserts every assignment transactionally: either
// every row is applied or none are, so a malformed seed file or a
// mid-import failure cannot leave the cache partially updated.
func (s *Store) ImportAssignments(ctx context.Context, assignments []Assignment) (int, error) {
	if len(assignments) == 0 {
		return 0, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("store: begin import assignments: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO cached_event_assignments (
			ingest_id, event_id, playback_id, secret_token_hash, enabled,
			publish_window_start_at, publish_window_end_at, config_version, updated_at,
			youtube_enabled, youtube_destination_base_url
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			youtube_destination_base_url = excluded.youtube_destination_base_url`)
	if err != nil {
		return 0, fmt.Errorf("store: prepare import assignments: %w", err)
	}
	defer stmt.Close()

	for _, a := range assignments {
		if err := a.Validate(); err != nil {
			return 0, err
		}
		updatedAt := a.UpdatedAt
		if updatedAt.IsZero() {
			updatedAt = time.Now().UTC()
		}
		if _, err := stmt.ExecContext(ctx,
			a.IngestID, a.EventID, a.PlaybackID, a.SecretTokenHash, a.Enabled,
			a.PublishWindowStartAt.UTC().Format(time.RFC3339Nano),
			a.PublishWindowEndAt.UTC().Format(time.RFC3339Nano),
			a.ConfigVersion, updatedAt.Format(time.RFC3339Nano),
			a.YouTubeEnabled, a.YouTubeDestinationBaseURL,
		); err != nil {
			return 0, fmt.Errorf("store: import assignment %s: %w", a.IngestID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("store: commit import assignments: %w", err)
	}
	return len(assignments), nil
}

// GetAssignment returns the cached assignment for ingestID, or
// found=false if no assignment is cached for it (an unknown publisher).
func (s *Store) GetAssignment(ctx context.Context, ingestID string) (Assignment, bool, error) {
	var a Assignment
	var startAt, endAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT ingest_id, event_id, playback_id, secret_token_hash, enabled,
		       publish_window_start_at, publish_window_end_at, config_version, updated_at,
		       youtube_enabled, youtube_destination_base_url
		FROM cached_event_assignments WHERE ingest_id = ?`, ingestID,
	).Scan(&a.IngestID, &a.EventID, &a.PlaybackID, &a.SecretTokenHash, &a.Enabled,
		&startAt, &endAt, &a.ConfigVersion, &updatedAt,
		&a.YouTubeEnabled, &a.YouTubeDestinationBaseURL)
	if err == sql.ErrNoRows {
		return Assignment{}, false, nil
	}
	if err != nil {
		return Assignment{}, false, fmt.Errorf("store: get assignment %s: %w", ingestID, err)
	}

	a.PublishWindowStartAt, err = time.Parse(time.RFC3339Nano, startAt)
	if err != nil {
		return Assignment{}, false, fmt.Errorf("store: parse publish_window_start_at for %s: %w", ingestID, err)
	}
	a.PublishWindowEndAt, err = time.Parse(time.RFC3339Nano, endAt)
	if err != nil {
		return Assignment{}, false, fmt.Errorf("store: parse publish_window_end_at for %s: %w", ingestID, err)
	}
	a.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return Assignment{}, false, fmt.Errorf("store: parse updated_at for %s: %w", ingestID, err)
	}
	return a, true, nil
}

// GetAssignmentByEventID returns the cached assignment for eventID, used
// by upload key construction and manifest generation to resolve an
// event's opaque playback_id without threading it through every
// intermediate call site. found=false if no assignment is cached for
// this event (e.g. it was never seeded, or reconciliation is running
// against a database from before this event's assignment existed).
//
// cached_event_assignments is keyed by ingest_id, not event_id, so one
// event accumulates a historical row per activation:
// ApplyControlPlaneAssignments (controlplane.go) upserts the control
// plane's current row under its (new) ingest_id on every sync and
// disables-in-place any previously-cached row no longer returned,
// without ever deleting it. A plain "WHERE event_id = ? LIMIT 1" is
// therefore non-deterministic across more than one row and can return a
// stale, disabled row instead of the event's current one.
//
// The deterministic selection below resolves that using only signals
// this cache already carries and already documents an intended
// precedence for:
//   - source: "a stale seed can never be mistaken for fresher
//     control-plane state" (migrations/0003_production_readiness.sql) and
//     "a seed row is never allowed to overwrite a controlplane row"
//     (controlplane.go) - so a controlplane-sourced row always outranks a
//     seed-sourced row for the same event, regardless of config_version.
//   - config_version: the control plane's public.media_event_assignments
//     has event_id UNIQUE with config_version a trigger-owned bigint that
//     starts at 1 and strictly increments on every identity/state change
//     (eventcast-admin/supabase/migrations/0020_media_agent_assignments.sql),
//     so exactly one authoritative lineage exists per event and the
//     highest config_version among same-source rows is always the
//     current one. It is cast to INTEGER because the SQLite column is
//     TEXT, and plain string ordering ("9" > "10") would be wrong.
//   - updated_at: a defensive final tie-break using an existing column
//     only; the config_version guarantee above means it should never be
//     needed in practice.
func (s *Store) GetAssignmentByEventID(ctx context.Context, eventID string) (Assignment, bool, error) {
	var a Assignment
	var startAt, endAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT ingest_id, event_id, playback_id, secret_token_hash, enabled,
		       publish_window_start_at, publish_window_end_at, config_version, updated_at,
		       youtube_enabled, youtube_destination_base_url
		FROM cached_event_assignments
		WHERE event_id = ?
		ORDER BY
			CASE WHEN source = 'controlplane' THEN 0 ELSE 1 END ASC,
			CAST(config_version AS INTEGER) DESC,
			updated_at DESC
		LIMIT 1`, eventID,
	).Scan(&a.IngestID, &a.EventID, &a.PlaybackID, &a.SecretTokenHash, &a.Enabled,
		&startAt, &endAt, &a.ConfigVersion, &updatedAt,
		&a.YouTubeEnabled, &a.YouTubeDestinationBaseURL)
	if err == sql.ErrNoRows {
		return Assignment{}, false, nil
	}
	if err != nil {
		return Assignment{}, false, fmt.Errorf("store: get assignment by event %s: %w", eventID, err)
	}

	a.PublishWindowStartAt, err = time.Parse(time.RFC3339Nano, startAt)
	if err != nil {
		return Assignment{}, false, fmt.Errorf("store: parse publish_window_start_at for event %s: %w", eventID, err)
	}
	a.PublishWindowEndAt, err = time.Parse(time.RFC3339Nano, endAt)
	if err != nil {
		return Assignment{}, false, fmt.Errorf("store: parse publish_window_end_at for event %s: %w", eventID, err)
	}
	a.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return Assignment{}, false, fmt.Errorf("store: parse updated_at for event %s: %w", eventID, err)
	}
	return a, true, nil
}

// AssignmentCount returns the number of cached assignments, used by the
// readiness check to confirm the table is queryable without exposing
// individual assignment identifiers.
func (s *Store) AssignmentCount(ctx context.Context) (int, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM cached_event_assignments`).Scan(&n); err != nil {
		return 0, fmt.Errorf("store: count assignments: %w", err)
	}
	return n, nil
}
