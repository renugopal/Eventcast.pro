package store

import (
	"context"
	"testing"
	"time"
)

// claimableEvent prepares an event whose only assignment is expired (not
// publishable), with one session that disconnected at disconnectAt, and a
// pending intent. It returns the event id.
func claimableEvent(t *testing.T, st *Store, now, disconnectAt time.Time) string {
	t.Helper()
	ctx := context.Background()
	a := testAssignment("stream-1")
	a.PublishWindowStartAt = now.Add(-5 * time.Hour)
	a.PublishWindowEndAt = now.Add(-4 * time.Hour)
	mustApply(t, st, now, a)
	sess, err := st.CreateSession(ctx, a.EventID, a.IngestID, a.PlaybackID, disconnectAt.Add(-time.Minute))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if err := st.MarkDisconnected(ctx, sess.ID, EndReasonUnpublish, disconnectAt); err != nil {
		t.Fatalf("MarkDisconnected: %v", err)
	}
	if _, pub, err := st.CreateFinalizationIntent(ctx, a.EventID, IntentCauseRevoked, now); err != nil || pub {
		t.Fatalf("CreateFinalizationIntent pub=%v err=%v", pub, err)
	}
	return a.EventID
}

func claimIn(now time.Time) ClaimInput {
	return ClaimInput{Now: now, Lease: time.Minute, QuietPeriod: 2 * time.Minute}
}

func mustClaim(t *testing.T, st *Store, eventID string, in ClaimInput) ClaimResult {
	t.Helper()
	res, err := st.ClaimFinalization(context.Background(), eventID, in)
	if err != nil {
		t.Fatalf("ClaimFinalization error: %v", err)
	}
	if !res.Claimed {
		t.Fatalf("ClaimFinalization not claimed: skip=%s", res.SkipReason)
	}
	return res
}

func complete(t *testing.T, st *Store, eventID string, cycle int64, token string, out IntentOutcome, now time.Time) bool {
	t.Helper()
	ok, err := st.CompleteFinalizationIntent(context.Background(), eventID, cycle, token, out, now)
	if err != nil {
		t.Fatalf("CompleteFinalizationIntent error: %v", err)
	}
	return ok
}

func TestCreateIntent_NoRow_InsertsPendingCycleZero(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	in, _ := intentOf(t, st, ev)
	if in.State != IntentPending || in.Cycle != 0 {
		t.Fatalf("intent = %+v, want pending cycle 0", in)
	}
}

func TestCreateIntent_DuplicateOnPendingFailedFinalizingFinalized_NoOp(t *testing.T) {
	for _, state := range []string{IntentPending, IntentFailed, IntentFinalizing, IntentFinalized} {
		t.Run(state, func(t *testing.T) {
			st := openTestStore(t)
			now := time.Now().UTC()
			ev := claimableEvent(t, st, now, now.Add(-time.Hour))
			setIntentState(t, st, ev, state, 3, "g")
			before, _ := intentOf(t, st, ev)
			if created, _, err := st.CreateFinalizationIntent(context.Background(), ev, IntentCauseOperator, now.Add(time.Minute)); err != nil || created {
				t.Fatalf("created=%v err=%v, want no-op", created, err)
			}
			after, _ := intentOf(t, st, ev)
			if after != before {
				t.Fatalf("duplicate creation changed intent:\nbefore=%+v\nafter=%+v", before, after)
			}
		})
	}
}

func TestCreateIntent_ReopensCancelled_ClearsRetryAndGeneration(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	setIntentState(t, st, ev, IntentCancelled, 2, "gen-old")
	if _, err := st.db.Exec(`UPDATE event_finalization_intents SET attempts=4, last_error_category='x', last_skip_reason='y', next_attempt_at=? WHERE event_id=?`,
		fmtTime(now.Add(time.Hour)), ev); err != nil {
		t.Fatal(err)
	}
	if created, _, err := st.CreateFinalizationIntent(context.Background(), ev, IntentCauseWindowExpired, now); err != nil || !created {
		t.Fatalf("created=%v err=%v, want reopen", created, err)
	}
	in, _ := intentOf(t, st, ev)
	if in.State != IntentPending || in.Cycle != 2 || in.Cause != IntentCauseWindowExpired || in.Attempts != 0 ||
		in.LastErrorCategory != "" || in.LastSkipReason != "" || !in.NextAttemptAt.IsZero() || in.FinalizedGeneration != "" {
		t.Fatalf("reopened intent = %+v, want clean pending at cycle 2", in)
	}
}

