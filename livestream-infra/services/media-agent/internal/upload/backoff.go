package upload

import (
	"math/rand"
	"time"
)

// backoffDelay computes an exponential backoff with full jitter,
// bounded by maxDelay: the base delay doubles once per attempt (capped
// before jitter is applied so the cap is exact, not just approximate),
// then the actual delay is chosen uniformly from [0, cap]. Full jitter
// avoids every stalled segment across an event (or across many events on
// one node) synchronizing their retries into the same instant, which
// would otherwise turn one transient R2 blip into a self-inflicted
// retry storm.
func backoffDelay(attempt int, base, maxDelay time.Duration) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	capDelay := base
	for i := 1; i < attempt && capDelay < maxDelay; i++ {
		capDelay *= 2
		if capDelay > maxDelay {
			capDelay = maxDelay
			break
		}
	}
	if capDelay > maxDelay {
		capDelay = maxDelay
	}
	if capDelay <= 0 {
		return 0
	}
	return time.Duration(rand.Int63n(int64(capDelay) + 1))
}
