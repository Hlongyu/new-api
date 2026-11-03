package dto

import (
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestMergeUsageNonZeroUpdatesCountsWithoutErasingCache(t *testing.T) {
	first := &Usage{InputTokens: 1000, OutputTokens: 5, TotalTokens: 1005, InputTokensDetails: &InputTokenDetails{CachedTokens: 800, CacheWriteTokens: 50}}
	first.BillingUsage = NewOpenAIResponsesBillingUsage(first)
	first.BillingUsage.Estimated = true
	current := MergeUsageNonZero(nil, first)
	later := &Usage{InputTokens: 1200, OutputTokens: 10, TotalTokens: 1210, InputTokensDetails: &InputTokenDetails{TextTokens: 400}}
	later.BillingUsage = NewOpenAIResponsesBillingUsage(later)
	got := MergeUsageNonZero(current, later)
	assert.Equal(t, 1200, got.InputTokens)
	assert.Equal(t, 10, got.OutputTokens)
	assert.Equal(t, 1210, got.TotalTokens)
	assert.Equal(t, InputTokenDetails{CachedTokens: 800, CacheWriteTokens: 50, TextTokens: 400}, *got.InputTokensDetails)
	require.NotNil(t, got.BillingUsage)
	assert.True(t, got.BillingUsage.Estimated)
	assert.Equal(t, *got.InputTokensDetails, *got.BillingUsage.OpenAIUsage.InputTokensDetails)
	assert.Equal(t, 1200, got.BillingUsage.OpenAIUsage.InputTokens)
	assert.Equal(t, InputTokenDetails{CachedTokens: 800, CacheWriteTokens: 50}, *first.InputTokensDetails)
	assert.Equal(t, InputTokenDetails{TextTokens: 400}, *later.InputTokensDetails)
}

func TestOpenAIUsageEmptyDetailsDoNotCreateBillingSnapshot(t *testing.T) {
	require.Nil(t, NewOpenAIResponsesBillingUsage(&Usage{InputTokensDetails: &InputTokenDetails{}}))
	require.NotNil(t, NewOpenAIResponsesBillingUsage(&Usage{InputTokensDetails: &InputTokenDetails{CachedTokens: 800}}))
}
