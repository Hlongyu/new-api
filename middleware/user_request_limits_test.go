package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserRequestLimitsSeparatePoolsShareKeysAndReleaseOnFailure(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, useRedis := range []bool{false, true} {
		name := "memory"
		if useRedis {
			name = "redis"
		}
		t.Run(name, func(t *testing.T) {
			previous := setting.UserRequestLimitsJSON()
			previousRedis := common.RedisEnabled
			t.Cleanup(func() {
				require.NoError(t, setting.UpdateUserRequestLimits(previous))
				common.RedisEnabled = previousRedis
			})
			common.RedisEnabled = false
			if useRedis {
				useRateLimitMiniRedis(t)
			}
			userRequestLimiter = common.UserRequestLimiter{}
			require.NoError(t, setting.UpdateUserRequestLimits(`{"default":{"default":{"max_concurrent":1},"key_groups":{"ds":{"max_concurrent":1},"free":{}}},"company":{"default":{"max_concurrent":2}}}`))
			router := gin.New()
			router.Use(func(c *gin.Context) {
				id, _ := strconv.Atoi(c.GetHeader("User"))
				c.Set("id", id)
				common.SetContextKey(c, constant.ContextKeyUserGroup, c.GetHeader("User-Group"))
				common.SetContextKey(c, constant.ContextKeyTokenGroup, c.GetHeader("Key-Group"))
			}, UserRequestLimits())
			entered, finish := make(chan struct{}), make(chan struct{})
			router.GET("/hold", func(c *gin.Context) { close(entered); <-finish; c.Status(500) })
			router.GET("/request", func(c *gin.Context) { c.Status(204) })
			request := func(path, user, group, key string) *httptest.ResponseRecorder {
				r := httptest.NewRequest("GET", path, nil)
				r.Header.Set("User", user)
				r.Header.Set("User-Group", group)
				r.Header.Set("Key-Group", key)
				w := httptest.NewRecorder()
				router.ServeHTTP(w, r)
				return w
			}
			done := make(chan struct{})
			go func() { defer close(done); request("/hold", "1", "default", "") }()
			<-entered
			assert.Equal(t, 429, request("/request", "1", "default", "other").Code, "all unmatched Key groups share the default pool")
			assert.Equal(t, 204, request("/request", "1", "default", "ds").Code, "a dedicated pool does not consume the default pool")
			assert.Equal(t, 204, request("/request", "1", "default", "free").Code, "disabled dedicated limits must not inherit default concurrency")
			assert.Equal(t, 204, request("/request", "2", "default", "").Code, "different users do not share slots")
			assert.Equal(t, 204, request("/request", "1", "company", "").Code, "user group selects the policy")
			close(finish)
			<-done
			assert.Equal(t, 204, request("/request", "1", "default", "").Code, "failure releases the slot")
		})
	}
}

func TestUserRequestLimitsRateAndLegacyReplacement(t *testing.T) {
	require.NoError(t, i18n.Init())
	previous := setting.UserRequestLimitsJSON()
	previousRedis := common.RedisEnabled
	oldEnabled := setting.ModelRequestRateLimitEnabled
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserRequestLimits(previous))
		common.RedisEnabled = previousRedis
		setting.ModelRequestRateLimitEnabled = oldEnabled
	})
	common.RedisEnabled = false
	userRequestLimiter = common.UserRequestLimiter{}
	setting.ModelRequestRateLimitEnabled = true
	require.NoError(t, setting.UpdateUserRequestLimits(`{"default":{"default":{"rate_count":1,"rate_window_minutes":1},"key_groups":{"ds":{"rate_count":2,"rate_window_minutes":1}}}}`))
	router := gin.New()
	router.GET("/", func(c *gin.Context) {
		c.Set("id", 7)
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
		common.SetContextKey(c, constant.ContextKeyTokenGroup, c.GetHeader("Key-Group"))
	}, ModelRequestRateLimit(), func(c *gin.Context) { c.Status(http.StatusBadGateway) })
	request := func(key string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("Key-Group", key)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	assert.Equal(t, 502, request("").Code)
	assert.Equal(t, 429, request("other").Code, "admitted failures count toward the rate limit")
	assert.Equal(t, 502, request("ds").Code)
	assert.Equal(t, 502, request("ds").Code)
	limited := request("ds")
	assert.Equal(t, 429, limited.Code)
	assert.NotEmpty(t, limited.Header().Get("Retry-After"))
	assert.Contains(t, limited.Body.String(), "user_rate_limit_exceeded")
	require.NoError(t, setting.UpdateUserRequestLimits(`{}`))
	assert.Equal(t, 502, request("").Code, "an explicitly empty policy disables legacy limits too")
}

func TestUserRequestLimitsReleaseOnStreamCancellationAndPanic(t *testing.T) {
	require.NoError(t, i18n.Init())
	previous := setting.UserRequestLimitsJSON()
	previousRedis := common.RedisEnabled
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserRequestLimits(previous))
		common.RedisEnabled = previousRedis
	})
	common.RedisEnabled = false
	userRequestLimiter = common.UserRequestLimiter{}
	require.NoError(t, setting.UpdateUserRequestLimits(`{"default":{"default":{"max_concurrent":1}}}`))
	router := gin.New()
	router.Use(gin.CustomRecovery(func(c *gin.Context, _ any) { c.AbortWithStatus(500) }), func(c *gin.Context) { c.Set("id", 1); common.SetContextKey(c, constant.ContextKeyUserGroup, "default") }, UserRequestLimits())
	entered, done := make(chan struct{}), make(chan struct{})
	router.GET("/stream", func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		c.Writer.WriteString("data: hello\n\n")
		c.Writer.Flush()
		close(entered)
		<-c.Request.Context().Done()
	})
	router.GET("/panic", func(c *gin.Context) { panic("handler failure") })
	router.GET("/ok", func(c *gin.Context) { c.Status(204) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request := httptest.NewRequest("GET", "/stream", nil).WithContext(ctx)
	go func() { defer close(done); router.ServeHTTP(httptest.NewRecorder(), request) }()
	<-entered
	assert.Equal(t, 429, performRateLimitRequest(router, "/ok", "127.0.0.1:1").Code)
	cancel()
	<-done
	assert.Equal(t, 204, performRateLimitRequest(router, "/ok", "127.0.0.1:1").Code)
	assert.Equal(t, 500, performRateLimitRequest(router, "/panic", "127.0.0.1:1").Code)
	assert.Equal(t, 204, performRateLimitRequest(router, "/ok", "127.0.0.1:1").Code)
}

func TestUserRequestLimitsRedisFailureRejectsWithoutFallback(t *testing.T) {
	require.NoError(t, i18n.Init())
	previous := setting.UserRequestLimitsJSON()
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserRequestLimits(previous)) })
	_, client := useRateLimitMiniRedis(t)
	require.NoError(t, setting.UpdateUserRequestLimits(`{"default":{"default":{"max_concurrent":1}}}`))
	require.NoError(t, client.Close())
	called := false
	router := gin.New()
	router.GET("/", func(c *gin.Context) { c.Set("id", 1); common.SetContextKey(c, constant.ContextKeyUserGroup, "default") }, UserRequestLimits(), func(c *gin.Context) { called = true; c.Status(204) })
	assert.Equal(t, 503, performRateLimitRequest(router, "/", "127.0.0.1:1").Code)
	assert.False(t, called)
}
