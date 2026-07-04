package store

import (
	"context"
	"testing"
	"time"
)

func TestRelayLifecycleTransitions(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if err := st.UpsertRelayStarting(ctx, "evt1", "sess1", time.Now().UTC()); err != nil {
		t.Fatalf("UpsertRelayStarting() error: %v", err)
	}
	got, found, err := st.GetRelayBySessionID(ctx, "sess1")
	if err != nil || !found {
		t.Fatalf("GetRelayBySessionID() found=%v err=%v", found, err)
	}
	if got.Status != RelayStarting {
		t.Errorf("Status = %q, want %q", got.Status, RelayStarting)
	}

	if err := st.MarkRelayRunning(ctx, "sess1", time.Now().UTC()); err != nil {
		t.Fatalf("MarkRelayRunning() error: %v", err)
	}
	if err := st.IncrementRelayRestart(ctx, "sess1", "ffmpeg exited", time.Now().UTC()); err != nil {
		t.Fatalf("IncrementRelayRestart() error: %v", err)
	}
	got, _, err = st.GetRelayBySessionID(ctx, "sess1")
	if err != nil {
		t.Fatalf("GetRelayBySessionID() error: %v", err)
	}
	if got.RestartCount != 1 {
		t.Errorf("RestartCount = %d, want 1", got.RestartCount)
	}

	if err := st.MarkRelayFailed(ctx, "sess1", "restart budget exhausted", time.Now().UTC()); err != nil {
		t.Fatalf("MarkRelayFailed() error: %v", err)
	}
	got, _, err = st.GetRelayBySessionID(ctx, "sess1")
	if err != nil {
		t.Fatalf("GetRelayBySessionID() error: %v", err)
	}
	if got.Status != RelayFailed {
		t.Errorf("Status = %q, want %q", got.Status, RelayFailed)
	}
}

func TestMarkRelayStopped(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if err := st.UpsertRelayStarting(ctx, "evt1", "sess1", time.Now().UTC()); err != nil {
		t.Fatalf("UpsertRelayStarting() error: %v", err)
	}
	if err := st.MarkRelayStopped(ctx, "sess1", time.Now().UTC()); err != nil {
		t.Fatalf("MarkRelayStopped() error: %v", err)
	}
	got, _, err := st.GetRelayBySessionID(ctx, "sess1")
	if err != nil {
		t.Fatalf("GetRelayBySessionID() error: %v", err)
	}
	if got.Status != RelayStopped || got.StoppedAt.IsZero() {
		t.Errorf("got = %+v, want status=stopped with StoppedAt set", got)
	}
}

func TestReconcileStaleRelaysStopsSurvivingRunningRows(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if err := st.UpsertRelayStarting(ctx, "evt1", "sess1", time.Now().UTC()); err != nil {
		t.Fatalf("UpsertRelayStarting() error: %v", err)
	}
	if err := st.MarkRelayRunning(ctx, "sess1", time.Now().UTC()); err != nil {
		t.Fatalf("MarkRelayRunning() error: %v", err)
	}
	if err := st.UpsertRelayStarting(ctx, "evt2", "sess2", time.Now().UTC()); err != nil {
		t.Fatalf("UpsertRelayStarting() error: %v", err)
	}
	if err := st.MarkRelayStopped(ctx, "sess2", time.Now().UTC()); err != nil {
		t.Fatalf("MarkRelayStopped() error: %v", err)
	}

	n, err := st.ReconcileStaleRelays(ctx, time.Now().UTC())
	if err != nil {
		t.Fatalf("ReconcileStaleRelays() error: %v", err)
	}
	if n != 1 {
		t.Fatalf("reconciled count = %d, want 1 (only sess1 was running/starting)", n)
	}

	got, _, err := st.GetRelayBySessionID(ctx, "sess1")
	if err != nil {
		t.Fatalf("GetRelayBySessionID() error: %v", err)
	}
	if got.Status != RelayStopped {
		t.Errorf("sess1 Status = %q, want %q after startup reconciliation", got.Status, RelayStopped)
	}
}

func TestGetRelayBySessionIDNotFound(t *testing.T) {
	st := openTestStore(t)
	_, found, err := st.GetRelayBySessionID(context.Background(), "no-such-session")
	if err != nil {
		t.Fatalf("GetRelayBySessionID() error: %v", err)
	}
	if found {
		t.Error("expected found=false for an unknown session")
	}
}
