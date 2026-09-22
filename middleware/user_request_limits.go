package middleware

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

var userRequestLimiter common.UserRequestLimiter

// UserRequestLimits must run after authentication and before channel selection.
// It counts HTTP request lifetimes, not background task lifetimes.
func UserRequestLimits() gin.HandlerFunc {
	return func(c *gin.Context) {
		rule, pool, _ := setting.ResolveUserRequestLimit(
			common.GetContextKeyString(c, constant.ContextKeyUserGroup),
			common.GetContextKeyString(c, constant.ContextKeyTokenGroup),
		)
		if rule.MaxConcurrent == 0 && rule.RateCount == 0 {
			c.Next()
			return
		}
		userID := c.GetInt("id")
		if userID <= 0 {
			abortWithOpenAiMessage(c, http.StatusUnauthorized, "user_request_limit_identity_missing")
			return
		}
		// The group chooses policy, but the user ID owns counters. Renaming/changing a
		// user's group must not create another default pool. Key-group pools are exact.
		key := fmt.Sprintf("userRequestLimit:v1:{%d:%x}", userID, sha256.Sum256([]byte(pool)))
		ctx, cancel := context.WithCancel(c.Request.Context())
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		var client *redis.Client
		if common.RedisEnabled {
			client = common.RDB
			if client == nil {
				abortWithOpenAiMessage(c, http.StatusServiceUnavailable, i18n.T(c, i18n.MsgRequestLimitUnavailable), types.ErrorCode("user_request_limit_unavailable"))
				return
			}
		}
		lease, denied, retry, err := userRequestLimiter.Acquire(ctx, client, key, rule.MaxConcurrent, rule.RateCount, time.Duration(rule.RateWindowMinutes)*time.Minute, cancel)
		if err != nil {
			common.SysError(fmt.Sprintf("user request limit check failed for user %d: %v", userID, err))
			abortWithOpenAiMessage(c, http.StatusServiceUnavailable, i18n.T(c, i18n.MsgRequestLimitUnavailable), types.ErrorCode("user_request_limit_unavailable"))
			return
		}
		if denied != common.RequestLimitAllowed {
			code := "user_concurrency_limit_exceeded"
			message := i18n.T(c, i18n.MsgRequestConcurrencyExceeded, map[string]any{"Max": rule.MaxConcurrent})
			if denied == common.RequestLimitRate {
				code = "user_rate_limit_exceeded"
				message = i18n.T(c, i18n.MsgRateLimitTotalReached, map[string]any{"Max": rule.RateCount, "Minutes": rule.RateWindowMinutes})
				c.Header("Retry-After", strconv.Itoa(retry))
			}
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, message, types.ErrorCode(code))
			return
		}
		defer lease.Release()
		c.Next()
	}
}
