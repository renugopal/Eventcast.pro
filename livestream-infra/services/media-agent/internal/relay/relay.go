// Package relay implements optional per-session YouTube restream
// supervision (02_V1_ARCHITECTURE_SPEC.md "YouTube relay", ADR-012).
// It is an independent failure domain: nothing in this package ever
// touches segment_jobs, ingest_sessions, or manifest state, and a relay
// failure never fails the primary EventCast stream.
package relay

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// Config configures Supervisor.
type Config struct {
	FFmpegPath         string
	RestartMaxAttempts int
	RestartBackoffBase time.Duration
	RestartBackoffMax  time.Duration
	// ShutdownTimeout bounds how long Shutdown waits for every running
	// ffmpeg process to exit after being asked to stop.
	ShutdownTimeout time.Duration

	// SourceReadyTimeout bounds a separate, uncounted retry window that
	// begins fresh every time supervise starts (i.e. every relay Start -
	// on_publish for a new or reconnected session). Within this window, a
	// ffmpeg failure that looks like the local RTMP source (this node's
	// own SRS instance) simply was not readable yet - see
	// SourceReadyMinRunDuration - is retried at SourceReadyRetryInterval
	// without incrementing the restart-attempt count, touching
	// restart_count, or waiting out the exponential backoff. This exists
	// because SRS's on_publish callback (which is what triggers
	// maybeStartRelay) can fire before SRS has buffered enough of the
	// just-connected publisher's stream to serve a puller, so the very
	// first pull attempt - and, after a publisher reconnect starts a
	// fresh session and therefore a fresh relay, every such first attempt
	// again - can race a source that is not genuinely readable yet,
	// independent of whether the relay or the destination is healthy.
	// The zero value disables this entirely (every failure counts
	// immediately, the pre-milestone behavior), so existing callers that
	// do not set it are unaffected.
	SourceReadyTimeout time.Duration
	// SourceReadyMinRunDuration is how long ffmpeg must run before its
	// exit is treated as a genuine failure rather than a source-not-ready
	// symptom. The zero value disables the startup-race allowance
	// (every failure counts immediately, matching SourceReadyTimeout's
	// zero-value behavior).
	SourceReadyMinRunDuration time.Duration
	// SourceReadyRetryInterval is the delay between uncounted retries
	// while still inside SourceReadyTimeout's window; unlike
	// RestartBackoffBase/Max, this stays fixed (no exponential growth)
	// since it exists to poll a source that is expected to become ready
	// within a few seconds, not to back off from a persistently failing
	// destination.
	SourceReadyRetryInterval time.Duration
}

// Target identifies one session's relay: where to pull from (this
// node's own SRS instance - never secret) and where to publish (the
// destination, which does carry the YouTube stream key and must never
// be logged whole).
type Target struct {
	EventID   string
	SessionID string
	// SourceURL is a local RTMP URL (this Media Agent's own SRS
	// instance); it carries no secret.
	SourceURL string
	// DestinationBaseURL is the non-secret RTMP(S) ingest base (e.g.
	// "rtmp://a.rtmp.youtube.com/live2").
	DestinationBaseURL string
	// StreamKey is the secret suffix appended to DestinationBaseURL to
	// form the real destination URL, held only in memory (see
	// internal/store.Assignment "YouTubeStreamKey" - never persisted to
	// SQLite).
	StreamKey logging.Secret
}

func (t Target) destinationURL() string {
	return strings.TrimSuffix(t.DestinationBaseURL, "/") + "/" + t.StreamKey.Reveal()
}

// Supervisor supervises zero or more concurrently running relay
// processes, one per active session.
type Supervisor struct {
	store  *store.Store
	cfg    Config
	logger *slog.Logger

	mu      sync.Mutex
	running map[string]context.CancelFunc
	wg      sync.WaitGroup
}

// New returns a Supervisor. logger must not be nil.
func New(st *store.Store, cfg Config, logger *slog.Logger) *Supervisor {
	return &Supervisor{store: st, cfg: cfg, logger: logger, running: make(map[string]context.CancelFunc)}
}

// Start begins supervising target in its own goroutine and returns
// immediately. It is idempotent: calling it again for a session that is
// already being supervised is a no-op, so a duplicate on_publish or a
// caller that does not track relay state itself cannot start two ffmpeg
// processes for one session.
func (s *Supervisor) Start(parent context.Context, target Target) error {
	s.mu.Lock()
	if _, exists := s.running[target.SessionID]; exists {
		s.mu.Unlock()
		return nil
	}
	runCtx, cancel := context.WithCancel(parent)
	s.running[target.SessionID] = cancel
	s.mu.Unlock()

	if err := s.store.UpsertRelayStarting(context.Background(), target.EventID, target.SessionID, time.Now().UTC()); err != nil {
		s.mu.Lock()
		delete(s.running, target.SessionID)
		s.mu.Unlock()
		cancel()
		return fmt.Errorf("relay: record starting state: %w", err)
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer func() {
			s.mu.Lock()
			delete(s.running, target.SessionID)
			s.mu.Unlock()
		}()
		s.supervise(runCtx, target)
	}()
	return nil
}

