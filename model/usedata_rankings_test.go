package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRankingQuotaTotalsUseNormalizedTokensWithLegacyFallback(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&QuotaData{
		ModelName: "claude", CreatedAt: 3600, TokenUsed: 7,
		InputTokens: 100, OutputTokens: 20, CacheReadTokens: 80,
	}).Error)
	require.NoError(t, DB.Create(&QuotaData{
		ModelName: "legacy-task", CreatedAt: 3600, TokenUsed: 50,
	}).Error)

	totals, err := GetRankingQuotaTotals(1, 7200)
	require.NoError(t, err)
	require.Len(t, totals, 2)
	assert.Equal(t, RankingQuotaTotal{ModelName: "claude", TotalTokens: 120}, totals[0])
	assert.Equal(t, RankingQuotaTotal{ModelName: "legacy-task", TotalTokens: 50}, totals[1])

	buckets, err := GetRankingQuotaBuckets(1, 7200, 3600)
	require.NoError(t, err)
	require.Len(t, buckets, 2)
	assert.Equal(t, int64(120), buckets[0].Tokens)
}
