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

func TestSaveQuotaDataCacheRecordsActualSyncTime(t *testing.T) {
	truncateTables(t)
	CacheQuotaDataLock.Lock()
	CacheQuotaData = make(map[string]*QuotaData)
	CacheQuotaDataLock.Unlock()
	t.Cleanup(func() {
		CacheQuotaDataLock.Lock()
		CacheQuotaData = make(map[string]*QuotaData)
		CacheQuotaDataLock.Unlock()
	})

	require.NoError(t, DB.Create(&QuotaData{
		UserID: 42, Username: "alice", ModelName: "gpt-test", CreatedAt: 3600,
		SyncedAt: 1, UseGroup: "default", Count: 1, TokenUsed: 10,
	}).Error)
	LogQuotaData(QuotaDataLogParams{
		UserID: 42, Username: "alice", ModelName: "gpt-test", CreatedAt: 3601,
		UseGroup: "default", TokenUsed: 20,
	})

	SaveQuotaDataCache()

	var stored QuotaData
	require.NoError(t, DB.Where("user_id = ?", 42).First(&stored).Error)
	assert.Equal(t, 2, stored.Count)
	assert.Equal(t, 30, stored.TokenUsed)
	assert.Greater(t, stored.SyncedAt, stored.CreatedAt)
	assert.Equal(t, stored.SyncedAt, GetQuotaDataLastSyncAt())
}

func TestLeaderboardQueriesUseSyncTimeWithLegacyFallback(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&[]QuotaData{
		{UserID: 1, ModelName: "gpt-a", CreatedAt: 3600, SyncedAt: 3700, UseGroup: "default", Count: 1},
		{UserID: 1, ModelName: "gpt-b", CreatedAt: 3600, SyncedAt: 3800, UseGroup: "default", Count: 1},
		{UserID: 2, ModelName: "legacy", CreatedAt: 7200, UseGroup: "default", Count: 1},
	}).Error)

	usageTotals, err := GetLeaderboardUsageTotals(1, 8000)
	require.NoError(t, err)
	require.Len(t, usageTotals, 2)
	usageSyncByUser := make(map[int]int64, len(usageTotals))
	for _, row := range usageTotals {
		usageSyncByUser[row.UserId] = row.UpdatedAt
	}
	assert.Equal(t, int64(3800), usageSyncByUser[1])
	assert.Equal(t, int64(7200), usageSyncByUser[2])

	rankRows, err := GetRankQuotaRows(0)
	require.NoError(t, err)
	require.Len(t, rankRows, 2)
	rankSyncByUser := make(map[int]int64, len(rankRows))
	for _, row := range rankRows {
		rankSyncByUser[row.UserId] = row.SyncedAt
	}
	assert.Equal(t, int64(3800), rankSyncByUser[1])
	assert.Equal(t, int64(7200), rankSyncByUser[2])
}