// Stop cleanly stops sessionID's relay, if one is running. It does not
// block for the process to exit; callers that need that guarantee use
// Shutdown.
func (s *Supervisor) Stop(sessionID string) {
	s.mu.Lock()
	cancel, ok := s.running[sessionID]
	s.mu.Unlock()
	if ok {
		cancel()
	}
}

// Shutdown stops every running relay and waits up to
// cfg.ShutdownTimeout for all of them to exit.
func (s *Supervisor) Shutdown() {
	s.mu.Lock()
	for _, cancel := range s.running {
		cancel()
	}
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()

	timeout := s.cfg.ShutdownTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	select {
	case <-done:
	case <-time.After(timeout):
		s.logger.Warn("relay: shutdown timed out waiting for supervised processes to exit")
	}
}

// supervise runs target's ffmpeg process, restarting it with bounded
// exponential backoff on unexpected exit, until ctx is cancelled (a
// clean stop) or the restart budget is exhausted (a terminal failure,
// recorded only against this session's own relay row - see ADR-012). A
// fresh SourceReadyTimeout window (see Config) starts every time
// supervise is entered, giving a short-lived race against the local
// source's readiness a chance to resolve itself without spending any of
// the restart budget.
func (s *Supervisor) supervise(ctx context.Context, target Target) {
	attempts := 0
	sourceReadyDeadline := time.Now().Add(s.cfg.SourceReadyTimeout)
	for {
		if ctx.Err() != nil {
			s.markStopped(target.SessionID)
			return
		}

		startedAt := time.Now()
		runErr := s.runOnce(ctx, target)
		ranFor := time.Since(startedAt)

		if ctx.Err() != nil {
			s.markStopped(target.SessionID)
			return
		}

		if runErr != nil && isStartupSourceNotReady(runErr) && ranFor < s.cfg.SourceReadyMinRunDuration && time.Now().Before(sourceReadyDeadline) {
			s.logger.Info("relay: local source not yet readable, retrying without spending the restart budget",
				slog.String("event_id", target.EventID), slog.String("session_id", target.SessionID),
				slog.Duration("ran_for", ranFor), slog.String("error", runErr.Error()))
			retryInterval := s.cfg.SourceReadyRetryInterval
			if retryInterval <= 0 {
				retryInterval = 100 * time.Millisecond
			}
			select {
			case <-ctx.Done():
				s.markStopped(target.SessionID)
				return
			case <-time.After(retryInterval):
			}
			continue
		}

		attempts++
		reason := "ffmpeg exited cleanly but the session is still active"
		if runErr != nil {
			reason = runErr.Error()
		}
		if attempts >= s.cfg.RestartMaxAttempts {
			if err := s.store.MarkRelayFailed(context.Background(), target.SessionID, sanitize(reason), time.Now().UTC()); err != nil {
				s.logger.Error("relay: mark failed failed", slog.String("session_id", target.SessionID), slog.String("error", err.Error()))
			}
			s.logger.Error("relay: restart budget exhausted, giving up",
				slog.String("event_id", target.EventID), slog.String("session_id", target.SessionID), slog.Int("attempts", attempts))
			return
		}

		if err := s.store.IncrementRelayRestart(context.Background(), target.SessionID, sanitize(reason), time.Now().UTC()); err != nil {
			s.logger.Error("relay: increment restart failed", slog.String("session_id", target.SessionID), slog.String("error", err.Error()))
		}
		delay := restartBackoff(attempts, s.cfg.RestartBackoffBase, s.cfg.RestartBackoffMax)
		s.logger.Warn("relay: process exited, restarting",
			slog.String("event_id", target.EventID), slog.String("session_id", target.SessionID),
			slog.Int("attempt", attempts), slog.Duration("delay", delay))

		select {
		case <-ctx.Done():
			s.markStopped(target.SessionID)
			return
		case <-time.After(delay):
		}
	}
}

