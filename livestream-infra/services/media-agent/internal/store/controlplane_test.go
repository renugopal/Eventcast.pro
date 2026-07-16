package store

import (
	"context"
	"testing"
	"time"
)

func TestApplyControlPlaneAssignmentsUpsertsAndRevokes(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	a1 := testAssignment("stream-1")
	a2 := testAssignment("stream-2")
	now := time.Now().UTC()

	applied, revoked, err := st.ApplyControlPlaneAssignments(ctx, []Assignment{a1, a2}, now)
	if err != nil {
		t.Fatalf("ApplyControlPlaneAssignments() error: %v", err)
	}
	if applied != 2 || revoked != 0 {
		t.Fatalf("applied=%d revoked=%d, want 2, 0", applied, revoked)
	}

	got, found, err := st.GetAssignment(ctx, "stream-1")
	if err != nil || !found {
		t.Fatalf("GetAssignment() found=%v err=%v", found, err)
	}
	if got.Enabled != true {
		t.Errorf("Enabled = %v, want true", got.Enabled)
	}

	// A second sync that only returns stream-1 must revoke (disable, not
	// delete) stream-2 rather than leaving it authorized forever.
	applied, revoked, err = st.ApplyControlPlaneAssignments(ctx, []Assignment{a1}, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("second ApplyControlPlaneAssignments() error: %v", err)
	}
	if applied != 1 || revoked != 1 {
		t.Fatalf("applied=%d revoked=%d, want 1, 1", applied, revoked)
	}

	revokedAssignment, found, err := st.GetAssignment(ctx, "stream-2")
	if err != nil || !found {
		t.Fatalf("GetAssignment(stream-2) found=%v err=%v", found, err)
	}
	if revokedAssignment.Enabled {
		t.Error("expected stream-2 to be revoked (enabled=false) after being dropped from the control-plane response")
	}
}

func TestApplyControlPlaneAssignmentsNeverTouchesSeedRows(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	seed := testAssignment("seed-stream")
	if _, err := st.ImportAssignments(ctx, []Assignment{seed}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}

	cpAssignment := testAssignment("cp-stream")
	if _, _, err := st.ApplyControlPlaneAssignments(ctx, []Assignment{cpAssignment}, time.Now().UTC()); err != nil {
		t.Fatalf("ApplyControlPlaneAssignments() error: %v", err)
	}

	// A control-plane sync that never mentions the seed-sourced ingest id
	// must not revoke it: seed rows are a separate, explicitly
	// out-of-band bootstrap mechanism.
	got, found, err := st.GetAssignment(ctx, "seed-stream")
	if err != nil || !found {
		t.Fatalf("GetAssignment(seed-stream) found=%v err=%v", found, err)
	}
	if !got.Enabled {
		t.Error("expected the seed-sourced assignment to remain enabled; control-plane sync must not revoke seed rows")
	}
}

func TestApplyControlPlaneAssignmentsIsAllOrNothing(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	valid := testAssignment("stream-1")
	invalid := testAssignment("stream-2")
	invalid.EventID = ""

	if _, _, err := st.ApplyControlPlaneAssignments(ctx, []Assignment{valid, invalid}, time.Now().UTC()); err == nil {
		t.Fatal("ApplyControlPlaneAssignments() expected error for a batch containing an invalid assignment, got nil")
	}

	if _, found, err := st.GetAssignment(ctx, "stream-1"); err != nil || found {
		t.Errorf("GetAssignment(stream-1) found=%v err=%v, want found=false (all-or-nothing)", found, err)
	}
}

