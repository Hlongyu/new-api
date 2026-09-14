package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLotteryDrawPayloadIncludesRewardSubscriptionAndPreservesLegacyWalletRewards(t *testing.T) {
	for _, subscriptionId := range []int{0, 123} {
		draw := model.LotteryDraw{Id: "draw", AmountUsd: 10, QuotaAmount: 5_000_000,
			Status: model.LeaderboardOrderCompleted, CompletedAt: 100, SubscriptionId: subscriptionId}
		if subscriptionId > 0 {
			draw.SubscriptionExpiresAt = 100 + 7*86_400
		}
		payload := lotteryDrawPayload(draw, true)
		encoded, err := common.Marshal(payload)
		require.NoError(t, err)
		var response map[string]interface{}
		require.NoError(t, common.Unmarshal(encoded, &response))
		assert.EqualValues(t, 10, response["amountUsd"])
		if subscriptionId > 0 {
			assert.EqualValues(t, 123, response["subscriptionId"])
			assert.EqualValues(t, 100+7*86_400, response["subscriptionExpiresAt"])
		} else {
			assert.NotContains(t, response, "subscriptionId")
			assert.NotContains(t, response, "subscriptionExpiresAt")
		}
	}
}

func TestLoadLotteryOpportunitiesUsesCurrentPrivacyAndSkipsFuturePeriods(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:lottery-opportunity-privacy?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(
		&model.LeaderboardEntry{}, &model.LotteryOpportunity{}, &model.LotteryDraw{},
	))
	previousDB := model.DB
	model.DB = database
	t.Cleanup(func() { model.DB = previousDB })

	require.NoError(t, database.Create(&model.LeaderboardEntry{
		Id: 7, UserId: 42, Username: "alice", SourceName: "Alice",
		DisplayName: "Alice Public", AnonymousName: "Anonymous Alice",
		CreatedAt: 1, Active: true, Participating: true, ParticipateWeek: false,
	}).Error)
	for _, periodKey := range []string{"2026-08-24", "2026-09-07"} {
		require.NoError(t, database.Create(&model.LotteryOpportunity{
			RuleVersion: weeklyLotteryRuleVersion, PeriodKey: periodKey, DrawRank: 1,
			UserId: 42, EntryId: 7, DisplayNameSnapshot: "Alice Public",
			PrizePoolJson: `[{"amountUsd":1,"weight":1}]`, CreatedAt: 1,
		}).Error)
	}

	opportunities, err := loadLotteryOpportunities(nil, "2026-08-31")
	require.NoError(t, err)
	require.Len(t, opportunities, 1)
	assert.Equal(t, "2026-08-24", opportunities[0].PeriodKey)
	assert.Equal(t, "Anonymous Alice", opportunities[0].DisplayNameSnapshot)
}