// isStartupSourceNotReady reports whether an ffmpeg failure is a verified
// local-input startup symptom that may use the bounded uncounted retry window.
// It is intentionally fail-closed: unknown diagnostics and every output-side
// diagnostic consume the normal restart budget. Output evidence is checked
// first because ffmpeg can include more than one diagnostic in its stderr.
func isStartupSourceNotReady(err error) bool {
	if err == nil {
		return false
	}

	diagnostic := strings.ToLower(err.Error())
	if strings.Contains(diagnostic, "[out#") || strings.Contains(diagnostic, "error opening output") {
		return false
	}

	return strings.Contains(diagnostic, "error opening input") ||
		strings.Contains(diagnostic, "invalid data found when processing input")
}

func (s *Supervisor) markStopped(sessionID string) {
	if err := s.store.MarkRelayStopped(context.Background(), sessionID, time.Now().UTC()); err != nil {
		s.logger.Error("relay: mark stopped failed", slog.String("session_id", sessionID), slog.String("error", err.Error()))
	}
}

// runOnce starts ffmpeg, waits for it to exit, and returns a redacted,
// loggable error describing why (nil for a clean exit). No shell is
// ever involved: arguments are passed as an explicit array
// (09_CLAUDE_CODE_EXECUTION_RULES.md "All subprocess arguments must
// avoid shell interpolation").
func (s *Supervisor) runOnce(ctx context.Context, target Target) error {
	dest := target.destinationURL()
	cmd := exec.CommandContext(ctx, s.cfg.FFmpegPath,
		"-loglevel", "error",
		"-i", target.SourceURL,
		"-c", "copy",
		"-f", "flv",
		dest,
	)
	// Bound captured stderr so a noisy or wedged ffmpeg cannot exhaust
	// memory; only the tail is kept, which is what matters for
	// diagnosing why it exited.
	stderr := newBoundedBuffer(4096)
	cmd.Stderr = stderr
	// A clean shutdown asks ffmpeg to stop (SIGTERM) instead of the
	// exec package's default immediate Kill; WaitDelay still bounds how
	// long that grace period lasts before forcing termination, so
	// Supervisor.Shutdown always completes.
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start ffmpeg: %s", sanitize(err.Error()))
	}

	if err := s.store.MarkRelayRunning(context.Background(), target.SessionID, time.Now().UTC()); err != nil {
		s.logger.Error("relay: mark running failed", slog.String("session_id", target.SessionID), slog.String("error", err.Error()))
	}
	s.logger.Info("relay running", slog.String("event_id", target.EventID), slog.String("session_id", target.SessionID))

	err := cmd.Wait()
	if ctx.Err() != nil {
		return nil // context cancellation is a clean stop, not a failure
	}
	if err != nil {
		return fmt.Errorf("ffmpeg exited: %s (stderr: %s)", sanitize(err.Error()), sanitize(stderr.String()))
	}
	return nil
}

// sanitize redacts a raw destination URL or stream key that ffmpeg's
// own stderr banner commonly echoes (e.g. "Output #0, flv, to
// 'rtmp://.../<key>':"), bounds message length, and strips newlines.
// destinationURL/StreamKey are never passed to this function directly;
// it operates on whatever text ffmpeg produced, which is the only
// remaining path a secret could otherwise reach a log line through.
func sanitize(msg string) string {
	// The caller-visible message never has direct access to the
	// original Target here, so redaction is regex-free and
	// pattern-based: collapse anything that looks like an rtmp(s):// URL
	// entirely, since any part of it may carry a stream key.
	const maxLen = 2048
	var b strings.Builder
	i := 0
	for i < len(msg) {
		if strings.HasPrefix(msg[i:], "rtmp://") || strings.HasPrefix(msg[i:], "rtmps://") {
			end := strings.IndexAny(msg[i:], " '\"\n\r\t")
			if end == -1 {
				b.WriteString("[REDACTED_RTMP_URL]")
				break
			}
			b.WriteString("[REDACTED_RTMP_URL]")
			i += end
			continue
		}
		r := msg[i]
		if r == '\n' || r == '\r' {
			r = ' '
		}
		b.WriteByte(r)
		i++
	}
	s := b.String()
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s
}

// boundedBuffer is an io.Writer that retains only the last max bytes
// written to it.
type boundedBuffer struct {
	mu  sync.Mutex
	max int
	buf bytes.Buffer
}

func newBoundedBuffer(max int) *boundedBuffer {
	return &boundedBuffer{max: max}
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.buf.Write(p)
	if excess := b.buf.Len() - b.max; excess > 0 {
		b.buf.Next(excess)
	}
	return len(p), nil
}

func (b *boundedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func restartBackoff(attempt int, base, maxDelay time.Duration) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	d := base
	for i := 1; i < attempt && d < maxDelay; i++ {
		d *= 2
	}
	if d > maxDelay {
		d = maxDelay
	}
	return d
}
