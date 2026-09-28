package store

import (
	"context"
	"testing"
	"time"
)

// These tests cover the AutoFinalizer intent transitions that
// ApplyControlPlaneAssignments performs inside its own transaction
// (rules R1/R2, migrations/0007_event_finalization_intents.sql).

func mustApply(t *testing.T, st *Store, now time.Time, as ...Assignment) {
	t.Helper()
	if _, _, err := st.ApplyControlPlaneAssignments(context.Background(), as, now); err != nil {
		t.Fatalf("ApplyControlPlaneAssignments() error: %v", err)
	}
}

func intentOf(t *testing.T, st *Store, eventID string) (FinalizationIntent, bool) {
	t.Helper()
	in, found, err := st.GetFinalizationIntent(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetFinalizationIntent(%s) error: %v", eventID, err)
	}
	return in, found
}

// setIntentState forces an intent row into a given state for a test
// precondition (e.g. 'finalized' with a generation).
func setIntentState(t *testing.T, st *Store, eventID, state string, cycle int64, generation string) {
	t.Helper()
	now := fmtTime(time.Now())
	if _, err := st.db.Exec(`
		INSERT INTO event_finalization_intents (event_id, state, cause, cycle, intent_at, finalized_generation, updated_at)
		VALUES (?, ?, 'revoked', ?, ?, ?, ?)
		ON CONFLICT(event_id) DO UPDATE SET state = excluded.state, cycle = excluded.cycle,
			finalized_generation = excluded.finalized_generation, updated_at = excluded.updated_at`,
		eventID, state, cycle, now, generation, now); err != nil {
		t.Fatalf("setIntentState(%s): %v", eventID, err)
	}
}

func TestApply_RevocationByAbsenceCreatesPendingIntent_SameTx(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a := testAssignment("stream-1")
	mustApply(t, st, now, a)
	if _, found := intentOf(t, st, a.EventID); found {
		t.Fatal("no intent expected while the assignment is publishable")
	}

	mustApply(t, st, now) // stream-1 absent -> revoked
	in, found := intentOf(t, st, a.EventID)
	if !found || in.State != IntentPending || in.Cause != IntentCauseRevoked || in.Cycle != 0 {
		t.Fatalf("intent = %+v found=%v, want pending/revoked at cycle 0", in, found)
	}
}

func TestApply_RevocationByEnabledFalseCreatesPendingIntent(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a := testAssignment("stream-1")
	mustApply(t, st, now, a)

	a.Enabled = false
	mustApply(t, st, now, a) // returned with enabled=false
	in, found := intentOf(t, st, a.EventID)
	if !found || in.State != IntentPending || in.Cause != IntentCauseRevoked {
		t.Fatalf("intent = %+v found=%v, want pending/revoked", in, found)
	}
}

func TestApply_RevocationWhileOtherAssignmentPublishable_NoIntent(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a1 := testAssignment("stream-1")
	a2 := testAssignment("stream-2")
	a2.EventID = a1.EventID
	mustApply(t, st, now, a1, a2)

	mustApply(t, st, now, a2) // a1 revoked, a2 still publishable
	if in, found := intentOf(t, st, a1.EventID); found {
		t.Fatalf("intent = %+v, want none while another assignment is publishable", in)
	}
}

func TestApply_IngestMovedFromEventAToB_AGetsRevokedIntent(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a := testAssignment("shared")
	a.EventID = "event-A"
	mustApply(t, st, now, a)

	a.EventID = "event-B"
	mustApply(t, st, now, a)

	inA, foundA := intentOf(t, st, "event-A")
	if !foundA || inA.State != IntentPending || inA.Cause != IntentCauseRevoked {
		t.Fatalf("event-A intent = %+v found=%v, want pending/revoked", inA, foundA)
	}
	if inB, foundB := intentOf(t, st, "event-B"); foundB {
		t.Fatalf("event-B intent = %+v, want none (it gained a publishable assignment)", inB)
	}
}

func TestApply_IngestMovedFromEventAToB_BEvaluatedIndependently(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a := testAssignment("shared")
	a.EventID = "event-A"
	mustApply(t, st, now, a)
	setIntentState(t, st, "event-B", IntentPending, 2, "")

	a.EventID = "event-B"
	mustApply(t, st, now, a)

	inB, _ := intentOf(t, st, "event-B")
	if inB.State != IntentCancelled || inB.Cycle != 3 {
		t.Fatalf("event-B intent = %+v, want cancelled at cycle 3", inB)
	}
	inA, foundA := intentOf(t, st, "event-A")
	if !foundA || inA.State != IntentPending {
		t.Fatalf("event-A intent = %+v found=%v, want its own pending revoked intent", inA, foundA)
	}
}

