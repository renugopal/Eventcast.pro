package autofinalize

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/telemetry"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/upload"
)

// ---------------------------------------------------------------- fixtures

func openStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "agent.sqlite3"), 5*time.Second)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func assignment(ingestID, eventID string, publishable bool) store.Assignment {
	now := time.Now().UTC()
	a := store.Assignment{
		IngestID: ingestID, EventID: eventID, PlaybackID: "pb-" + ingestID,
		SecretTokenHash: store.HashToken("tok-" + ingestID), Enabled: true,
		PublishWindowStartAt: now.Add(-time.Hour), PublishWindowEndAt: now.Add(time.Hour),
		ConfigVersion: "1", UpdatedAt: now,
	}
	if !publishable {
		a.PublishWindowStartAt = now.Add(-6 * time.Hour)
		a.PublishWindowEndAt = now.Add(-5 * time.Hour)
	}
	return a
}

func syncCP(t *testing.T, st *store.Store, as ...store.Assignment) {
	t.Helper()
	if _, _, err := st.ApplyControlPlaneAssignments(context.Background(), as, time.Now().UTC()); err != nil {
		t.Fatalf("ApplyControlPlaneAssignments: %v", err)
	}
}

func openSession(t *testing.T, st *store.Store, eventID, ingestID string) store.Session {
	t.Helper()
	s, err := st.CreateSession(context.Background(), eventID, ingestID, "pb-"+ingestID, time.Now().UTC().Add(-time.Minute))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return s
}

func endedSession(t *testing.T, st *store.Store, eventID, ingestID string, ago time.Duration) {
	t.Helper()
	s := openSession(t, st, eventID, ingestID)
	if err := st.MarkDisconnected(context.Background(), s.ID, store.EndReasonUnpublish, time.Now().UTC().Add(-ago)); err != nil {
		t.Fatalf("MarkDisconnected: %v", err)
	}
}

// endedEvent: an event whose only assignment was publishable, then revoked
// by a sync, with one session that ended `ago` ago -> pending 'revoked'
// intent.
func endedEvent(t *testing.T, st *store.Store, eventID string, ago time.Duration) {
	t.Helper()
	ingest := "ing-" + eventID
	syncCP(t, st, assignment(ingest, eventID, true))
	endedSession(t, st, eventID, ingest, ago)
	syncCP(t, st) // revoke
}

type fakeFin struct {
	calls atomic.Int32
	fn    func(ctx context.Context, eventID string) (upload.FinalizeResult, error)
}

func (f *fakeFin) Finalize(ctx context.Context, eventID string) (upload.FinalizeResult, error) {
	f.calls.Add(1)
	if f.fn != nil {
		return f.fn(ctx, eventID)
	}
	return upload.FinalizeResult{Finalized: true, Generation: "gen-1"}, nil
}

func okFin(gen string) *fakeFin {
	return &fakeFin{fn: func(context.Context, string) (upload.FinalizeResult, error) {
		return upload.FinalizeResult{Finalized: true, Generation: gen}, nil
	}}
}

type fakeSRS struct {
	mu      sync.Mutex
	streams []telemetry.SRSStream
	err     error
}

func (f *fakeSRS) FetchStreams(context.Context) ([]telemetry.SRSStream, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.streams, f.err
}

func (f *fakeSRS) set(names ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.streams = nil
	for _, n := range names {
		f.streams = append(f.streams, telemetry.SRSStream{Name: n, Publish: telemetry.SRSPublishInfo{Active: true}})
	}
}

func cfg() Config {
	return Config{Enabled: true, Interval: time.Hour, QuietPeriod: 0, Grace: 3 * time.Hour, Lease: 3 * time.Minute,
		RetryBaseDelay: time.Minute, RetryMaxDelay: time.Hour}
}

