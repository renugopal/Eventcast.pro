package store

import (
	"context"
	"reflect"
	"testing"
	"time"
)

// finalizeFully drives a claimable event's intent to 'finalized' with gen
// through the real claim -> token-CAS completion -> release path.
func finalizeFully(t *testing.T, st *Store, eventID, gen string, now time.Time) {
	t.Helper()
	res := mustClaim(t, st, eventID, claimIn(now))
	if !complete(t, st, eventID, res.Cycle, res.Token, IntentOutcome{State: IntentFinalized, Generation: gen}, now) {
		t.Fatal("finalize completion not applied")
	}
	if err := st.ReleaseFinalizationClaim(context.Background(), eventID, res.Token); err != nil {
		t.Fatal(err)
	}
}

func operatorIn(now time.Time) ClaimInput {
	return ClaimInput{Now: now, Lease: time.Minute, Operator: true}
}

// ------------------------------------------------------------ recovery

func TestClaim_RecoveryFromFinalized_LeavesIntentUntouched(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	finalizeFully(t, st, ev, "gen-1", now)
	before, _ := intentOf(t, st, ev)

	res, err := st.ClaimFinalization(context.Background(), ev, operatorIn(now.Add(time.Second)))
	if err != nil || !res.Claimed || !res.Recovery {
		t.Fatalf("claim = %+v err=%v, want a recovery claim", res, err)
	}
	if after, _ := intentOf(t, st, ev); after != before {
		t.Fatalf("recovery claim modified the intent:\nbefore=%+v\nafter=%+v", before, after)
	}
	if _, found, _ := st.GetFinalizationClaim(context.Background(), ev); !found {
		t.Fatal("recovery claim row missing")
	}
}

func TestCompleteRecovery_UnchangedGeneration_NoChange(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	finalizeFully(t, st, ev, "gen-1", now)
	before, _ := intentOf(t, st, ev)
	res := mustClaim(t, st, ev, operatorIn(now.Add(time.Second)))

	applied, err := st.CompleteRecoveryClaim(context.Background(), ev, res.Cycle, res.Token, "gen-1", now.Add(2*time.Second))
	if err != nil || !applied {
		t.Fatalf("applied=%v err=%v, want applied", applied, err)
	}
	if after, _ := intentOf(t, st, ev); after != before {
		t.Fatalf("unchanged-generation recovery changed intent:\nbefore=%+v\nafter=%+v", before, after)
	}
}

func TestCompleteRecovery_NewGeneration_UpdatesGenerationAndFinalizedAt(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	finalizeFully(t, st, ev, "gen-1", now)
	before, _ := intentOf(t, st, ev)
	res := mustClaim(t, st, ev, operatorIn(now.Add(time.Second)))

	later := now.Add(2 * time.Second)
	applied, err := st.CompleteRecoveryClaim(context.Background(), ev, res.Cycle, res.Token, "gen-2", later)
	if err != nil || !applied {
		t.Fatalf("applied=%v err=%v", applied, err)
	}
	after, _ := intentOf(t, st, ev)
	if after.State != IntentFinalized || after.FinalizedGeneration != "gen-2" || !after.FinalizedAt.Equal(later) ||
		after.Cycle != before.Cycle || after.Attempts != before.Attempts {
		t.Fatalf("after = %+v, want finalized gen-2 at %v, same cycle/attempts", after, later)
	}
}

func TestCompleteRecovery_WrongTokenOrReleasedClaim_NotApplied(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	finalizeFully(t, st, ev, "gen-1", now)
	before, _ := intentOf(t, st, ev)
	res := mustClaim(t, st, ev, operatorIn(now.Add(time.Second)))

	if applied, err := st.CompleteRecoveryClaim(ctx, ev, res.Cycle, "claim_wrong", "gen-2", now); err != nil || applied {
		t.Fatalf("wrong token applied=%v err=%v", applied, err)
	}
	if err := st.ReleaseFinalizationClaim(ctx, ev, res.Token); err != nil {
		t.Fatal(err)
	}
	if applied, err := st.CompleteRecoveryClaim(ctx, ev, res.Cycle, res.Token, "gen-2", now); err != nil || applied {
		t.Fatalf("released claim applied=%v err=%v", applied, err)
	}
	if after, _ := intentOf(t, st, ev); after != before {
		t.Fatalf("intent changed:\nbefore=%+v\nafter=%+v", before, after)
	}
}

