package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Manifest types (03_DATA_MODEL_AND_API_CONTRACTS.md "manifest_generations").
const (
	ManifestTypeLive = "live"
	ManifestTypeVOD  = "vod"
)

// ManifestGeneration is one durable record of a published manifest
// object: the exact ordered segment id set that produced it. See
// "manifest_generations MUST record which exact ordered segment set
// produced each R2 playlist generation."
type ManifestGeneration struct {
	EventID       string
	ManifestType  string
	Generation    int
	SegmentIDs    []int64
	MediaSequence int
	SegmentCount  int
	R2Key         string
	PublishedAt   time.Time
}

// GetLatestManifestGeneration returns the most recently recorded
// generation for (eventID, manifestType), or found=false if none has
// ever been published. Callers use this to detect an unchanged segment
// set and skip a redundant republish.
func (s *Store) GetLatestManifestGeneration(ctx context.Context, eventID, manifestType string) (ManifestGeneration, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT event_id, manifest_type, generation, segment_ids, media_sequence, segment_count, r2_key, published_at
		FROM manifest_generations
		WHERE event_id = ? AND manifest_type = ?
		ORDER BY generation DESC LIMIT 1`, eventID, manifestType)

	g, err := scanManifestGeneration(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ManifestGeneration{}, false, nil
	}
	if err != nil {
		return ManifestGeneration{}, false, fmt.Errorf("store: get latest manifest generation for %s/%s: %w", eventID, manifestType, err)
	}
	return g, true, nil
}

func scanManifestGeneration(row *sql.Row) (ManifestGeneration, error) {
	var g ManifestGeneration
	var segmentIDsJSON, publishedAt string
	if err := row.Scan(&g.EventID, &g.ManifestType, &g.Generation, &segmentIDsJSON,
		&g.MediaSequence, &g.SegmentCount, &g.R2Key, &publishedAt); err != nil {
		return ManifestGeneration{}, err
	}
	if err := json.Unmarshal([]byte(segmentIDsJSON), &g.SegmentIDs); err != nil {
		return ManifestGeneration{}, fmt.Errorf("parse segment_ids: %w", err)
	}
	var err error
	g.PublishedAt, err = time.Parse(time.RFC3339Nano, publishedAt)
	if err != nil {
		return ManifestGeneration{}, fmt.Errorf("parse published_at: %w", err)
	}
	return g, nil
}

// RecordManifestGeneration durably records a newly published manifest
// generation, computing the next generation number transactionally so
// two overlapping calls for the same (eventID, manifestType) can never
// record the same generation number twice. Per
// 03_DATA_MODEL_AND_API_CONTRACTS.md "Only one active manifest writer
// lease may exist per event," callers are expected to already serialize
// concurrent regeneration attempts for the same event (see
// internal/upload's per-event manifest lock); this transactional
// generation-number computation is defense in depth, not the primary
// serialization mechanism.
func (s *Store) RecordManifestGeneration(ctx context.Context, eventID, manifestType string, segmentIDs []int64, mediaSequence int, r2Key string, now time.Time) (int, error) {
	segmentIDsJSON, err := json.Marshal(segmentIDs)
	if err != nil {
		return 0, fmt.Errorf("store: marshal segment ids: %w", err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("store: begin record manifest generation: %w", err)
	}
	defer tx.Rollback()

	var maxGeneration sql.NullInt64
	if err := tx.QueryRowContext(ctx, `
		SELECT MAX(generation) FROM manifest_generations WHERE event_id = ? AND manifest_type = ?`,
		eventID, manifestType).Scan(&maxGeneration); err != nil {
		return 0, fmt.Errorf("store: read max manifest generation: %w", err)
	}
	nextGeneration := int(maxGeneration.Int64) + 1

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO manifest_generations (event_id, manifest_type, generation, segment_ids, media_sequence, segment_count, r2_key, published_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		eventID, manifestType, nextGeneration, string(segmentIDsJSON), mediaSequence, len(segmentIDs), r2Key,
		now.UTC().Format(time.RFC3339Nano)); err != nil {
		return 0, fmt.Errorf("store: insert manifest generation: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("store: commit manifest generation: %w", err)
	}
	return nextGeneration, nil
}
