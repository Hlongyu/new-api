package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserRequestLimitRuleSelection(t *testing.T) {
	previous := userRequestLimits.Load()
	t.Cleanup(func() { userRequestLimits.Store(previous) })
	require.NoError(t, UpdateUserRequestLimits(`{"default":{"default":{"max_concurrent":5,"rate_count":60,"rate_window_minutes":1},"key_groups":{"ds":{"max_concurrent":10},"free":{}}},"company":{"default":{"max_concurrent":30}}}`))
	for _, test := range []struct {
		user, key, pool   string
		concurrency, rate int
	}{
		{"default", "", "default", 5, 60}, {"default", "other", "default", 5, 60},
		{"default", "ds", "key:ds", 10, 0}, {"default", "free", "key:free", 0, 0},
		{"company", "ds", "default", 30, 0}, {"missing", "ds", "default", 0, 0},
	} {
		t.Run(test.user+"/"+test.key, func(t *testing.T) {
			rule, pool, configured := ResolveUserRequestLimit(test.user, test.key)
			require.True(t, configured)
			assert.Equal(t, test.pool, pool)
			assert.Equal(t, test.concurrency, rule.MaxConcurrent)
			assert.Equal(t, test.rate, rule.RateCount)
		})
	}
}

func TestUserRequestLimitsRejectInvalidConfigurationWithoutReplacingPolicy(t *testing.T) {
	previous := userRequestLimits.Load()
	t.Cleanup(func() { userRequestLimits.Store(previous) })
	require.NoError(t, UpdateUserRequestLimits(`{"default":{"default":{"max_concurrent":5}}}`))
	for _, raw := range []string{`null`, `[]`, `{"":{"default":{}}}`, `{"default":{"default":{"max_concurrent":-1}}}`, `{"default":{"default":{"rate_count":1}}}`, `{"default":{"default":{"rate_count":1.5,"rate_window_minutes":1}}}`, `{"default":{"default":{"max_concurrent":2147483648}}}`, `{"default":{"key_groups":{"auto":{}}}}`, `{"default":{"default":{"rate_count":1,"rate_window_minutes":10081}}}`} {
		require.Error(t, UpdateUserRequestLimits(raw), raw)
		rule, _, _ := ResolveUserRequestLimit("default", "")
		assert.Equal(t, 5, rule.MaxConcurrent)
	}
}