func TestCreateIntent_RefusedWhilePublishable(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	a := testAssignment("stream-1")
	mustApply(t, st, now, a)
	created, pub, err := st.CreateFinalizationIntent(context.Background(), a.EventID, IntentCauseOperator, now)
	if err != nil || created || !pub {
		t.Fatalf("created=%v pub=%v err=%v, want refused while publishable", created, pub, err)
	}
}

func TestClaim_InsertsClaimRowAndSetsFinalizingAtCycle_ClearsStaleMetadata(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	if _, err := st.db.Exec(`UPDATE event_finalization_intents SET state='failed', last_error_category='object_store', next_attempt_at=?, last_skip_reason='quiet_period' WHERE event_id=?`,
		fmtTime(now.Add(-time.Second)), ev); err != nil {
		t.Fatal(err)
	}
	res := mustClaim(t, st, ev, claimIn(now))
	in, _ := intentOf(t, st, ev)
	if in.State != IntentFinalizing || in.Cycle != res.Cycle || in.Attempts != 1 {
		t.Fatalf("intent = %+v, want finalizing at claim cycle with 1 attempt", in)
	}
	if in.LastErrorCategory != "" || !in.NextAttemptAt.IsZero() || in.LastSkipReason != "" {
		t.Fatalf("stale metadata survived claim: %+v", in)
	}
	c, found, err := st.GetFinalizationClaim(context.Background(), ev)
	if err != nil || !found || c.Token != res.Token || c.Cycle != res.Cycle {
		t.Fatalf("claim = %+v found=%v err=%v", c, found, err)
	}
}

func TestClaim_RejectedWhileUnexpiredClaimExists(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	mustClaim(t, st, ev, claimIn(now))
	res, err := st.ClaimFinalization(context.Background(), ev, claimIn(now.Add(time.Second)))
	if err != nil || res.Claimed || res.SkipReason != SkipClaimHeld {
		t.Fatalf("second claim = %+v err=%v, want claim_held", res, err)
	}
}

func TestClaim_RequiresEligibleState(t *testing.T) {
	for _, state := range []string{IntentCancelled, IntentFinalized} {
		t.Run(state, func(t *testing.T) {
			st := openTestStore(t)
			now := time.Now().UTC()
			ev := claimableEvent(t, st, now, now.Add(-time.Hour))
			setIntentState(t, st, ev, state, 0, "")
			res, err := st.ClaimFinalization(context.Background(), ev, claimIn(now))
			if err != nil || res.Claimed || res.SkipReason != SkipNoIntent {
				t.Fatalf("claim = %+v err=%v, want not claimable", res, err)
			}
		})
	}
	t.Run("failed-in-backoff", func(t *testing.T) {
		st := openTestStore(t)
		now := time.Now().UTC()
		ev := claimableEvent(t, st, now, now.Add(-time.Hour))
		if _, err := st.db.Exec(`UPDATE event_finalization_intents SET state='failed', next_attempt_at=? WHERE event_id=?`, fmtTime(now.Add(time.Minute)), ev); err != nil {
			t.Fatal(err)
		}
		res, _ := st.ClaimFinalization(context.Background(), ev, claimIn(now))
		if res.Claimed || res.SkipReason != SkipBackoff {
			t.Fatalf("claim = %+v, want retry_backoff", res)
		}
		mustClaim(t, st, ev, claimIn(now.Add(2*time.Minute)))
	})
}