func TestApply_IngestMovedFromEventA_AStillPublishable_NoIntentForA(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	moving := testAssignment("shared")
	moving.EventID = "event-A"
	other := testAssignment("stays")
	other.EventID = "event-A"
	mustApply(t, st, now, moving, other)
	setIntentState(t, st, "event-A", IntentPending, 0, "")

	moving.EventID = "event-B"
	mustApply(t, st, now, moving, other)

	inA, _ := intentOf(t, st, "event-A")
	if inA.State != IntentCancelled || inA.Cycle != 1 {
		t.Fatalf("event-A intent = %+v, want the pre-existing pending cancelled at cycle 1 (still publishable)", inA)
	}
}

func TestApply_ReactivationCancelsPendingAndFinalized_BumpsCycle(t *testing.T) {
	for _, prior := range []string{IntentPending, IntentFailed, IntentFinalizing, IntentFinalized} {
		t.Run(prior, func(t *testing.T) {
			st := openTestStore(t)
			now := time.Now().UTC()
			a := testAssignment("stream-1")
			setIntentState(t, st, a.EventID, prior, 4, "gen-old")
			if _, err := st.db.Exec(`UPDATE event_finalization_intents SET last_error_category='x', next_attempt_at=?, last_skip_reason='y' WHERE event_id=?`,
				fmtTime(now.Add(time.Hour)), a.EventID); err != nil {
				t.Fatal(err)
			}
			mustApply(t, st, now, a)

			in, _ := intentOf(t, st, a.EventID)
			if in.State != IntentCancelled || in.Cycle != 5 {
				t.Fatalf("intent = %+v, want cancelled at cycle 5", in)
			}
			if in.FinalizedGeneration != "" || in.LastErrorCategory != "" || in.LastSkipReason != "" || !in.NextAttemptAt.IsZero() || in.Attempts != 0 {
				t.Fatalf("stale metadata survived reactivation: %+v", in)
			}
		})
	}
}

func TestApply_WindowExtensionCancelsPending(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a := testAssignment("stream-1")
	a.PublishWindowStartAt = now.Add(-3 * time.Hour)
	a.PublishWindowEndAt = now.Add(-2 * time.Hour) // expired, not publishable
	mustApply(t, st, now, a)
	setIntentState(t, st, a.EventID, IntentPending, 0, "")

	a.PublishWindowEndAt = now.Add(time.Hour) // extended -> publishable
	mustApply(t, st, now, a)
	in, _ := intentOf(t, st, a.EventID)
	if in.State != IntentCancelled || in.Cycle != 1 {
		t.Fatalf("intent = %+v, want cancelled at cycle 1", in)
	}
}

func TestApply_RepeatedIdenticalSync_Idempotent(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a := testAssignment("stream-1")
	mustApply(t, st, now, a)
	mustApply(t, st, now) // revoke -> pending
	first, _ := intentOf(t, st, a.EventID)

	for i := 0; i < 3; i++ {
		mustApply(t, st, now.Add(time.Duration(i+1)*time.Second))
	}
	after, _ := intentOf(t, st, a.EventID)
	if after.State != first.State || after.Cycle != first.Cycle || !after.IntentAt.Equal(first.IntentAt) {
		t.Fatalf("repeated sync changed intent: before=%+v after=%+v", first, after)
	}

	// Reactivate once, then repeat the publishable sync: cancelled is a no-op.
	mustApply(t, st, now, a)
	c1, _ := intentOf(t, st, a.EventID)
	mustApply(t, st, now, a)
	mustApply(t, st, now, a)
	c2, _ := intentOf(t, st, a.EventID)
	if c1.State != IntentCancelled || c2.Cycle != c1.Cycle {
		t.Fatalf("repeated publishable sync bumped cycle: %d -> %d", c1.Cycle, c2.Cycle)
	}
}

func TestApply_ErrorRollsBackAssignmentsAndIntents(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a := testAssignment("stream-1")
	mustApply(t, st, now, a)

	invalid := testAssignment("stream-2")
	invalid.EventID = ""
	// stream-1 absent (would revoke + create an intent) but the batch is invalid.
	if _, _, err := st.ApplyControlPlaneAssignments(context.Background(), []Assignment{invalid}, now); err == nil {
		t.Fatal("expected an error for an invalid batch")
	}
	got, found, err := st.GetAssignment(context.Background(), "stream-1")
	if err != nil || !found || !got.Enabled {
		t.Fatalf("stream-1 = %+v found=%v err=%v, want still enabled (rolled back)", got, found, err)
	}
	if in, found := intentOf(t, st, a.EventID); found {
		t.Fatalf("intent = %+v, want none (rolled back)", in)
	}
}

func TestApply_SeedRowNeverTreatedAsRevocation(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	seed := testAssignment("seed-stream")
	if _, err := st.ImportAssignments(context.Background(), []Assignment{seed}); err != nil {
		t.Fatal(err)
	}
	// A sync that returns the seed's ingest id disabled, and one that omits it.
	disabled := seed
	disabled.Enabled = false
	mustApply(t, st, now, disabled)
	if in, found := intentOf(t, st, seed.EventID); found {
		t.Fatalf("intent = %+v, want none (prior row was seed-sourced)", in)
	}
}
