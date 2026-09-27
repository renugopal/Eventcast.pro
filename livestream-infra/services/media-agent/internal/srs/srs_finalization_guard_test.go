package srs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/autofinalize"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// fakeGuard is a PublishGuard with a fixed answer (stands in for the
// in-process registry half of the guard).
type fakeGuard struct {
	blocked bool
	err     error
}

func (f fakeGuard) PublishBlocked(context.Context, string, time.Time) (bool, error) {
	return f.blocked, f.err
}

func TestOnPublish_RejectedWhileRegistryEntryPresent(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	env.handlers.Finalization = fakeGuard{blocked: true}
	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if resp["code"] == float64(0) || resp["error"] != "STATE_CONFLICT" {
		t.Fatalf("resp = %v, want STATE_CONFLICT while a finalization is running", resp)
	}
}

func TestOnPublish_GuardErrorFailsClosed(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", nil)
	env.handlers.Finalization = fakeGuard{err: errors.New("db down")}
	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if resp["error"] != "STATE_CONFLICT" {
		t.Fatalf("resp = %v, want STATE_CONFLICT when the guard cannot be evaluated", resp)
	}
}

const guardEvent = "event-teststream"

// endedNonPublishable seeds teststream with an expired window and one ended
// session, then creates a pending intent (real store APIs only).
func endedNonPublishable(t *testing.T, env *testEnv) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	env.seedAssignment(t, "teststream", func(a *store.Assignment) {
		a.PublishWindowStartAt = now.Add(-3 * time.Hour)
		a.PublishWindowEndAt = now.Add(-2 * time.Hour)
	})
	sess, err := env.store.CreateSession(ctx, guardEvent, "teststream", "pb-teststream", now.Add(-2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := env.store.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if created, pub, err := env.store.CreateFinalizationIntent(ctx, guardEvent, store.IntentCauseOperator, now); err != nil || pub || !created {
		t.Fatalf("CreateFinalizationIntent created=%v pub=%v err=%v", created, pub, err)
	}
}

func claimNow(t *testing.T, env *testEnv, lease time.Duration) store.ClaimResult {
	t.Helper()
	res, err := env.store.ClaimFinalization(context.Background(), guardEvent, store.ClaimInput{Now: time.Now().UTC(), Lease: lease})
	if err != nil || !res.Claimed {
		t.Fatalf("claim res=%+v err=%v", res, err)
	}
	return res
}

// completeAndRelease drives a claimed intent to out.State via the real
// token-aware CAS, then releases the claim.
func completeAndRelease(t *testing.T, env *testEnv, c store.ClaimResult, out store.IntentOutcome) {
	t.Helper()
	ctx := context.Background()
	applied, err := env.store.CompleteFinalizationIntent(ctx, guardEvent, c.Cycle, c.Token, out, time.Now().UTC())
	if err != nil || !applied {
		t.Fatalf("complete applied=%v err=%v", applied, err)
	}
	if err := env.store.ReleaseFinalizationClaim(ctx, guardEvent, c.Token); err != nil {
		t.Fatal(err)
	}
}

// durableClaim leaves an ACTIVE claim with the given lease, then re-seeds the
// assignment publishable (assignment writes never touch claims).
func durableClaim(t *testing.T, env *testEnv, lease time.Duration) {
	t.Helper()
	endedNonPublishable(t, env)
	claimNow(t, env, lease)
	env.seedAssignment(t, "teststream", nil)
}

func realGuard(env *testEnv) *autofinalize.Guard {
	// Fresh Registry: no in-process entry for any event.
	return autofinalize.New(env.store, nil, nil, autofinalize.NewRegistry(), autofinalize.Config{}, env.handlers.Logger, nil)
}

func TestOnPublish_RejectedWhileUnexpiredClaimRow(t *testing.T) {
	env := newTestEnv(t)
	durableClaim(t, env, time.Hour)
	env.handlers.Finalization = realGuard(env)
	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", "token-for-teststream"))
	if resp["error"] != "STATE_CONFLICT" {
		t.Fatalf("resp = %v, want STATE_CONFLICT while an unexpired claim exists", resp)
	}
}

func TestOnPublish_AcceptedWithExpiredClaimAndNoRegistryEntry(t *testing.T) {
	env := newTestEnv(t)
	durableClaim(t, env, time.Millisecond)
	time.Sleep(5 * time.Millisecond)
	env.handlers.Finalization = realGuard(env)
	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", "token-for-teststream"))
	if resp["code"] != float64(0) {
		t.Fatalf("resp = %v, want accepted once the claim lease has expired", resp)
	}
}

func TestOnPublish_AcceptedForPublishableAssignmentWithNonBlockingIntent(t *testing.T) {
	for _, state := range []string{store.IntentPending, store.IntentFinalized, store.IntentFailed, store.IntentCancelled} {
		t.Run(state, func(t *testing.T) {
			env := newTestEnv(t)
			ctx := context.Background()
			endedNonPublishable(t, env) // -> pending

			switch state {
			case store.IntentFinalized:
				completeAndRelease(t, env, claimNow(t, env, time.Hour),
					store.IntentOutcome{State: store.IntentFinalized, Generation: "gen-1"})
			case store.IntentFailed:
				completeAndRelease(t, env, claimNow(t, env, time.Hour),
					store.IntentOutcome{State: store.IntentFailed, ErrorCategory: "finalizer_error", NextAttemptAt: time.Now().Add(time.Hour)})
			case store.IntentCancelled:
				// A real control-plane reactivation (rule R1) of the same ingest id.
				now := time.Now().UTC()
				cp := store.Assignment{
					IngestID: "teststream", EventID: guardEvent, PlaybackID: "pb-teststream",
					SecretTokenHash: store.HashToken("token-for-teststream"), Enabled: true,
					PublishWindowStartAt: now.Add(-time.Hour), PublishWindowEndAt: now.Add(time.Hour),
					ConfigVersion: "2", UpdatedAt: now,
				}
				if _, _, err := env.store.ApplyControlPlaneAssignments(ctx, []store.Assignment{cp}, now); err != nil {
					t.Fatal(err)
				}
			}

			// Make the assignment publishable WITHOUT touching the intent
			// (ImportAssignments never runs R1), except for the cancelled case,
			// which the control-plane sync above already made publishable.
			if state != store.IntentCancelled {
				env.seedAssignment(t, "teststream", nil)
			}

			in, found, err := env.store.GetFinalizationIntent(ctx, guardEvent)
			if err != nil || !found || in.State != state {
				t.Fatalf("precondition: intent=%+v found=%v err=%v, want state %s", in, found, err, state)
			}
			if _, found, err := env.store.GetFinalizationClaim(ctx, guardEvent); err != nil || found {
				t.Fatalf("precondition: claim found=%v err=%v, want no claim", found, err)
			}
			if pub, err := env.store.EventPublishable(ctx, guardEvent, time.Now().UTC()); err != nil || !pub {
				t.Fatalf("precondition: publishable=%v err=%v, want publishable", pub, err)
			}

			env.handlers.Finalization = realGuard(env) // fresh registry: no entry
			_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", "token-for-teststream"))
			if resp["code"] != float64(0) {
				t.Fatalf("resp = %v, want accepted: intent state %s alone must never block", resp, state)
			}
		})
	}
}

func TestOnPublish_RejectedAfterWindowEnd_WithGuard(t *testing.T) {
	env := newTestEnv(t)
	token := env.seedAssignment(t, "teststream", func(a *store.Assignment) {
		a.PublishWindowStartAt = time.Now().Add(-2 * time.Hour)
		a.PublishWindowEndAt = time.Now().Add(-time.Minute)
	})
	env.handlers.Finalization = fakeGuard{}
	_, resp := doRequest(t, env.handlers.OnPublish(), publishBody("teststream", token))
	if resp["error"] != "PUBLISH_WINDOW_CLOSED" {
		t.Fatalf("resp = %v, want PUBLISH_WINDOW_CLOSED (grace never extends publishability)", resp)
	}
}