func TestClaim_SkipsOpenSessionQuietPeriodPreRolloutAndPublishable(t *testing.T) {
	now := time.Now().UTC()
	t.Run("quiet-period", func(t *testing.T) {
		st := openTestStore(t)
		ev := claimableEvent(t, st, now, now.Add(-30*time.Second))
		res, _ := st.ClaimFinalization(context.Background(), ev, claimIn(now))
		if res.Claimed || res.SkipReason != SkipQuietPeriod {
			t.Fatalf("claim = %+v, want quiet_period", res)
		}
	})
	t.Run("pre-rollout", func(t *testing.T) {
		st := openTestStore(t)
		ev := claimableEvent(t, st, now, now.Add(-time.Hour))
		in := claimIn(now)
		in.RolloutCutoff = now.Add(-10 * time.Minute)
		res, _ := st.ClaimFinalization(context.Background(), ev, in)
		if res.Claimed || res.SkipReason != SkipPreRolloutSession {
			t.Fatalf("claim = %+v, want pre_rollout_session", res)
		}
	})
	t.Run("open-session", func(t *testing.T) {
		st := openTestStore(t)
		ev := claimableEvent(t, st, now, now.Add(-time.Hour))
		if _, err := st.CreateSession(context.Background(), ev, "stream-1", "pb-stream-1", now.Add(-time.Minute)); err != nil {
			t.Fatal(err)
		}
		res, _ := st.ClaimFinalization(context.Background(), ev, claimIn(now))
		if res.Claimed || res.SkipReason != SkipSessionOpen {
			t.Fatalf("claim = %+v, want session_open", res)
		}
	})
	t.Run("publishable", func(t *testing.T) {
		st := openTestStore(t)
		ev := claimableEvent(t, st, now, now.Add(-time.Hour))
		other := testAssignment("stream-2")
		other.EventID = ev
		if _, err := st.ImportAssignments(context.Background(), []Assignment{other}); err != nil { // seed row, publishable
			t.Fatal(err)
		}
		res, _ := st.ClaimFinalization(context.Background(), ev, claimIn(now))
		if res.Claimed || res.SkipReason != SkipPublishable {
			t.Fatalf("claim = %+v, want assignment_publishable", res)
		}
	})
}

func TestClaim_ExpiredLeaseFinalizing_Reclaimable(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	first := mustClaim(t, st, ev, claimIn(now))
	second := mustClaim(t, st, ev, claimIn(now.Add(2*time.Minute))) // lease 1m expired
	if second.Token == first.Token || second.Cycle != first.Cycle {
		t.Fatalf("reclaim = %+v first=%+v", second, first)
	}
}

func TestRenew_CASByTokenExtendsLease_WorksAfterCycleBump(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	res := mustClaim(t, st, ev, claimIn(now))

	// Reactivation bumps the intent cycle but must leave the claim alone.
	if _, err := reactivateIntentTx(ctx, st.db, ev, now); err != nil {
		t.Fatal(err)
	}
	ok, err := st.RenewFinalizationClaim(ctx, ev, res.Token, now.Add(30*time.Second), time.Minute)
	if err != nil || !ok {
		t.Fatalf("renew ok=%v err=%v, want renewed after cycle bump", ok, err)
	}
	c, _, _ := st.GetFinalizationClaim(ctx, ev)
	if !c.LeaseUntil.Equal(now.Add(90 * time.Second)) {
		t.Fatalf("lease_until = %v, want %v", c.LeaseUntil, now.Add(90*time.Second))
	}
}

func TestRenew_WrongToken_ZeroRows(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	mustClaim(t, st, ev, claimIn(now))
	ok, err := st.RenewFinalizationClaim(context.Background(), ev, "claim_wrong", now, time.Minute)
	if err != nil || ok {
		t.Fatalf("renew ok=%v err=%v, want false", ok, err)
	}
}

func TestReactivation_DuringClaim_BumpsIntentCycle_LeavesClaimUntouched(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	res := mustClaim(t, st, ev, claimIn(now))
	before, _, _ := st.GetFinalizationClaim(ctx, ev)

	// Extend the window so the event is publishable again, then sync.
	a := testAssignment("stream-1")
	mustApply(t, st, now, a)

	in, _ := intentOf(t, st, ev)
	if in.State != IntentCancelled || in.Cycle != res.Cycle+1 {
		t.Fatalf("intent = %+v, want cancelled at cycle+1", in)
	}
	after, found, _ := st.GetFinalizationClaim(ctx, ev)
	if !found || after != before {
		t.Fatalf("claim changed by reactivation: before=%+v after=%+v", before, after)
	}
}

func TestReleaseClaim_DeletesOnlyMatchingToken(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	res := mustClaim(t, st, ev, claimIn(now))
	if err := st.ReleaseFinalizationClaim(ctx, ev, "claim_wrong"); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := st.GetFinalizationClaim(ctx, ev); !found {
		t.Fatal("wrong-token release deleted the claim")
	}
	if err := st.ReleaseFinalizationClaim(ctx, ev, res.Token); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := st.GetFinalizationClaim(ctx, ev); found {
		t.Fatal("matching-token release did not delete the claim")
	}
}