// TestApplyControlPlaneAssignmentsRepointsIngestIDToNewEventOnReuse defines
// and tests behavior that was previously implicit/undocumented: what
// happens if a later sync reuses an ingest_id for a different event_id.
// The upsert-by-ingest_id (ON CONFLICT(ingest_id) DO UPDATE) repoints the
// cached row to the newest sync's event_id — the Media Agent trusts the
// control plane's assignment data and does not independently detect or
// block ingest_id reassignment.
func TestApplyControlPlaneAssignmentsRepointsIngestIDToNewEventOnReuse(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	first := testAssignment("shared-stream")
	first.EventID = "event-original"
	if _, _, err := st.ApplyControlPlaneAssignments(ctx, []Assignment{first}, time.Now().UTC()); err != nil {
		t.Fatalf("first ApplyControlPlaneAssignments() error: %v", err)
	}

	got, found, err := st.GetAssignment(ctx, "shared-stream")
	if err != nil || !found || got.EventID != "event-original" {
		t.Fatalf("after first sync: found=%v err=%v event_id=%q, want event-original", found, err, got.EventID)
	}

	second := testAssignment("shared-stream")
	second.EventID = "event-reassigned"
	if _, _, err := st.ApplyControlPlaneAssignments(ctx, []Assignment{second}, time.Now().UTC().Add(time.Minute)); err != nil {
		t.Fatalf("second ApplyControlPlaneAssignments() error: %v", err)
	}

	got2, found2, err := st.GetAssignment(ctx, "shared-stream")
	if err != nil || !found2 {
		t.Fatalf("after second sync: found=%v err=%v", found2, err)
	}
	if got2.EventID != "event-reassigned" {
		t.Errorf("EventID = %q after ingest_id reuse, want %q (upsert-by-ingest_id repoints to the newest sync's event_id)", got2.EventID, "event-reassigned")
	}

	// GetAssignmentByEventID for the old event must no longer resolve this
	// ingest_id — the row now belongs to the new event only.
	_, foundOld, err := st.GetAssignmentByEventID(ctx, "event-original")
	if err != nil {
		t.Fatalf("GetAssignmentByEventID(event-original) error: %v", err)
	}
	if foundOld {
		t.Error("GetAssignmentByEventID(event-original) found a row after its ingest_id was reassigned to a different event; want not found")
	}
}

func TestControlPlaneSyncStateRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	empty, err := st.GetControlPlaneSyncState(ctx)
	if err != nil {
		t.Fatalf("GetControlPlaneSyncState() error: %v", err)
	}
	if !empty.LastSuccessAt.IsZero() {
		t.Errorf("expected zero-value state before any sync, got %+v", empty)
	}

	now := time.Now().UTC()
	if err := st.RecordControlPlaneSyncAttempt(ctx, now); err != nil {
		t.Fatalf("RecordControlPlaneSyncAttempt() error: %v", err)
	}
	if err := st.RecordControlPlaneSyncFailure(ctx, "connection refused", now); err != nil {
		t.Fatalf("RecordControlPlaneSyncFailure() error: %v", err)
	}

	failed, err := st.GetControlPlaneSyncState(ctx)
	if err != nil {
		t.Fatalf("GetControlPlaneSyncState() error: %v", err)
	}
	if failed.ConsecutiveFailures != 1 || failed.LastError == "" {
		t.Errorf("got = %+v, want 1 consecutive failure with a non-empty last_error", failed)
	}

	if err := st.RecordControlPlaneSyncFailure(ctx, "timeout", now.Add(time.Second)); err != nil {
		t.Fatalf("second RecordControlPlaneSyncFailure() error: %v", err)
	}
	twice, err := st.GetControlPlaneSyncState(ctx)
	if err != nil {
		t.Fatalf("GetControlPlaneSyncState() error: %v", err)
	}
	if twice.ConsecutiveFailures != 2 {
		t.Errorf("ConsecutiveFailures = %d, want 2", twice.ConsecutiveFailures)
	}

	if err := st.RecordControlPlaneSyncSuccess(ctx, "v42", now.Add(2*time.Second)); err != nil {
		t.Fatalf("RecordControlPlaneSyncSuccess() error: %v", err)
	}
	success, err := st.GetControlPlaneSyncState(ctx)
	if err != nil {
		t.Fatalf("GetControlPlaneSyncState() error: %v", err)
	}
	if success.ConsecutiveFailures != 0 || success.LastError != "" || success.ConfigVersion != "v42" || success.LastSuccessAt.IsZero() {
		t.Errorf("got = %+v, want reset failure count, cleared error, recorded config version and success time", success)
	}
}