func TestCompleteRecovery_AfterReactivation_NotApplied_NewCycleUntouched(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	finalizeFully(t, st, ev, "gen-1", now)
	res := mustClaim(t, st, ev, operatorIn(now.Add(time.Second)))

	mustApply(t, st, now, testAssignment("stream-1")) // publishable again -> R1
	mid, _ := intentOf(t, st, ev)
	if mid.State != IntentCancelled || mid.Cycle != res.Cycle+1 {
		t.Fatalf("mid = %+v, want cancelled at cycle+1", mid)
	}
	if applied, err := st.CompleteRecoveryClaim(context.Background(), ev, res.Cycle, res.Token, "gen-2", now); err != nil || applied {
		t.Fatalf("applied=%v err=%v, want superseded", applied, err)
	}
	if after, _ := intentOf(t, st, ev); after != mid {
		t.Fatalf("new cycle changed:\nmid=%+v\nafter=%+v", mid, after)
	}
}

func TestCompleteFinalizationIntent_CannotMatchRecoveryClaim(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	finalizeFully(t, st, ev, "gen-1", now)
	before, _ := intentOf(t, st, ev)
	res := mustClaim(t, st, ev, operatorIn(now.Add(time.Second)))
	for _, out := range []IntentOutcome{
		{State: IntentFailed, ErrorCategory: "finalizer_error", NextAttemptAt: now.Add(time.Hour)},
		{State: IntentPending, SkipReason: SkipNotEligible},
		{State: IntentFinalized, Generation: "gen-x"},
	} {
		if complete(t, st, ev, res.Cycle, res.Token, out, now) {
			t.Fatalf("normal completion %s matched a recovery claim", out.State)
		}
	}
	if after, _ := intentOf(t, st, ev); after != before {
		t.Fatalf("intent changed:\nbefore=%+v\nafter=%+v", before, after)
	}
}

// ------------------------------------------------------------ operator

func TestClaim_Operator_BypassesQuietPeriodAndCutoffOnly(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-10*time.Second)) // inside quiet period
	bg := claimIn(now)
	bg.RolloutCutoff = now // session predates cutoff too
	if res, _ := st.ClaimFinalization(context.Background(), ev, bg); res.Claimed {
		t.Fatalf("background claimed: %+v", res)
	}
	op := operatorIn(now)
	op.QuietPeriod = time.Hour
	op.RolloutCutoff = now
	if res, err := st.ClaimFinalization(context.Background(), ev, op); err != nil || !res.Claimed || res.Recovery {
		t.Fatalf("operator claim = %+v err=%v, want a normal (non-recovery) claim", res, err)
	}
}

func TestClaim_Operator_NeverBypassesPublishable(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	other := testAssignment("stream-2")
	other.EventID = ev
	if _, err := st.ImportAssignments(context.Background(), []Assignment{other}); err != nil {
		t.Fatal(err)
	}
	res, err := st.ClaimFinalization(context.Background(), ev, operatorIn(now))
	if err != nil || res.Claimed || res.SkipReason != SkipPublishable {
		t.Fatalf("claim = %+v err=%v, want assignment_publishable", res, err)
	}
	if _, found, _ := st.GetFinalizationClaim(context.Background(), ev); found {
		t.Fatal("claim row written while publishable")
	}
}