func TestStartupRecovery_DeletesAllClaims(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	mustClaim(t, st, ev, claimIn(now))
	n, err := st.DeleteAllFinalizationClaims(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("DeleteAllFinalizationClaims n=%d err=%v, want 1", n, err)
	}
}

func TestPublishBlocked_ActiveLeaseTrue_ExpiredLeaseFalse(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	mustClaim(t, st, ev, claimIn(now))
	if active, err := st.HasActiveFinalizationClaim(ctx, ev, now.Add(30*time.Second)); err != nil || !active {
		t.Fatalf("active=%v err=%v, want true inside lease", active, err)
	}
	if active, err := st.HasActiveFinalizationClaim(ctx, ev, now.Add(2*time.Minute)); err != nil || active {
		t.Fatalf("active=%v err=%v, want false after lease", active, err)
	}
}

func TestComplete_MatchingTokenSucceeds(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	res := mustClaim(t, st, ev, claimIn(now))
	if !complete(t, st, ev, res.Cycle, res.Token, IntentOutcome{State: IntentFinalized, Generation: "gen-1"}, now) {
		t.Fatal("matching completion not applied")
	}
	in, _ := intentOf(t, st, ev)
	if in.State != IntentFinalized || in.FinalizedGeneration != "gen-1" || in.FinalizedAt.IsZero() ||
		in.LastErrorCategory != "" || in.LastSkipReason != "" || !in.NextAttemptAt.IsZero() {
		t.Fatalf("intent = %+v, want clean finalized with generation", in)
	}
}

func TestComplete_WrongTokenCannotFinalizeFailOrPend(t *testing.T) {
	for _, out := range []IntentOutcome{
		{State: IntentFinalized, Generation: "gen-x"},
		{State: IntentFailed, ErrorCategory: "object_store", NextAttemptAt: time.Now().Add(time.Hour)},
		{State: IntentPending, SkipReason: SkipNotEligible},
	} {
		t.Run(out.State, func(t *testing.T) {
			st := openTestStore(t)
			now := time.Now().UTC()
			ev := claimableEvent(t, st, now, now.Add(-time.Hour))
			res := mustClaim(t, st, ev, claimIn(now))
			before, _ := intentOf(t, st, ev)
			if complete(t, st, ev, res.Cycle, "claim_wrong", out, now) {
				t.Fatal("wrong-token completion applied")
			}
			after, _ := intentOf(t, st, ev)
			if after != before {
				t.Fatalf("intent changed:\nbefore=%+v\nafter=%+v", before, after)
			}
		})
	}
}

func TestComplete_StaleTokenCannotComplete(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	a := mustClaim(t, st, ev, claimIn(now))
	b := mustClaim(t, st, ev, claimIn(now.Add(2*time.Minute))) // A's lease expired and was re-claimed
	if complete(t, st, ev, a.Cycle, a.Token, IntentOutcome{State: IntentFinalized, Generation: "g-a"}, now) {
		t.Fatal("stale token A completed")
	}
	in, _ := intentOf(t, st, ev)
	if in.State != IntentFinalizing {
		t.Fatalf("intent = %+v, want still finalizing under B", in)
	}
	if !complete(t, st, ev, b.Cycle, b.Token, IntentOutcome{State: IntentFinalized, Generation: "g-b"}, now) {
		t.Fatal("current token B did not complete")
	}
}

func TestComplete_ReleasedClaimReturnsNotApplied(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	res := mustClaim(t, st, ev, claimIn(now))
	if err := st.ReleaseFinalizationClaim(context.Background(), ev, res.Token); err != nil {
		t.Fatal(err)
	}
	before, _ := intentOf(t, st, ev)
	if complete(t, st, ev, res.Cycle, res.Token, IntentOutcome{State: IntentFinalized, Generation: "g"}, now) {
		t.Fatal("released-claim completion applied")
	}
	after, _ := intentOf(t, st, ev)
	if after != before {
		t.Fatalf("intent changed: before=%+v after=%+v", before, after)
	}
}

func TestComplete_SupersededByReactivationReturnsNotApplied(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	res := mustClaim(t, st, ev, claimIn(now))
	mustApply(t, st, now, testAssignment("stream-1")) // publishable again -> R1
	if complete(t, st, ev, res.Cycle, res.Token, IntentOutcome{State: IntentFinalized, Generation: "g"}, now) {
		t.Fatal("superseded completion applied")
	}
	in, _ := intentOf(t, st, ev)
	if in.State != IntentCancelled || in.Cycle != res.Cycle+1 || in.FinalizedGeneration != "" {
		t.Fatalf("intent = %+v, want untouched cancelled at cycle+1", in)
	}
}

