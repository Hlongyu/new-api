package common

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
)

// Both limits are admitted atomically: a rejected request consumes neither budget.
const (
	RequestLimitAllowed       = 0
	RequestLimitConcurrency   = 1
	RequestLimitRate          = 2
	requestLeaseTTL           = 2 * time.Minute
	requestLeaseRenewInterval = 30 * time.Second
)

var acquireRequestLimitScript = redis.NewScript(`
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local concurrent = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if concurrent > 0 and redis.call('ZCARD', KEYS[1]) >= concurrent then
 return {1, 0}
end
if rate > 0 then
 redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - window)
 if redis.call('ZCARD', KEYS[2]) >= rate then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  return {2, math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))}
 end
end
if concurrent > 0 then
 redis.call('ZADD', KEYS[1], now + tonumber(ARGV[5]), ARGV[4])
 redis.call('PEXPIRE', KEYS[1], ARGV[5])
end
if rate > 0 then
 redis.call('ZADD', KEYS[2], now, ARGV[4])
 redis.call('PEXPIRE', KEYS[2], window)
end
return {0, 0}
`)

var renewRequestLeaseScript = redis.NewScript(`
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local expires = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not expires or tonumber(expires) <= now then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`)

type requestLimitPool struct {
	active   int
	arrivals []time.Time
	expires  time.Time
}

// UserRequestLimiter is process-local without Redis; Redis coordinates all instances.
// Keep a single limiter per server. Never fall back to memory on a Redis failure.
type UserRequestLimiter struct {
	mu          sync.Mutex
	pools       map[string]*requestLimitPool
	nextCleanup time.Time
}

type RequestLimitLease struct {
	once    sync.Once
	release func()
}

func (l *RequestLimitLease) Release() {
	if l != nil {
		l.once.Do(l.release)
	}
}

func (l *UserRequestLimiter) Acquire(ctx context.Context, client *redis.Client, key string, concurrent, rate int, window time.Duration, cancel context.CancelFunc) (*RequestLimitLease, int, int, error) {
	if concurrent == 0 && rate == 0 {
		return nil, RequestLimitAllowed, 0, nil
	}
	if client == nil {
		return l.acquireMemory(key, concurrent, rate, window, time.Now())
	}
	token := GetUUID()
	activeKey, rateKey := key+":active", key+":rate"
	opCtx, stop := context.WithTimeout(ctx, 2*time.Second)
	values, err := acquireRequestLimitScript.Run(opCtx, client, []string{activeKey, rateKey}, concurrent, rate, window.Milliseconds(), token, requestLeaseTTL.Milliseconds()).Int64Slice()
	stop()
	if err != nil {
		return nil, 0, 0, err
	}
	if len(values) != 2 {
		return nil, 0, 0, fmt.Errorf("invalid request limit response")
	}
	if values[0] != RequestLimitAllowed {
		return nil, int(values[0]), int(values[1]), nil
	}
	if concurrent == 0 {
		return nil, RequestLimitAllowed, 0, nil
	}
	done := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		ticker := time.NewTicker(requestLeaseRenewInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				// Renew until the handler actually exits, including while cancellation unwinds.
				renewCtx, stop := context.WithTimeout(context.Background(), 2*time.Second)
				renewed, err := renewRequestLeaseScript.Run(renewCtx, client, []string{activeKey}, token, requestLeaseTTL.Milliseconds()).Int()
				stop()
				if err != nil || renewed != 1 {
					SysError(fmt.Sprintf("request concurrency lease lost for %s: %v", key, err))
					cancel()
					return
				}
			}
		}
	}()
	lease := &RequestLimitLease{release: func() {
		close(done)
		<-finished
		releaseCtx, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		if err := client.ZRem(releaseCtx, activeKey, token).Err(); err != nil {
			SysError(fmt.Sprintf("request concurrency release failed for %s: %v", key, err))
		}
	}}
	return lease, RequestLimitAllowed, 0, nil
}

func (l *UserRequestLimiter) acquireMemory(key string, concurrent, rate int, window time.Duration, now time.Time) (*RequestLimitLease, int, int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.pools == nil {
		l.pools = make(map[string]*requestLimitPool)
	}
	if !now.Before(l.nextCleanup) {
		for key, pool := range l.pools {
			if pool.active == 0 && !now.Before(pool.expires) {
				delete(l.pools, key)
			}
		}
		l.nextCleanup = now.Add(time.Minute)
	}
	pool := l.pools[key]
	if pool == nil {
		pool = &requestLimitPool{}
		l.pools[key] = pool
	}
	if concurrent > 0 && pool.active >= concurrent {
		return nil, RequestLimitConcurrency, 0, nil
	}
	if rate > 0 {
		cutoff := now.Add(-window)
		first := 0
		for first < len(pool.arrivals) && !pool.arrivals[first].After(cutoff) {
			first++
		}
		pool.arrivals = pool.arrivals[first:]
		if len(pool.arrivals) >= rate {
			remaining := pool.arrivals[0].Add(window).Sub(now)
			retry := int((remaining + time.Second - 1) / time.Second)
			return nil, RequestLimitRate, retry, nil
		}
		pool.arrivals = append(pool.arrivals, now)
		pool.expires = now.Add(window)
	}
	if concurrent == 0 {
		return nil, RequestLimitAllowed, 0, nil
	}
	pool.active++
	lease := &RequestLimitLease{release: func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		pool.active--
		if pool.active == 0 && len(pool.arrivals) == 0 {
			delete(l.pools, key)
		}
	}}
	return lease, RequestLimitAllowed, 0, nil
}
