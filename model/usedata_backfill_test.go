package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBackfillQuotaDataTokenMetricsUsesLogSemanticsAndIsIdempotent(t *testing.T) {
	truncateTables(t)

	quotaRows := []QuotaData{
		{UserID: 1, Username: "alice", ModelName: "gpt", CreatedAt: 3600, UseGroup: "vip", TokenID: 11, ChannelID: 1, NodeName: "node-a"},
		{UserID: 1, Username: "alice", ModelName: "claude", CreatedAt: 3600, UseGroup: "vip", TokenID: 11, ChannelID: 1, NodeName: "node-a"},
		{UserID: 1, Username: "alice", ModelName: "responses", CreatedAt: 3600, UseGroup: "vip", TokenID: 11, ChannelID: 1, NodeName: "node-a"},
		{UserID: 2, Username: "bob", ModelName: "ambiguous", CreatedAt: 3600, UseGroup: "default", TokenID: 22, ChannelID: 2, NodeName: "node-a"},
		{UserID: 2, Username: "bob", ModelName: "ambiguous", CreatedAt: 3600, UseGroup: "default", TokenID: 22, ChannelID: 2, NodeName: "node-b"},
	}
	for i := range quotaRows {
		require.NoError(t, DB.Create(&quotaRows[i]).Error)
	}

	logs := []Log{
		{
			UserId: 1, Username: "alice", ModelName: "gpt", CreatedAt: 3661,
			Type: LogTypeConsume, Group: "vip", TokenId: 11, ChannelId: 1,
			PromptTokens: 100, CompletionTokens: 20,
			Other: common.MapToJsonStr(map[string]interface{}{"cache_tokens": 40}),
		},
		{
			UserId: 1, Username: "alice", ModelName: "claude", CreatedAt: 3662,
			Type: LogTypeConsume, Group: "vip", TokenId: 11, ChannelId: 1,
			PromptTokens: 2, CompletionTokens: 5,
			Other: common.MapToJsonStr(map[string]interface{}{
				"claude": true, "cache_tokens": 70, "cache_creation_tokens": 10,
			}),
		},
		{
			UserId: 1, Username: "alice", ModelName: "responses", CreatedAt: 3663,
			Type: LogTypeConsume, Group: "vip", TokenId: 11, ChannelId: 1,
			PromptTokens: 120, CompletionTokens: 10,
			Other: common.MapToJsonStr(map[string]interface{}{
				"input_tokens_total": 150, "cache_tokens": 100,
			}),
		},
		{
			UserId: 2, Username: "bob", ModelName: "ambiguous", CreatedAt: 3664,
			Type: LogTypeConsume, Group: "default", TokenId: 22, ChannelId: 2,
			PromptTokens: 50, CompletionTokens: 10,
		},
	}
	for i := range logs {
		require.NoError(t, DB.Create(&logs[i]).Error)
	}

	result, err := BackfillQuotaDataTokenMetrics()
	require.NoError(t, err)
	assert.False(t, result.AlreadyCompleted)
	assert.Equal(t, 5, result.CandidateRows)
	assert.Equal(t, 3, result.UpdatedRows)
	assert.Equal(t, 2, result.AmbiguousRows)
	assert.Equal(t, 4, result.ScannedLogs)

	var got []QuotaData
	require.NoError(t, DB.Order("id ASC").Find(&got).Error)
	require.Len(t, got, 5)
	assert.Equal(t, 100, got[0].InputTokens)
	assert.Equal(t, 20, got[0].OutputTokens)
	assert.Equal(t, 40, got[0].CacheReadTokens)
	assert.Equal(t, 82, got[1].InputTokens)
	assert.Equal(t, 5, got[1].OutputTokens)
	assert.Equal(t, 70, got[1].CacheReadTokens)
	assert.Equal(t, 150, got[2].InputTokens)
	assert.Equal(t, 10, got[2].OutputTokens)
	assert.Equal(t, 100, got[2].CacheReadTokens)
	assert.Zero(t, got[3].InputTokens)
	assert.Zero(t, got[4].InputTokens)

	var migration DataMigration
	require.NoError(t, DB.First(&migration, "name = ?", quotaDataTokenMetricsMigration).Error)
	assert.NotZero(t, migration.CompletedAt)

	require.NoError(t, DB.Create(&Log{
		UserId: 1, Username: "alice", ModelName: "gpt", CreatedAt: 3665,
		Type: LogTypeConsume, Group: "vip", TokenId: 11, ChannelId: 1,
		PromptTokens: 999, CompletionTokens: 999,
	}).Error)

	secondResult, err := BackfillQuotaDataTokenMetrics()
	require.NoError(t, err)
	assert.True(t, secondResult.AlreadyCompleted)
	require.NoError(t, DB.First(&got[0], quotaRows[0].Id).Error)
	assert.Equal(t, 100, got[0].InputTokens)
	assert.Equal(t, 20, got[0].OutputTokens)
}

