package service

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCouponRPMPlanAllowsBurstThenQueuesWithinLimit(t *testing.T) {
	const now = int64(1_800_000_000_000)
	nextAt := int64(0)
	expectedWaits := []int64{0, 0, 30_000, 60_000}
	for _, expectedWait := range expectedWaits {
		wait, plannedNextAt, accepted := couponRPMPlan(nextAt, now, 2)
		require.True(t, accepted)
		assert.Equal(t, expectedWait, wait)
		nextAt = plannedNextAt
	}
	wait, _, accepted := couponRPMPlan(nextAt, now, 2)
	assert.False(t, accepted)
	assert.Equal(t, int64(90_000), wait)
}

func TestReserveCouponRPMRedisAtomicallyBoundsQueue(t *testing.T) {
	previousRedisEnabled := common.RedisEnabled
	previousRedisClient := common.RDB
	redisServer := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	require.NoError(t, redisClient.Ping(context.Background()).Err())
	common.RedisEnabled = true
	common.RDB = redisClient
	t.Cleanup(func() {
		_ = redisClient.Close()
		common.RedisEnabled = previousRedisEnabled
		common.RDB = previousRedisClient
	})

	const requestCount = 5
	const now = int64(1_800_000_000_000)
	var acceptedCount atomic.Int64
	var waitGroup sync.WaitGroup
	errorsFound := make(chan error, requestCount)
	waitGroup.Add(requestCount)
	for range requestCount {
		go func() {
			defer waitGroup.Done()
			_, _, accepted, err := reserveCouponRPMRedis(context.Background(), "coupon-rpm-test", 2, now)
			if err != nil {
				errorsFound <- err
				return
			}
			if accepted {
				acceptedCount.Add(1)
			}
		}()
	}
	waitGroup.Wait()
	close(errorsFound)
	for err := range errorsFound {
		require.NoError(t, err)
	}

	assert.Equal(t, int64(4), acceptedCount.Load())
	assert.Greater(t, redisServer.TTL("coupon-rpm-test"), time.Minute)
}