func guardFor(st intentStore, fin Finalizer, srs StreamLister, c Config) *Guard {
	return newGuard(st, fin, srs, NewRegistry(), c, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
}

func intent(t *testing.T, st *store.Store, eventID string) store.FinalizationIntent {
	t.Helper()
	in, _, err := st.GetFinalizationIntent(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetFinalizationIntent: %v", err)
	}
	return in
}

func blocked(t *testing.T, g *Guard, eventID string) bool {
	t.Helper()
	b, err := g.PublishBlocked(context.Background(), eventID, time.Now().UTC())
	if err != nil {
		t.Fatalf("PublishBlocked: %v", err)
	}
	return b
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// blockingFin blocks inside Finalize until release is closed.
type blockingFin struct {
	started      chan struct{}
	release      chan struct{}
	result       upload.FinalizeResult
	calls        atomic.Int32
	ignoreCancel time.Duration
}

func newBlockingFin(res upload.FinalizeResult) *blockingFin {
	return &blockingFin{started: make(chan struct{}, 4), release: make(chan struct{}), result: res}
}

func (b *blockingFin) Finalize(ctx context.Context, _ string) (upload.FinalizeResult, error) {
	b.calls.Add(1)
	b.started <- struct{}{}
	select {
	case <-b.release:
		return b.result, nil
	case <-ctx.Done():
		if b.ignoreCancel > 0 {
			time.Sleep(b.ignoreCancel)
		}
		return upload.FinalizeResult{}, ctx.Err()
	}
}

// failingCompleteStore injects a CompleteFinalizationIntent failure.
type failingCompleteStore struct {
	*store.Store
	err error
}

func (f failingCompleteStore) CompleteFinalizationIntent(context.Context, string, int64, string, store.IntentOutcome, time.Time) (bool, error) {
	return false, f.err
}

type resolveErrStore struct{ *store.Store }

func (resolveErrStore) ResolveLiveIngestCandidates(context.Context, string) ([]string, error) {
	return nil, errors.New("resolve failed")
}

func discard() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// ------------------------------------------------------------- lifecycle

func TestRevocationWhileActive_NeverFinalizes(t *testing.T) {
	st := openStore(t)
	syncCP(t, st, assignment("ing-e1", "e1", true))
	openSession(t, st, "e1", "ing-e1")
	syncCP(t, st) // End while still publishing
	fin := okFin("g")
	srs := &fakeSRS{}
	srs.set("ing-e1")
	guardFor(st, fin, srs, cfg()).RunOnce(context.Background())
	if fin.calls.Load() != 0 {
		t.Fatalf("finalizer called %d times while session open", fin.calls.Load())
	}
	if in := intent(t, st, "e1"); in.State != store.IntentPending || in.LastSkipReason != store.SkipSessionOpen {
		t.Fatalf("intent = %+v, want pending/session_open", in)
	}
}

func TestUnpublishBeforeEnd_WaitsThenFinalizesAfterQuiet(t *testing.T) {
	st := openStore(t)
	syncCP(t, st, assignment("ing-e1", "e1", true))
	endedSession(t, st, "e1", "ing-e1", time.Second) // on_unpublish first, still publishable
	fin := okFin("g1")
	c := cfg()
	c.QuietPeriod = 50 * time.Millisecond
	g := guardFor(st, fin, &fakeSRS{}, c)
	g.RunOnce(context.Background())
	if fin.calls.Load() != 0 {
		t.Fatal("finalized before End")
	}
	syncCP(t, st) // End
	g.RunOnce(context.Background())
	if in := intent(t, st, "e1"); in.State != store.IntentFinalized || in.FinalizedGeneration != "g1" {
		t.Fatalf("intent = %+v, want finalized g1", in)
	}
}

func TestUnpublishAfterEnd_FinalizesAfterQuiet(t *testing.T) {
	st := openStore(t)
	syncCP(t, st, assignment("ing-e1", "e1", true))
	s := openSession(t, st, "e1", "ing-e1")
	syncCP(t, st) // End first
	fin := okFin("g")
	c := cfg()
	c.QuietPeriod = 100 * time.Millisecond
	g := guardFor(st, fin, &fakeSRS{}, c)
	g.RunOnce(context.Background())
	if err := st.MarkDisconnected(context.Background(), s.ID, store.EndReasonUnpublish, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	g.RunOnce(context.Background())
	if fin.calls.Load() != 0 {
		t.Fatal("finalized inside the quiet period")
	}
	time.Sleep(150 * time.Millisecond)
	g.RunOnce(context.Background())
	if intent(t, st, "e1").State != store.IntentFinalized {
		t.Fatal("not finalized after the quiet period")
	}
}

func TestRestartWhilePending_Resumes(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	guardFor(st, okFin("g"), &fakeSRS{}, cfg()).RunOnce(context.Background()) // "new process"
	if intent(t, st, "e1").State != store.IntentFinalized {
		t.Fatal("pending intent not resumed")
	}
}

func TestRestartWhileFinalizing_RecoversClaimAndFinalizesOnce(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	// A crashed attempt: claim held, intent finalizing, no registry entry.
	if _, err := st.ClaimFinalization(context.Background(), "e1", store.ClaimInput{Now: time.Now().UTC(), Lease: time.Hour}); err != nil {
		t.Fatal(err)
	}
	if err := RecoverStaleClaims(context.Background(), st, discard(), nil); err != nil {
		t.Fatal(err)
	}
	fin := okFin("g")
	g := guardFor(st, fin, &fakeSRS{}, cfg())
	g.RunOnce(context.Background())
	g.RunOnce(context.Background())
	if fin.calls.Load() != 1 || intent(t, st, "e1").State != store.IntentFinalized {
		t.Fatalf("calls=%d intent=%+v, want exactly one finalize", fin.calls.Load(), intent(t, st, "e1"))
	}
}

func TestDuplicateRevocation_SingleFinalization(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	syncCP(t, st)
	syncCP(t, st)
	fin := okFin("g")
	g := guardFor(st, fin, &fakeSRS{}, cfg())
	g.RunOnce(context.Background())
	g.RunOnce(context.Background())
	if fin.calls.Load() != 1 {
		t.Fatalf("calls=%d, want 1", fin.calls.Load())
	}
}

func TestFailedIntentResetOnReactivation_NeverRunsStale(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	failing := &fakeFin{fn: func(context.Context, string) (upload.FinalizeResult, error) {
		return upload.FinalizeResult{}, errors.New("boom")
	}}
	g := guardFor(st, failing, &fakeSRS{}, cfg())
	g.RunOnce(context.Background())
	if in := intent(t, st, "e1"); in.State != store.IntentFailed {
		t.Fatalf("intent = %+v, want failed", in)
	}
	syncCP(t, st, assignment("ing-e1", "e1", true)) // reactivation
	in := intent(t, st, "e1")
	if in.State != store.IntentCancelled || in.LastErrorCategory != "" || !in.NextAttemptAt.IsZero() {
		t.Fatalf("intent = %+v, want clean cancelled", in)
	}
	g.RunOnce(context.Background())
	if failing.calls.Load() != 1 {
		t.Fatalf("stale failed intent ran again: calls=%d", failing.calls.Load())
	}
}

func TestFinalizedThenReactivation_NewPublishAcceptedAndNewCycleFinalizes(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	g := guardFor(st, okFin("g1"), &fakeSRS{}, cfg())
	g.RunOnce(context.Background())
	first := intent(t, st, "e1")
	syncCP(t, st, assignment("ing-e1", "e1", true)) // reactivate
	if blocked(t, g, "e1") {
		t.Fatal("finalized intent blocked a new publish cycle")
	}
	endedSession(t, st, "e1", "ing-e1", time.Minute)
	syncCP(t, st) // End again
	g.fin = okFin("g2")
	g.RunOnce(context.Background())
	in := intent(t, st, "e1")
	if in.State != store.IntentFinalized || in.FinalizedGeneration != "g2" || in.Cycle != first.Cycle+1 {
		t.Fatalf("intent = %+v, want finalized g2 at cycle+1", in)
	}
}

func TestWindowExpiryDuringControlPlaneOutage_Finalizes(t *testing.T) {
	st := openStore(t)
	syncCP(t, st, assignment("ing-e1", "e1", false)) // expired window, never revoked (outage)
	endedSession(t, st, "e1", "ing-e1", 4*time.Hour)
	c := cfg()
	c.Grace = time.Hour
	guardFor(st, okFin("g"), &fakeSRS{}, c).RunOnce(context.Background())
	in := intent(t, st, "e1")
	if in.Cause != store.IntentCauseWindowExpired || in.State != store.IntentFinalized {
		t.Fatalf("intent = %+v, want finalized via window_expired", in)
	}
}

func TestStaleSessionResolution_ThenFinalizes(t *testing.T) {
	st := openStore(t)
	syncCP(t, st, assignment("ing-e1", "e1", true))
	openSession(t, st, "e1", "ing-e1")
	syncCP(t, st)
	g := guardFor(st, okFin("g"), &fakeSRS{}, cfg())
	g.RunOnce(context.Background())
	if intent(t, st, "e1").State == store.IntentFinalized {
		t.Fatal("finalized with an open session")
	}
	if _, err := st.ReconcileStaleActive(context.Background(), time.Now().UTC().Add(time.Minute), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	g.RunOnce(context.Background())
	if intent(t, st, "e1").State != store.IntentFinalized {
		t.Fatal("not finalized after stale-session resolution")
	}
}

func TestPreRolloutSessions_NeverAutoFinalized(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", 2*time.Hour)
	fin := okFin("g")
	c := cfg()
	c.RolloutCutoff = time.Now().UTC().Add(-time.Hour)
	g := guardFor(st, fin, &fakeSRS{}, c)
	g.RunOnce(context.Background())
	g.RunOnce(context.Background())
	if fin.calls.Load() != 0 || intent(t, st, "e1").LastSkipReason != store.SkipPreRolloutSession {
		t.Fatalf("pre-rollout processed: calls=%d", fin.calls.Load())
	}
}

func TestDisabledConfig_NoClaims(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	fin := okFin("g")
	c := cfg()
	c.Enabled = false
	guardFor(st, fin, &fakeSRS{}, c).RunOnce(context.Background())
	if fin.calls.Load() != 0 || intent(t, st, "e1").State != store.IntentPending {
		t.Fatal("disabled AutoFinalizer acted")
	}
}

// ------------------------------------------------------------------- SRS

func TestSRS_StillPublishing_NeverFinalizes(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	srs := &fakeSRS{}
	srs.set("ing-e1") // encoder still visible after End
	fin := okFin("g")
	guardFor(st, fin, srs, cfg()).RunOnce(context.Background())
	if fin.calls.Load() != 0 || intent(t, st, "e1").LastSkipReason != store.SkipSRSIngestActive {
		t.Fatalf("finalized while SRS live: calls=%d", fin.calls.Load())
	}
}

func TestSRS_Unavailable_FailsClosed_AttemptNotCounted(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	fin := okFin("g")
	guardFor(st, fin, &fakeSRS{err: errors.New("down")}, cfg()).RunOnce(context.Background())
	in := intent(t, st, "e1")
	if fin.calls.Load() != 0 || in.State != store.IntentPending || in.LastSkipReason != store.SkipSRSUnavailable || in.Attempts != 0 {
		t.Fatalf("intent = %+v calls=%d, want pending/srs_unavailable, 0 attempts", in, fin.calls.Load())
	}
}

func TestSRS_UnattributedLiveStream_FailsClosed(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	srs := &fakeSRS{}
	srs.set("unknown-ingest")
	fin := okFin("g")
	g := guardFor(st, fin, srs, cfg())
	g.RunOnce(context.Background())
	in := intent(t, st, "e1")
	if fin.calls.Load() != 0 || in.LastSkipReason != store.SkipSRSAttributionUnknown || in.Attempts != 0 {
		t.Fatalf("intent = %+v calls=%d, want attribution_unknown, not counted", in, fin.calls.Load())
	}
	// Once the stream is attributable to another event, e1 may proceed.
	syncCP(t, st, assignment("unknown-ingest", "other", true))
	g.RunOnce(context.Background())
	if intent(t, st, "e1").State != store.IntentFinalized {
		t.Fatal("e1 not finalized once the stream became attributable elsewhere")
	}
}

func TestSRS_UnattributedLiveStream_RecoveryLeavesFinalizedUntouched(t *testing.T) {
	st := openStore(t)
	finalizedEvent(t, st, "g1")
	before := intent(t, st, "e1")
	srs := &fakeSRS{}
	srs.set("unknown-ingest")
	fin := okFin("g2")
	res, err := guardFor(st, fin, srs, cfg()).Finalize(context.Background(), "e1")
	if err != nil || res.Finalized || fin.calls.Load() != 0 {
		t.Fatalf("res=%+v err=%v calls=%d, want fail-closed skip", res, err, fin.calls.Load())
	}
	if after := intent(t, st, "e1"); after != before {
		t.Fatalf("recovery changed finalized intent:\nbefore=%+v\nafter=%+v", before, after)
	}
}

func TestSRS_MovedAway_NewOwnerActive_DoesNotBlockOld(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "A", time.Hour)
	syncCP(t, st, assignment("ing-A", "B", true)) // ingest moved A -> B
	openSession(t, st, "B", "ing-A")
	srs := &fakeSRS{}
	srs.set("ing-A")
	guardFor(st, okFin("g"), srs, cfg()).RunOnce(context.Background())
	if intent(t, st, "A").State != store.IntentFinalized {
		t.Fatalf("A = %+v, want finalized (live stream belongs to B)", intent(t, st, "A"))
	}
}

func TestSRS_MovedAway_NewOwnerNotYetRecorded_BlocksOldFailClosed(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "A", time.Hour)
	syncCP(t, st, assignment("ing-A", "B", true)) // B live in SRS, no B session yet
	srs := &fakeSRS{}
	srs.set("ing-A")
	fin := okFin("g")
	guardFor(st, fin, srs, cfg()).RunOnce(context.Background())
	if fin.calls.Load() != 0 || intent(t, st, "A").LastSkipReason != store.SkipSRSIngestActive {
		t.Fatalf("A finalized while its old ingest might still be A's: calls=%d", fin.calls.Load())
	}
}

func TestSRS_ResolutionError_FailsClosed(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	srs := &fakeSRS{}
	srs.set("ing-e1")
	fin := okFin("g")
	guardFor(resolveErrStore{st}, fin, srs, cfg()).RunOnce(context.Background())
	in := intent(t, st, "e1")
	if fin.calls.Load() != 0 || in.LastSkipReason != store.SkipSRSUnavailable || in.Attempts != 0 {
		t.Fatalf("intent = %+v, want srs_unavailable fail closed", in)
	}
}

// ------------------------------------------------------- lease / races

func TestFinalizerOutlivesOriginalLease_RenewalKeepsPublishBlocked(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	fin := newBlockingFin(upload.FinalizeResult{Finalized: true, Generation: "g"})
	c := cfg()
	c.Lease = 300 * time.Millisecond
	g := guardFor(st, fin, &fakeSRS{}, c)
	done := make(chan struct{})
	go func() { g.RunOnce(context.Background()); close(done) }()
	<-fin.started
	start := time.Now()
	for _, target := range []time.Duration{400 * time.Millisecond, 900 * time.Millisecond, 1400 * time.Millisecond} {
		time.Sleep(time.Until(start.Add(target)))
		if !blocked(t, g, "e1") {
			t.Fatalf("publish not blocked at +%v", target)
		}
		// Durable lease alone (ignoring the registry) must also still be live.
		if active, _ := st.HasActiveFinalizationClaim(context.Background(), "e1", time.Now().UTC()); !active {
			t.Fatalf("durable lease expired at +%v despite renewal", target)
		}
	}
	close(fin.release)
	<-done
	if blocked(t, g, "e1") {
		t.Fatal("publish still blocked after finalize returned")
	}
}

func TestReactivationDuringLongFinalization(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	before := intent(t, st, "e1")
	fin := newBlockingFin(upload.FinalizeResult{Finalized: true, Generation: "g-old"})
	g := guardFor(st, fin, &fakeSRS{}, cfg())
	done := make(chan upload.FinalizeResult, 1)
	go func() {
		res, _ := g.attempt(context.Background(), "e1", store.ClaimInput{Now: time.Now().UTC(), Lease: g.cfg.Lease})
		done <- res
	}()
	<-fin.started

	syncCP(t, st, assignment("ing-e1", "e1", true)) // reactivation mid-finalize
	mid := intent(t, st, "e1")
	if mid.State != store.IntentCancelled || mid.Cycle != before.Cycle+1 {
		t.Fatalf("intent = %+v, want cancelled at cycle+1", mid)
	}
	if !blocked(t, g, "e1") {
		t.Fatal("new publish allowed while the old finalizer is still running")
	}

	close(fin.release)
	res := <-done
	if res.Finalized {
		t.Fatal("superseded attempt reported Finalized=true")
	}
	if after := intent(t, st, "e1"); after != mid {
		t.Fatalf("stale completion changed the new cycle:\nmid=%+v\nafter=%+v", mid, after)
	}
	if blocked(t, g, "e1") {
		t.Fatal("publish still blocked after the old finalizer returned")
	}
	// Only now is a real new publish accepted: the session can be created.
	openSession(t, st, "e1", "ing-e1")
}

func TestPublishUnblocksOnlyAfterFinalizerReturns(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	fin := newBlockingFin(upload.FinalizeResult{})
	fin.ignoreCancel = 500 * time.Millisecond
	c := cfg()
	c.Lease = 150 * time.Millisecond
	g := guardFor(st, fin, &fakeSRS{}, c)
	done := make(chan struct{})
	go func() { g.RunOnce(context.Background()); close(done) }()
	<-fin.started
	// Delete the claim underneath the renewer: the next renewal fails and
	// cancels the finalize context, but the fake ignores cancellation.
	claim, _, _ := st.GetFinalizationClaim(context.Background(), "e1")
	if err := st.ReleaseFinalizationClaim(context.Background(), "e1", claim.Token); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond) // renewal has failed by now
	if !blocked(t, g, "e1") {
		t.Fatal("publish unblocked while the finalizer is still running (registry must hold)")
	}
	<-done
	if blocked(t, g, "e1") {
		t.Fatal("publish still blocked after the finalizer returned")
	}
}

func TestProcessCrash_RenewalStops_PublishEventuallyReleased(t *testing.T) {
	t.Run("startup-recovery", func(t *testing.T) {
		st := openStore(t)
		endedEvent(t, st, "e1", time.Hour)
		if _, err := st.ClaimFinalization(context.Background(), "e1", store.ClaimInput{Now: time.Now().UTC(), Lease: time.Hour}); err != nil {
			t.Fatal(err)
		}
		g := guardFor(st, okFin("g"), &fakeSRS{}, cfg()) // new process
		if !blocked(t, g, "e1") {
			t.Fatal("orphan claim should block before recovery")
		}
		if err := RecoverStaleClaims(context.Background(), st, discard(), nil); err != nil {
			t.Fatal(err)
		}
		if blocked(t, g, "e1") {
			t.Fatal("still blocked after startup recovery")
		}
	})
	t.Run("lease-expiry-backstop", func(t *testing.T) {
		st := openStore(t)
		endedEvent(t, st, "e1", time.Hour)
		if _, err := st.ClaimFinalization(context.Background(), "e1", store.ClaimInput{Now: time.Now().UTC(), Lease: 100 * time.Millisecond}); err != nil {
			t.Fatal(err)
		}
		g := guardFor(st, okFin("g"), &fakeSRS{}, cfg())
		if !blocked(t, g, "e1") {
			t.Fatal("unexpired orphan claim must block")
		}
		waitFor(t, func() bool { return !blocked(t, g, "e1") })
	})
}

func TestOperatorFinalize_UsesSameClaimGuard(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	fin := newBlockingFin(upload.FinalizeResult{Finalized: true, Generation: "g"})
	g := guardFor(st, fin, &fakeSRS{}, cfg())
	done := make(chan struct{})
	go func() { g.RunOnce(context.Background()); close(done) }()
	<-fin.started
	res, err := g.Finalize(context.Background(), "e1")
	if err != nil || res.Finalized || res.Reason != reasonText(store.SkipClaimHeld) {
		t.Fatalf("operator res=%+v err=%v, want claim_held while background attempt runs", res, err)
	}
	close(fin.release)
	<-done
	if fin.calls.Load() != 1 {
		t.Fatalf("finalizer calls=%d, want 1", fin.calls.Load())
	}
}

// -------------------------------------------------------------- operator

func TestFinalizeOperator_RefusedWhilePublishable_NoIntentNoClaim(t *testing.T) {
	st := openStore(t)
	syncCP(t, st, assignment("ing-e1", "e1", true))
	endedSession(t, st, "e1", "ing-e1", time.Hour)
	fin := okFin("g")
	res, err := guardFor(st, fin, &fakeSRS{}, cfg()).Finalize(context.Background(), "e1")
	if err != nil || res.Finalized || fin.calls.Load() != 0 {
		t.Fatalf("res=%+v err=%v calls=%d", res, err, fin.calls.Load())
	}
	if _, found, _ := st.GetFinalizationIntent(context.Background(), "e1"); found {
		t.Fatal("intent created while publishable")
	}
	if _, found, _ := st.GetFinalizationClaim(context.Background(), "e1"); found {
		t.Fatal("claim created while publishable")
	}
}

func TestFinalizeOperator_SRSActiveOrUnavailable_FailsClosed(t *testing.T) {
	for _, name := range []string{"active", "unavailable"} {
		t.Run(name, func(t *testing.T) {
			st := openStore(t)
			endedEvent(t, st, "e1", time.Hour)
			srs := &fakeSRS{}
			if name == "active" {
				srs.set("ing-e1")
			} else {
				srs.err = errors.New("down")
			}
			fin := okFin("g")
			res, err := guardFor(st, fin, srs, cfg()).Finalize(context.Background(), "e1")
			if err != nil || res.Finalized || fin.calls.Load() != 0 {
				t.Fatalf("res=%+v err=%v calls=%d, want fail-closed skip", res, err, fin.calls.Load())
			}
		})
	}
}

func TestFinalizeOperator_BypassesQuietAndCutoff(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", 5*time.Second)
	c := cfg()
	c.QuietPeriod = time.Hour
	c.RolloutCutoff = time.Now().UTC()
	g := guardFor(st, okFin("g"), &fakeSRS{}, c)
	g.RunOnce(context.Background())
	if intent(t, st, "e1").State == store.IntentFinalized {
		t.Fatal("background bypassed quiet/cutoff")
	}
	res, err := g.Finalize(context.Background(), "e1")
	if err != nil || !res.Finalized || intent(t, st, "e1").State != store.IntentFinalized {
		t.Fatalf("operator res=%+v err=%v, want finalized", res, err)
	}
}

func TestFinalizeOperator_HistoricalEvent_BackgroundNeverProcesses(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", 2*time.Hour)
	c := cfg()
	c.RolloutCutoff = time.Now().UTC().Add(-time.Hour)
	c.RetryBaseDelay = time.Millisecond
	c.RetryMaxDelay = time.Millisecond
	failing := &fakeFin{fn: func(context.Context, string) (upload.FinalizeResult, error) {
		return upload.FinalizeResult{}, errors.New("boom")
	}}
	g := guardFor(st, failing, &fakeSRS{}, c)
	if _, err := g.Finalize(context.Background(), "e1"); err == nil {
		t.Fatal("expected operator failure")
	}
	time.Sleep(5 * time.Millisecond)
	g.RunOnce(context.Background())
	g.RunOnce(context.Background())
	if failing.calls.Load() != 1 || intent(t, st, "e1").LastSkipReason != store.SkipPreRolloutSession {
		t.Fatalf("background processed a historical event: calls=%d intent=%+v", failing.calls.Load(), intent(t, st, "e1"))
	}
}

// -------------------------------------------------------------- recovery

func finalizedEvent(t *testing.T, st *store.Store, gen string) {
	t.Helper()
	endedEvent(t, st, "e1", time.Hour)
	guardFor(st, okFin(gen), &fakeSRS{}, cfg()).RunOnce(context.Background())
	if in := intent(t, st, "e1"); in.State != store.IntentFinalized || in.FinalizedGeneration != gen {
		t.Fatalf("setup: intent = %+v", in)
	}
}

func TestRecovery_SkipsAndErrors_RemainFinalized(t *testing.T) {
	for _, name := range []string{"srs-unavailable", "srs-active", "finalizer-error", "not-eligible"} {
		t.Run(name, func(t *testing.T) {
			st := openStore(t)
			finalizedEvent(t, st, "g1")
			srs := &fakeSRS{}
			var fin Finalizer = okFin("g2")
			switch name {
			case "srs-unavailable":
				srs.err = errors.New("down")
			case "srs-active":
				srs.set("ing-e1")
			case "finalizer-error":
				fin = &fakeFin{fn: func(context.Context, string) (upload.FinalizeResult, error) {
					return upload.FinalizeResult{}, errors.New("boom")
				}}
			case "not-eligible":
				fin = &fakeFin{fn: func(context.Context, string) (upload.FinalizeResult, error) {
					return upload.FinalizeResult{Reason: "segments unresolved"}, nil
				}}
			}
			before := intent(t, st, "e1")
			_, _ = guardFor(st, fin, srs, cfg()).Finalize(context.Background(), "e1")
			if after := intent(t, st, "e1"); after != before {
				t.Fatalf("recovery changed finalized intent:\nbefore=%+v\nafter=%+v", before, after)
			}
			if _, found, _ := st.GetFinalizationClaim(context.Background(), "e1"); found {
				t.Fatal("recovery claim not released")
			}
		})
	}
}

func TestRecovery_SuccessUnchangedGeneration_RemainsFinalized(t *testing.T) {
	st := openStore(t)
	finalizedEvent(t, st, "g1")
	before := intent(t, st, "e1")
	res, err := guardFor(st, okFin("g1"), &fakeSRS{}, cfg()).Finalize(context.Background(), "e1")
	if err != nil || !res.Finalized {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if after := intent(t, st, "e1"); after != before {
		t.Fatalf("unchanged-generation recovery changed intent:\nbefore=%+v\nafter=%+v", before, after)
	}
}

func TestRecovery_SuccessNewGeneration_GenerationUpdated(t *testing.T) {
	st := openStore(t)
	finalizedEvent(t, st, "g1")
	before := intent(t, st, "e1")
	time.Sleep(2 * time.Millisecond)
	if _, err := guardFor(st, okFin("g2"), &fakeSRS{}, cfg()).Finalize(context.Background(), "e1"); err != nil {
		t.Fatal(err)
	}
	after := intent(t, st, "e1")
	if after.State != store.IntentFinalized || after.FinalizedGeneration != "g2" || after.Cycle != before.Cycle || !after.FinalizedAt.After(before.FinalizedAt) {
		t.Fatalf("after = %+v, want finalized g2, same cycle, later finalized_at", after)
	}
}

func TestRecovery_ReactivationDuringRecovery_CannotRestoreFinalized(t *testing.T) {
	st := openStore(t)
	finalizedEvent(t, st, "g1")
	fin := newBlockingFin(upload.FinalizeResult{Finalized: true, Generation: "g2"})
	g := guardFor(st, fin, &fakeSRS{}, cfg())
	done := make(chan upload.FinalizeResult, 1)
	go func() { res, _ := g.Finalize(context.Background(), "e1"); done <- res }()
	<-fin.started
	syncCP(t, st, assignment("ing-e1", "e1", true))
	mid := intent(t, st, "e1")
	if mid.State != store.IntentCancelled || !blocked(t, g, "e1") {
		t.Fatalf("mid = %+v, want cancelled and publish still blocked", mid)
	}
	close(fin.release)
	if res := <-done; res.Finalized {
		t.Fatal("superseded recovery reported Finalized=true")
	}
	if after := intent(t, st, "e1"); after != mid || after.FinalizedGeneration != "" {
		t.Fatalf("recovery restored finalized state over the new cycle: %+v", after)
	}
	if blocked(t, g, "e1") {
		t.Fatal("publish still blocked after recovery returned")
	}
}

func TestRecovery_BackgroundLoopNeverStartsRecovery(t *testing.T) {
	st := openStore(t)
	finalizedEvent(t, st, "g1")
	fin := okFin("g2")
	g := guardFor(st, fin, &fakeSRS{}, cfg())
	g.RunOnce(context.Background())
	g.RunOnce(context.Background())
	if fin.calls.Load() != 0 {
		t.Fatalf("background started a recovery: calls=%d", fin.calls.Load())
	}
}

// -------------------------------------------------- persistence failures

var errStore = errors.New("store write failed")

func TestFinalizedResult_CompletionDBError_CallerGetsError(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	res, err := guardFor(failingCompleteStore{st, errStore}, okFin("g"), &fakeSRS{}, cfg()).Finalize(context.Background(), "e1")
	if err == nil || !errors.Is(err, errStore) || res.Finalized {
		t.Fatalf("res=%+v err=%v, want store error, not success", res, err)
	}
	if _, found, _ := st.GetFinalizationClaim(context.Background(), "e1"); found {
		t.Fatal("claim not released after completion error")
	}
}

func TestNotEligible_CompletionDBError_CallerGetsError(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	fin := &fakeFin{fn: func(context.Context, string) (upload.FinalizeResult, error) {
		return upload.FinalizeResult{Reason: "x"}, nil
	}}
	_, err := guardFor(failingCompleteStore{st, errStore}, fin, &fakeSRS{}, cfg()).Finalize(context.Background(), "e1")
	if !errors.Is(err, errStore) {
		t.Fatalf("err=%v, want store error", err)
	}
}

func TestSRSSkip_CompletionDBError_CallerGetsError(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	_, err := guardFor(failingCompleteStore{st, errStore}, okFin("g"), &fakeSRS{err: errors.New("down")}, cfg()).Finalize(context.Background(), "e1")
	if !errors.Is(err, errStore) {
		t.Fatalf("err=%v, want store error rather than a skip result", err)
	}
}

func TestFinalizerError_FailedStatePersistenceError_SurfacedWithOriginalContext(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	finErr := errors.New("finalizer exploded")
	fin := &fakeFin{fn: func(context.Context, string) (upload.FinalizeResult, error) { return upload.FinalizeResult{}, finErr }}
	_, err := guardFor(failingCompleteStore{st, errStore}, fin, &fakeSRS{}, cfg()).Finalize(context.Background(), "e1")
	if !errors.Is(err, finErr) || !errors.Is(err, errStore) {
		t.Fatalf("err=%v, want both the finalizer and the persistence error", err)
	}
	if !strings.Contains(err.Error(), "category=finalizer_error") {
		t.Fatalf("err=%q, want it to mention category=finalizer_error", err)
	}
}

func TestSuperseded_CleanCAS_NonErrorAndNewCycleUntouched(t *testing.T) {
	st := openStore(t)
	endedEvent(t, st, "e1", time.Hour)
	fin := newBlockingFin(upload.FinalizeResult{Finalized: true, Generation: "g"})
	g := guardFor(st, fin, &fakeSRS{}, cfg())
	type out struct {
		res upload.FinalizeResult
		err error
	}
	done := make(chan out, 1)
	go func() { r, e := g.Finalize(context.Background(), "e1"); done <- out{r, e} }()
	<-fin.started
	syncCP(t, st, assignment("ing-e1", "e1", true))
	mid := intent(t, st, "e1")
	close(fin.release)
	o := <-done
	if o.err != nil || o.res.Finalized || o.res.Reason == "" {
		t.Fatalf("res=%+v err=%v, want non-error superseded result", o.res, o.err)
	}
	if after := intent(t, st, "e1"); after != mid {
		t.Fatalf("superseded completion changed the new cycle:\nmid=%+v\nafter=%+v", mid, after)
	}
}