func TestBackfillQuotaDataTokenTotalsRebuildsHistoryAndPreservesLegacyRows(t *testing.T) {
	truncateTables(t)

	quotaRows := []QuotaData{
		{UserID: 1, Username: "alice", ModelName: "claude", CreatedAt: 3600, UseGroup: "vip", TokenID: 11, ChannelID: 1, TokenUsed: 7, InputTokens: 72, OutputTokens: 5, CacheReadTokens: 70},
		{UserID: 1, Username: "alice", ModelName: "responses", CreatedAt: 3600, UseGroup: "vip", TokenID: 11, ChannelID: 1, TokenUsed: 130, InputTokens: 150, OutputTokens: 10, CacheReadTokens: 100},
		{UserID: 2, Username: "bob", ModelName: "audio", CreatedAt: 3600, UseGroup: "default", TokenID: 22, ChannelID: 2, TokenUsed: 999, InputTokens: 30, OutputTokens: 4},
		{UserID: 2, Username: "bob", ModelName: "legacy-task", CreatedAt: 3600, UseGroup: "default", TokenID: 22, ChannelID: 2, TokenUsed: 777},
		{UserID: 3, Username: "carol", ModelName: "ambiguous", CreatedAt: 3600, UseGroup: "default", TokenID: 33, ChannelID: 3, NodeName: "node-a", TokenUsed: 60},
		{UserID: 3, Username: "carol", ModelName: "ambiguous", CreatedAt: 3600, UseGroup: "default", TokenID: 33, ChannelID: 3, NodeName: "node-b", TokenUsed: 60},
	}
	for i := range quotaRows {
		require.NoError(t, DB.Create(&quotaRows[i]).Error)
	}

	logs := []Log{
		{
			UserId: 1, Username: "alice", ModelName: "claude", CreatedAt: 3661,
			Type: LogTypeConsume, Group: "vip", TokenId: 11, ChannelId: 1,
			PromptTokens: 2, CompletionTokens: 5,
			Other: common.MapToJsonStr(map[string]interface{}{
				"usage_semantic": "anthropic", "cache_tokens": 70,
				"cache_creation_tokens_5m": 4, "cache_creation_tokens_1h": 6,
			}),
		},
		{
			UserId: 1, Username: "alice", ModelName: "responses", CreatedAt: 3662,
			Type: LogTypeConsume, Group: "vip", TokenId: 11, ChannelId: 1,
			PromptTokens: 120, CompletionTokens: 10,
			Other: common.MapToJsonStr(map[string]interface{}{
				"input_tokens_total": 150, "cache_tokens": 100,
			}),
		},
		{
			UserId: 3, Username: "carol", ModelName: "ambiguous", CreatedAt: 3663,
			Type: LogTypeConsume, Group: "default", TokenId: 33, ChannelId: 3,
			PromptTokens: 50, CompletionTokens: 10,
		},
	}
	for i := range logs {
		require.NoError(t, DB.Create(&logs[i]).Error)
	}

	result, err := BackfillQuotaDataTokenTotals()
	require.NoError(t, err)
	assert.False(t, result.AlreadyCompleted)
	assert.Equal(t, 6, result.CandidateRows)
	assert.Equal(t, 3, result.UpdatedRows)
	assert.Equal(t, 2, result.AmbiguousRows)
	assert.Equal(t, 3, result.ScannedLogs)

	var got []QuotaData
	require.NoError(t, DB.Order("id ASC").Find(&got).Error)
	require.Len(t, got, 6)
	assert.Equal(t, 82, got[0].InputTokens)
	assert.Equal(t, 87, got[0].TokenUsed)
	assert.Equal(t, 150, got[1].InputTokens)
	assert.Equal(t, 160, got[1].TokenUsed)
	assert.Equal(t, 34, got[2].TokenUsed)
	assert.Equal(t, 777, got[3].TokenUsed)
	assert.Equal(t, 60, got[4].TokenUsed)
	assert.Equal(t, 60, got[5].TokenUsed)

	var migration DataMigration
	require.NoError(t, DB.First(&migration, "name = ?", quotaDataTokenTotalsMigration).Error)
	assert.NotZero(t, migration.CompletedAt)

	secondResult, err := BackfillQuotaDataTokenTotals()
	require.NoError(t, err)
	assert.True(t, secondResult.AlreadyCompleted)
}