func TestComplete_SameCycleStaleCompletionCannotOverwriteNewerClaim(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	a := mustClaim(t, st, ev, claimIn(now))
	if !complete(t, st, ev, a.Cycle, a.Token, IntentOutcome{State: IntentFailed, ErrorCategory: "object_store", NextAttemptAt: now.Add(time.Second)}, now) {
		t.Fatal("A failed completion not applied")
	}
	if err := st.ReleaseFinalizationClaim(ctx, ev, a.Token); err != nil {
		t.Fatal(err)
	}
	b := mustClaim(t, st, ev, claimIn(now.Add(2*time.Second)))
	if complete(t, st, ev, a.Cycle, a.Token, IntentOutcome{State: IntentFinalized, Generation: "g-a"}, now) {
		t.Fatal("late duplicate A completion applied")
	}
	in, _ := intentOf(t, st, ev)
	if in.State != IntentFinalizing || in.FinalizedGeneration != "" || in.LastErrorCategory != "" || !in.NextAttemptAt.IsZero() {
		t.Fatalf("intent = %+v, want clean finalizing for B", in)
	}
	_ = b
}

func TestComplete_PendingClearsErrorAndBackoff_FailedClearsSkip(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))

	a := mustClaim(t, st, ev, claimIn(now))
	if !complete(t, st, ev, a.Cycle, a.Token, IntentOutcome{State: IntentFailed, ErrorCategory: "object_store", NextAttemptAt: now.Add(time.Second)}, now) {
		t.Fatal("failed not applied")
	}
	in, _ := intentOf(t, st, ev)
	if in.LastSkipReason != "" || in.LastErrorCategory != "object_store" || in.NextAttemptAt.IsZero() {
		t.Fatalf("failed intent = %+v", in)
	}
	_ = st.ReleaseFinalizationClaim(ctx, ev, a.Token)

	b := mustClaim(t, st, ev, claimIn(now.Add(2*time.Second)))
	if !complete(t, st, ev, b.Cycle, b.Token, IntentOutcome{State: IntentPending, SkipReason: SkipSRSUnavailable, UncountAttempt: true}, now) {
		t.Fatal("pending not applied")
	}
	in, _ = intentOf(t, st, ev)
	if in.State != IntentPending || in.LastSkipReason != SkipSRSUnavailable || in.LastErrorCategory != "" || !in.NextAttemptAt.IsZero() || in.Attempts != 1 {
		t.Fatalf("pending intent = %+v, want skip only, no error/backoff, attempt uncounted (1)", in)
	}
}

func TestComplete_EmptyTokenRejected(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	ev := claimableEvent(t, st, now, now.Add(-time.Hour))
	if _, err := st.CompleteFinalizationIntent(context.Background(), ev, 0, "", IntentOutcome{State: IntentFinalized}, now); err == nil {
		t.Fatal("expected an error for an empty token")
	}
}

func TestWindowExpiredCandidates(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	a := testAssignment("stream-1")
	a.PublishWindowStartAt = now.Add(-8 * time.Hour)
	a.PublishWindowEndAt = now.Add(-4 * time.Hour)
	mustApply(t, st, now, a)
	sess, _ := st.CreateSession(ctx, a.EventID, a.IngestID, a.PlaybackID, now.Add(-5*time.Hour))
	_ = st.MarkDisconnected(ctx, sess.ID, EndReasonUnpublish, now.Add(-4*time.Hour-time.Minute))

	ids, err := st.ListWindowExpiredCandidates(ctx, now, 3*time.Hour, time.Time{})
	if err != nil || len(ids) != 1 || ids[0] != a.EventID {
		t.Fatalf("candidates=%v err=%v, want [%s]", ids, err, a.EventID)
	}
	if ids, _ := st.ListWindowExpiredCandidates(ctx, now, 5*time.Hour, time.Time{}); len(ids) != 0 {
		t.Fatalf("within grace candidates=%v, want none", ids)
	}
	if ids, _ := st.ListWindowExpiredCandidates(ctx, now, 3*time.Hour, now.Add(-time.Hour)); len(ids) != 0 {
		t.Fatalf("pre-cutoff candidates=%v, want none", ids)
	}
}
