package model

import (
	"errors"
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestWeeklyLotteryAwardsSevenDaySubscriptionWithoutChangingWallet(t *testing.T) {
	for _, retryFailed := range []bool{false, true} {
		name := "new draw"
		if retryFailed {
			name = "retry failed draw"
		}
		t.Run(name, func(t *testing.T) {
			database := setupLeaderboardTransactionTest(t, t.Name())
			require.NoError(t, database.AutoMigrate(&LotteryDraw{}, &UserSubscription{}, &SubscriptionPreConsumeRecord{}))
			require.NoError(t, database.Create(&User{Id: 42, Username: "alice", Quota: 1_000_000}).Error)
			opportunity := LotteryOpportunity{RuleVersion: 2, PeriodKey: "2026-09-07", DrawRank: 1, UserId: 42, EntryId: 7}
			if retryFailed {
				require.NoError(t, database.Create(&LotteryDraw{
					Id: "failed-draw", RuleVersion: 2, PeriodKey: opportunity.PeriodKey, DrawRank: 1,
					UserId: 42, Status: LeaderboardOrderFailed, ErrorMessage: "previous failure",
				}).Error)
			}
			now := common.GetTimestamp()
			draw, err := DrawLotteryPrize(opportunity, 10, 5_000_000, now)
			require.NoError(t, err)
			assert.Equal(t, LeaderboardOrderCompleted, draw.Status)
			assert.Empty(t, draw.ErrorMessage)
			assert.Equal(t, now, draw.CompletedAt)
			require.Positive(t, draw.SubscriptionId)
			var subscription UserSubscription
			require.NoError(t, database.First(&subscription, draw.SubscriptionId).Error)
			assert.Equal(t, 42, subscription.UserId)
			assert.EqualValues(t, 5_000_000, subscription.AmountTotal)
			assert.Zero(t, subscription.AmountUsed)
			assert.Equal(t, now, subscription.StartTime)
			assert.Equal(t, now+7*86_400, subscription.EndTime)
			assert.Equal(t, subscription.EndTime, draw.SubscriptionExpiresAt)
			assert.Equal(t, "weekly_lottery_reward", subscription.Source)
			assert.Equal(t, "weekly_lottery_draw:"+draw.Id, subscription.AdminNote)
			assert.True(t, subscription.AllowWalletOverflow)

			replayed, err := DrawLotteryPrize(opportunity, 1, 500_000, now+60)
			require.NoError(t, err)
			assert.Equal(t, draw, replayed, "replay must not replace the reward or extend its expiry")
			var count int64
			require.NoError(t, database.Model(&UserSubscription{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)

			consumed, err := PreConsumeUserSubscription("weekly-reward-request", 42, "test-model", 0, 100)
			require.NoError(t, err)
			assert.Equal(t, draw.SubscriptionId, consumed.UserSubscriptionId)
			require.NoError(t, database.First(&subscription, draw.SubscriptionId).Error)
			assert.EqualValues(t, 100, subscription.AmountUsed)
			usable, err := HasUsableSubscriptionQuota(42, subscription.EndTime)
			require.NoError(t, err)
			assert.False(t, usable, "unused reward must expire seven days after claiming")
			var user User
			require.NoError(t, database.First(&user, 42).Error)
			assert.Equal(t, 1_000_000, user.Quota)
		})
	}
}

func TestWeeklyLotteryPreservesLegacyAndUnresolvedDraws(t *testing.T) {
	for _, status := range []string{LeaderboardOrderCompleted, LeaderboardOrderUnknown, LeaderboardOrderProcessing} {
		t.Run(status, func(t *testing.T) {
			database := setupLeaderboardTransactionTest(t, t.Name())
			require.NoError(t, database.AutoMigrate(&LotteryDraw{}, &UserSubscription{}))
			require.NoError(t, database.Create(&User{Id: 42, Username: "alice", Quota: 1_000_000}).Error)
			legacy := LotteryDraw{Id: "legacy", RuleVersion: 2, PeriodKey: "2026-08-31", DrawRank: 1,
				UserId: 42, AmountUsd: 1, QuotaAmount: 500_000, Status: status, CompletedAt: 100}
			require.NoError(t, database.Create(&legacy).Error)
			draw, err := DrawLotteryPrize(LotteryOpportunity{
				RuleVersion: 2, PeriodKey: legacy.PeriodKey, DrawRank: 1, UserId: 42,
			}, 10, 5_000_000, 200)
			require.NoError(t, err)
			assert.Equal(t, &legacy, draw)
			var count int64
			require.NoError(t, database.Model(&UserSubscription{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestWeeklyLotteryRollsBackSubscriptionWhenDrawUpdateFails(t *testing.T) {
	database := setupLeaderboardTransactionTest(t, t.Name())
	require.NoError(t, database.AutoMigrate(&LotteryDraw{}, &UserSubscription{}))
	require.NoError(t, database.Create(&User{Id: 42, Username: "alice", Quota: 1_000_000}).Error)
	writeError := errors.New("draw write failed")
	require.NoError(t, database.Callback().Update().Before("gorm:update").Register("fail_lottery_write", func(tx *gorm.DB) {
		if tx.Statement.Table == "lottery_draws" {
			tx.AddError(writeError)
		}
	}))
	opportunity := LotteryOpportunity{RuleVersion: 2, PeriodKey: "2026-09-07", DrawRank: 1, UserId: 42}
	_, err := DrawLotteryPrize(opportunity, 10, 5_000_000, common.GetTimestamp())
	require.ErrorIs(t, err, writeError)
	var draws, subscriptions int64
	require.NoError(t, database.Model(&LotteryDraw{}).Count(&draws).Error)
	require.NoError(t, database.Model(&UserSubscription{}).Count(&subscriptions).Error)
	assert.Zero(t, draws)
	assert.Zero(t, subscriptions)
	require.NoError(t, database.Callback().Update().Remove("fail_lottery_write"))
	_, err = DrawLotteryPrize(opportunity, 10, 5_000_000, common.GetTimestamp())
	require.NoError(t, err)
}

func TestWeeklyLotteryRejectsInvalidReward(t *testing.T) {
	for _, tc := range []struct {
		name   string
		amount float64
		quota  int
	}{
		{"zero quota", 1, 0}, {"negative quota", 1, -1},
		{"oversized quota", 1, common.MaxQuota + 1},
		{"zero amount", 0, 1}, {"negative amount", -1, 1},
		{"NaN", math.NaN(), 1}, {"infinite", math.Inf(1), 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := DrawLotteryPrize(LotteryOpportunity{UserId: 42}, tc.amount, tc.quota, 100)
			require.Error(t, err)
		})
	}
}
