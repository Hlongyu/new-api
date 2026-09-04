package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaytypes "github.com/QuantumNous/new-api/relaykit/types"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const (
	couponRPMMaxWait         = time.Minute
	couponRPMReservationMark = "coupon_rpm_reserved"
)

const couponRPMRedisScript = `
local current = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local max_wait = tonumber(ARGV[4])
local next_at = tonumber(redis.call('GET', KEYS[1]))

if not next_at or next_at < current then
  next_at = current
end

local wait = next_at - burst - current
if wait < 0 then
  wait = 0
end
if wait > max_wait then
  return {0, wait}
end

local arrival = current + wait
if arrival > next_at then
  next_at = arrival
end
local new_next_at = next_at + interval
redis.call('SET', KEYS[1], new_next_at, 'PX', new_next_at - current + 60000)
return {1, wait}
`

var couponRPMMemory = struct {
	sync.Mutex
	nextAt       map[string]int64
	reservations uint64
}{nextAt: make(map[string]int64)}

func couponRPMPlan(nextAt int64, now int64, rpm int) (waitMillis int64, newNextAt int64, accepted bool) {
	intervalMillis := (time.Minute.Milliseconds() + int64(rpm) - 1) / int64(rpm)
	burstMillis := int64(rpm-1) * intervalMillis
	if nextAt < now {
		nextAt = now
	}
	waitMillis = nextAt - burstMillis - now
	if waitMillis < 0 {
		waitMillis = 0
	}
	if waitMillis > couponRPMMaxWait.Milliseconds() {
		return waitMillis, nextAt, false
	}
	arrival := now + waitMillis
	if arrival > nextAt {
		nextAt = arrival
	}
	return waitMillis, nextAt + intervalMillis, true
}

func reserveCouponRPMInMemory(key string, rpm int, now int64) (time.Duration, time.Duration, bool) {
	couponRPMMemory.Lock()
	defer couponRPMMemory.Unlock()
	waitMillis, nextAt, accepted := couponRPMPlan(couponRPMMemory.nextAt[key], now, rpm)
	if !accepted {
		return 0, time.Duration(waitMillis) * time.Millisecond, false
	}
	couponRPMMemory.nextAt[key] = nextAt
	couponRPMMemory.reservations++
	if couponRPMMemory.reservations%1024 == 0 {
		for currentKey, currentNextAt := range couponRPMMemory.nextAt {
			if currentNextAt+time.Minute.Milliseconds() < now {
				delete(couponRPMMemory.nextAt, currentKey)
			}
		}
	}
	return time.Duration(waitMillis) * time.Millisecond, 0, true
}

func redisCouponRPMInteger(value interface{}) (int64, error) {
	switch typed := value.(type) {
	case int64:
		return typed, nil
	case string:
		return strconv.ParseInt(typed, 10, 64)
	case []byte:
		return strconv.ParseInt(string(typed), 10, 64)
	default:
		return 0, fmt.Errorf("unexpected Redis coupon RPM reply type %T", value)
	}
}

func reserveCouponRPMRedis(ctx context.Context, key string, rpm int, now int64) (time.Duration, time.Duration, bool, error) {
	if common.RDB == nil {
		return 0, 0, false, errors.New("Redis client is not initialized")
	}
	intervalMillis := (time.Minute.Milliseconds() + int64(rpm) - 1) / int64(rpm)
	burstMillis := int64(rpm-1) * intervalMillis
	values, err := common.RDB.Eval(
		ctx,
		couponRPMRedisScript,
		[]string{key},
		now,
		intervalMillis,
		burstMillis,
		couponRPMMaxWait.Milliseconds(),
	).Slice()
	if err != nil {
		return 0, 0, false, err
	}
	if len(values) != 2 {
		return 0, 0, false, fmt.Errorf("unexpected Redis coupon RPM reply length %d", len(values))
	}
	acceptedValue, err := redisCouponRPMInteger(values[0])
	if err != nil {
		return 0, 0, false, err
	}
	waitMillis, err := redisCouponRPMInteger(values[1])
	if err != nil {
		return 0, 0, false, err
	}
	if acceptedValue != 1 {
		return 0, time.Duration(waitMillis) * time.Millisecond, false, nil
	}
	return time.Duration(waitMillis) * time.Millisecond, 0, true, nil
}

func WaitForCouponRPM(c *gin.Context, groupRatioInfo hosttypes.GroupRatioInfo) *relaytypes.NewAPIError {
	if groupRatioInfo.CouponId <= 0 || groupRatioInfo.CouponRPMLimit == 0 || c.GetBool(couponRPMReservationMark) {
		return nil
	}
	if groupRatioInfo.CouponRPMLimit < 0 || groupRatioInfo.CouponRPMLimit > model.MaxCouponRPM {
		return relaytypes.NewErrorWithStatusCode(
			errors.New("coupon RPM limit is invalid"),
			relaytypes.ErrorCodeCouponRPMQueueUnavailable,
			http.StatusServiceUnavailable,
			relaytypes.ErrOptionWithSkipRetry(),
		)
	}
	batchId := groupRatioInfo.CouponIssueBatchId
	if batchId == "" {
		batchId = strconv.Itoa(groupRatioInfo.CouponId)
	}
	userId := c.GetInt("id")
	if userId <= 0 {
		return relaytypes.NewErrorWithStatusCode(
			errors.New("coupon RPM queue requires an authenticated user"),
			relaytypes.ErrorCodeCouponRPMQueueUnavailable,
			http.StatusServiceUnavailable,
			relaytypes.ErrOptionWithSkipRetry(),
		)
	}
	key := fmt.Sprintf("new-api:coupon_rpm:v1:%s:%d", batchId, userId)
	nowMillis := time.Now().UnixMilli()
	var waitDuration time.Duration
	var retryAfter time.Duration
	var accepted bool
	var err error
	if common.RedisEnabled {
		waitDuration, retryAfter, accepted, err = reserveCouponRPMRedis(c.Request.Context(), key, groupRatioInfo.CouponRPMLimit, nowMillis)
	} else {
		waitDuration, retryAfter, accepted = reserveCouponRPMInMemory(key, groupRatioInfo.CouponRPMLimit, nowMillis)
	}
	if err != nil {
		return relaytypes.NewErrorWithStatusCode(
			fmt.Errorf("coupon RPM queue unavailable: %w", err),
			relaytypes.ErrorCodeCouponRPMQueueUnavailable,
			http.StatusServiceUnavailable,
			relaytypes.ErrOptionWithSkipRetry(),
		)
	}
	if !accepted {
		retryAfterSeconds := max(int64(1), (retryAfter.Milliseconds()+999)/1000)
		c.Header("Retry-After", strconv.FormatInt(retryAfterSeconds, 10))
		return relaytypes.NewErrorWithStatusCode(
			errors.New("coupon RPM queue is full; retry later or use another group"),
			relaytypes.ErrorCodeCouponRPMQueueFull,
			http.StatusTooManyRequests,
			relaytypes.ErrOptionWithSkipRetry(),
		)
	}
	c.Set(couponRPMReservationMark, true)
	if waitDuration <= 0 {
		return nil
	}
	timer := time.NewTimer(waitDuration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-c.Request.Context().Done():
		return relaytypes.NewErrorWithStatusCode(
			c.Request.Context().Err(),
			relaytypes.ErrorCodeCouponRPMQueueUnavailable,
			http.StatusRequestTimeout,
			relaytypes.ErrOptionWithSkipRetry(),
		)
	}
}
