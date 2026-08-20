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
