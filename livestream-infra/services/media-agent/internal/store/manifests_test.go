package store

import (
	"context"
	"testing"
	"time"
)

func TestRecordManifestGenerationIsMonotonic(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	g1, err := st.RecordManifestGeneration(ctx, "evt1", ManifestTypeLive, []int64{1, 2}, 0, "key1", time.Now().UTC())
	if err != nil {
		t.Fatalf("RecordManifestGeneration() error: %v", err)
	}
	if g1 != 1 {
		t.Errorf("first generation = %d, want 1", g1)
	}

	g2, err := st.RecordManifestGeneration(ctx, "evt1", ManifestTypeLive, []int64{1, 2, 3}, 0, "key1", time.Now().UTC())
	if err != nil {
		t.Fatalf("RecordManifestGeneration() error: %v", err)
	}
	if g2 != 2 {
		t.Errorf("second generation = %d, want 2", g2)
	}

	// A different manifest type for the same event starts its own
	// independent generation sequence.
	gVOD, err := st.RecordManifestGeneration(ctx, "evt1", ManifestTypeVOD, []int64{1, 2, 3}, 0, "vodkey", time.Now().UTC())
	if err != nil {
		t.Fatalf("RecordManifestGeneration() error: %v", err)
	}
	if gVOD != 1 {
		t.Errorf("first VOD generation = %d, want 1", gVOD)
	}

	latest, found, err := st.GetLatestManifestGeneration(ctx, "evt1", ManifestTypeLive)
	if err != nil || !found {
		t.Fatalf("GetLatestManifestGeneration() found=%v err=%v", found, err)
	}
	if latest.Generation != 2 || len(latest.SegmentIDs) != 3 {
		t.Errorf("latest = %+v, want generation 2 with 3 segment ids", latest)
	}
}

func TestGetLatestManifestGenerationNotFound(t *testing.T) {
	st := openTestStore(t)
	_, found, err := st.GetLatestManifestGeneration(context.Background(), "no-such-event", ManifestTypeLive)
	if err != nil {
		t.Fatalf("GetLatestManifestGeneration() error: %v", err)
	}
	if found {
		t.Error("expected found=false for an event with no recorded generation")
	}
}