func TestClaim_Operator_NeverBypassesOpenSession(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	if _, err := st.CreateSession(context.Background(), ev, "stream-1", "pb-stream-1", now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	res, err := st.ClaimFinalization(context.Background(), ev, operatorIn(now))
	if err != nil || res.Claimed || res.SkipReason != SkipSessionOpen {
		t.Fatalf("claim = %+v err=%v, want session_open", res, err)
	}
}

func TestClaim_Operator_NeverBypassesClaimHeld(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	mustClaim(t, st, ev, claimIn(now))
	res, err := st.ClaimFinalization(context.Background(), ev, operatorIn(now.Add(time.Second)))
	if err != nil || res.Claimed || res.SkipReason != SkipClaimHeld {
		t.Fatalf("claim = %+v err=%v, want claim_held", res, err)
	}
}

func TestClaim_Operator_FinalizedClaimable_BackgroundNot(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	finalizeFully(t, st, ev, "gen-1", now)
	if res, err := st.ClaimFinalization(context.Background(), ev, claimIn(now)); err != nil || res.Claimed || res.SkipReason != SkipNoIntent {
		t.Fatalf("background claim = %+v err=%v, want no_claimable_intent", res, err)
	}
	if res, err := st.ClaimFinalization(context.Background(), ev, operatorIn(now)); err != nil || !res.Claimed || !res.Recovery {
		t.Fatalf("operator claim = %+v err=%v, want recovery claim", res, err)
	}
}

func TestClaim_Operator_FailedBackoffOverride_DoesNotPersist(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	a := mustClaim(t, st, ev, claimIn(now))
	if !complete(t, st, ev, a.Cycle, a.Token, IntentOutcome{State: IntentFailed, ErrorCategory: "finalizer_error", NextAttemptAt: now.Add(time.Hour)}, now) {
		t.Fatal("failed not applied")
	}
	_ = st.ReleaseFinalizationClaim(ctx, ev, a.Token)

	op := mustClaim(t, st, ev, operatorIn(now.Add(time.Second))) // backoff overridden once
	nextFromNormalBackoff := now.Add(2 * time.Hour)
	if !complete(t, st, ev, op.Cycle, op.Token, IntentOutcome{State: IntentFailed, ErrorCategory: "finalizer_error", NextAttemptAt: nextFromNormalBackoff}, now) {
		t.Fatal("operator failed not applied")
	}
	_ = st.ReleaseFinalizationClaim(ctx, ev, op.Token)

	in, _ := intentOf(t, st, ev)
	if !in.NextAttemptAt.Equal(nextFromNormalBackoff) {
		t.Fatalf("next_attempt_at = %v, want the attempt's own backoff %v", in.NextAttemptAt, nextFromNormalBackoff)
	}
	if res, _ := st.ClaimFinalization(ctx, ev, claimIn(now.Add(2*time.Second))); res.Claimed || res.SkipReason != SkipBackoff {
		t.Fatalf("background claim after operator override = %+v, want retry_backoff (override not persisted)", res)
	}
}

func TestClaim_Operator_ReFinalizeSameCycle_NoCycleChange(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	finalizeFully(t, st, ev, "gen-1", now)
	before, _ := intentOf(t, st, ev)
	res := mustClaim(t, st, ev, operatorIn(now.Add(time.Second)))
	if res.Cycle != before.Cycle {
		t.Fatalf("recovery claim cycle = %d, want %d", res.Cycle, before.Cycle)
	}
	if applied, err := st.CompleteRecoveryClaim(context.Background(), ev, res.Cycle, res.Token, "gen-1", now); err != nil || !applied {
		t.Fatalf("applied=%v err=%v", applied, err)
	}
	if after, _ := intentOf(t, st, ev); after.Cycle != before.Cycle || after.FinalizedGeneration != "gen-1" {
		t.Fatalf("after = %+v, want same cycle and generation", after)
	}
}

// ------------------------------------------------------------ candidates

func candidates(t *testing.T, st *Store, ingestID string) []string {
	t.Helper()
	got, err := st.ResolveLiveIngestCandidates(context.Background(), ingestID)
	if err != nil {
		t.Fatalf("ResolveLiveIngestCandidates(%s): %v", ingestID, err)
	}
	return got
}

func closedSessionAt(t *testing.T, st *Store, eventID, ingestID string, start time.Time) {
	t.Helper()
	s, err := st.CreateSession(context.Background(), eventID, ingestID, "pb-"+ingestID, start)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.MarkDisconnected(context.Background(), s.ID, EndReasonUnpublish, start.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
}

func cachedFor(t *testing.T, st *Store, ingestID, eventID string) {
	t.Helper()
	a := testAssignment(ingestID)
	a.EventID = eventID
	mustApply(t, st, time.Now().UTC(), a)
}

func wantCandidates(t *testing.T, got []string, want ...string) {
	t.Helper()
	if want == nil {
		want = []string{}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("candidates = %v, want %v", got, want)
	}
}

func TestCandidates_AtoB_BLiveBeforeBSession_BothCandidates(t *testing.T) {
	st := openTestStore(t)
	closedSessionAt(t, st, "A", "X", time.Now().UTC().Add(-time.Hour))
	cachedFor(t, st, "X", "B")
	wantCandidates(t, candidates(t, st, "X"), "A", "B")
}

func TestCandidates_AtoB_AfterBActiveSession_OnlyB(t *testing.T) {
	st := openTestStore(t)
	closedSessionAt(t, st, "A", "X", time.Now().UTC().Add(-time.Hour))
	cachedFor(t, st, "X", "B")
	if _, err := st.CreateSession(context.Background(), "B", "X", "pb-X", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	wantCandidates(t, candidates(t, st, "X"), "B")
}

func TestCandidates_BtoA_ALiveBeforeASession_BothCandidates(t *testing.T) {
	st := openTestStore(t)
	closedSessionAt(t, st, "B", "X", time.Now().UTC().Add(-time.Hour))
	cachedFor(t, st, "X", "A")
	wantCandidates(t, candidates(t, st, "X"), "A", "B")
}

func TestCandidates_StaleClosedSessionPlusCurrentAssignment(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	cachedFor(t, st, "X", "A")
	if _, err := st.CreateSession(ctx, "A", "X", "pb-X", time.Now().UTC().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReconcileStaleActive(ctx, time.Now().UTC(), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	wantCandidates(t, candidates(t, st, "X"), "A")
}

func TestCandidates_OldOpenSessionPlusNewCachedAssignment_BothCandidates(t *testing.T) {
	st := openTestStore(t)
	if _, err := st.CreateSession(context.Background(), "A", "X", "pb-X", time.Now().UTC().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	cachedFor(t, st, "X", "B")
	wantCandidates(t, candidates(t, st, "X"), "A", "B")
}

func TestCandidates_UnknownIngest_NoCandidates(t *testing.T) {
	st := openTestStore(t)
	wantCandidates(t, candidates(t, st, "nothing-here"))
}

func TestCandidates_MostRecentChosenByParsedTime_NotString(t *testing.T) {
	st := openTestStore(t)
	// "…:00Z" sorts AFTER "…:00.5Z" as text ('Z' > '.'), but is earlier in time.
	base := time.Now().UTC().Truncate(time.Second).Add(-time.Hour)
	closedSessionAt(t, st, "A", "X", base)                           // whole-second, earlier
	closedSessionAt(t, st, "B", "X", base.Add(500*time.Millisecond)) // fractional, later
	wantCandidates(t, candidates(t, st, "X"), "B")
}

func TestCandidates_ResolutionError_Surfaced(t *testing.T) {
	st := openTestStore(t)
	cachedFor(t, st, "X", "A")
	st.Close()
	got, err := st.ResolveLiveIngestCandidates(context.Background(), "X")
	if err == nil || got != nil {
		t.Fatalf("got=%v err=%v, want an error and no partial result", got, err)
	}
}
