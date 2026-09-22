package common

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMemoryRequestLimitsAtomicAdmissionAndSlidingWindow(t *testing.T) {
	var limiter UserRequestLimiter
	now := time.Date(2026, 9, 22, 0, 0, 0, 0, time.UTC)
	lease, denied, _, err := limiter.acquireMemory("user", 1, 2, time.Minute, now)
	require.NoError(t, err)
	require.Equal(t, RequestLimitAllowed, denied)
	_, denied, _, err = limiter.acquireMemory("user", 1, 2, time.Minute, now)
	require.NoError(t, err)
	assert.Equal(t, RequestLimitConcurrency, denied)
	lease.Release()
	lease.Release()
	second, denied, _, err := limiter.acquireMemory("user", 1, 2, time.Minute, now.Add(10*time.Second))
	require.NoError(t, err)
	require.Equal(t, RequestLimitAllowed, denied, "a concurrency rejection must not consume rate budget")
	second.Release()
	_, denied, retry, err := limiter.acquireMemory("user", 1, 2, time.Minute, now.Add(20*time.Second))
	require.NoError(t, err)
	assert.Equal(t, RequestLimitRate, denied)
	assert.Equal(t, 40, retry)
	next, denied, _, err := limiter.acquireMemory("user", 1, 2, time.Minute, now.Add(time.Minute))
	require.NoError(t, err)
	require.Equal(t, RequestLimitAllowed, denied, "rate rejection must not leak a concurrency slot")
	next.Release()
}

func TestRequestLimitsCoordinateContendingRequests(t *testing.T) {
	for _, useRedis := range []bool{false, true} {
		name := "memory"
		if useRedis {
			name = "redis"
		}
		t.Run(name, func(t *testing.T) {
			var client *redis.Client
			if useRedis {
				server := miniredis.RunT(t)
				client = redis.NewClient(&redis.Options{Addr: server.Addr()})
				t.Cleanup(func() { _ = client.Close() })
			}
			var limiter UserRequestLimiter
			type result struct {
				lease  *RequestLimitLease
				denied int
				err    error
			}
			results := make(chan result, 8)
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					// A second limiter represents another server sharing Redis.
					target := &limiter
					if useRedis {
						target = &UserRequestLimiter{}
					}
					lease, denied, _, err := target.Acquire(context.Background(), client, "test:{user}", 2, 0, 0, func() {})
					results <- result{lease, denied, err}
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			accepted := 0
			for result := range results {
				require.NoError(t, result.err)
				if result.denied == RequestLimitAllowed {
					accepted++
					result.lease.Release()
				} else {
					assert.Equal(t, RequestLimitConcurrency, result.denied)
				}
			}
			assert.Equal(t, 2, accepted)
			lease, denied, _, err := limiter.Acquire(context.Background(), client, "test:{user}", 2, 0, 0, func() {})
			require.NoError(t, err)
			assert.Equal(t, RequestLimitAllowed, denied)
			lease.Release()
		})
	}
}

func TestRedisRequestLimitsSlidingWindowAndLeaseRecovery(t *testing.T) {
	server := miniredis.RunT(t)
	now := time.Date(2026, 9, 22, 0, 0, 0, 0, time.UTC)
	server.SetTime(now)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	var limiter UserRequestLimiter
	ctx := context.Background()
	lease, denied, _, err := limiter.Acquire(ctx, client, "test:{rate}", 1, 2, time.Minute, func() {})
	require.NoError(t, err)
	require.Equal(t, RequestLimitAllowed, denied)
	t.Cleanup(lease.Release)
	_, denied, _, err = limiter.Acquire(ctx, client, "test:{rate}", 1, 2, time.Minute, func() {})
	require.NoError(t, err)
	assert.Equal(t, RequestLimitConcurrency, denied)
	lease.Release()
	server.SetTime(now.Add(10 * time.Second))
	next, denied, _, err := limiter.Acquire(ctx, client, "test:{rate}", 1, 2, time.Minute, func() {})
	require.NoError(t, err)
	require.Equal(t, RequestLimitAllowed, denied)
	next.Release()
	_, denied, retry, err := limiter.Acquire(ctx, client, "test:{rate}", 1, 2, time.Minute, func() {})
	require.NoError(t, err)
	assert.Equal(t, RequestLimitRate, denied)
	assert.Equal(t, 50, retry)
	server.SetTime(now.Add(time.Minute))
	next, denied, _, err = limiter.Acquire(ctx, client, "test:{rate}", 1, 2, time.Minute, func() {})
	require.NoError(t, err)
	require.Equal(t, RequestLimitAllowed, denied)
	next.Release()

	// A crashed process leaves a lease; expiry allows another request, and a stale
	// owner's eventual release must not remove the replacement owner's slot.
	result, err := acquireRequestLimitScript.Run(ctx, client, []string{"test:{lease}:active", "test:{lease}:rate"}, 1, 0, 0, "crashed", requestLeaseTTL.Milliseconds()).Int64Slice()
	require.NoError(t, err)
	require.Equal(t, int64(0), result[0])
	server.SetTime(now.Add(time.Minute + requestLeaseTTL + time.Millisecond))
	replacement, denied, _, err := limiter.Acquire(ctx, client, "test:{lease}", 1, 0, 0, func() {})
	require.NoError(t, err)
	require.Equal(t, RequestLimitAllowed, denied)
	t.Cleanup(replacement.Release)
	require.NoError(t, client.ZRem(ctx, "test:{lease}:active", "crashed").Err())
	_, denied, _, err = limiter.Acquire(ctx, client, "test:{lease}", 1, 0, 0, func() {})
	require.NoError(t, err)
	assert.Equal(t, RequestLimitConcurrency, denied)
}

func TestRedisRequestLeaseRenewalKeepsLongRequestsCounted(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	ctx := context.Background()
	now := time.Date(2026, 9, 22, 0, 0, 0, 0, time.UTC)
	server.SetTime(now)
	keys := []string{"test:{stream}:active", "test:{stream}:rate"}
	_, err := acquireRequestLimitScript.Run(ctx, client, keys, 1, 0, 0, "stream", requestLeaseTTL.Milliseconds()).Int64Slice()
	require.NoError(t, err)
	server.SetTime(now.Add(time.Minute))
	renewed, err := renewRequestLeaseScript.Run(ctx, client, keys[:1], "stream", requestLeaseTTL.Milliseconds()).Int()
	require.NoError(t, err)
	require.Equal(t, 1, renewed)
	server.SetTime(now.Add(requestLeaseTTL + time.Second))
	var limiter UserRequestLimiter
	_, denied, _, err := limiter.Acquire(ctx, client, "test:{stream}", 1, 0, 0, func() {})
	require.NoError(t, err)
	assert.Equal(t, RequestLimitConcurrency, denied, "renewed stream must still occupy a slot beyond its original lease")
	server.SetTime(now.Add(time.Minute + requestLeaseTTL + time.Second))
	renewed, err = renewRequestLeaseScript.Run(ctx, client, keys[:1], "stream", requestLeaseTTL.Milliseconds()).Int()
	require.NoError(t, err)
	assert.Equal(t, 0, renewed, "an expired lease must not be resurrected")
}
