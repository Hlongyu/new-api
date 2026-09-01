package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupRechargeLotteryFixture(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(
		&User{}, &Redemption{}, &UserSubscription{}, &CompanionMigration{},
		&QuotaLoan{}, &QuotaLoanEvent{},
		&RechargeLotteryCampaign{}, &RechargeLotteryPrize{},
		&RechargeLotteryGrantBatch{}, &RechargeLotteryLedger{},
		&RechargeLotteryDrawBatch{}, &RechargeLotteryDrawItem{},
		&RechargeLotteryPlanMapping{}, &RechargeLotteryRedemptionProgress{},
	))
	previousDatabase := DB
	previousQuotaPerUnit := common.QuotaPerUnit
	previousMigrationRequired := common.LeaderboardMigrationRequired
	DB = database
	common.QuotaPerUnit = 500_000
	common.LeaderboardMigrationRequired = false
	t.Cleanup(func() {
		DB = previousDatabase
		common.QuotaPerUnit = previousQuotaPerUnit
		common.LeaderboardMigrationRequired = previousMigrationRequired
	})
	_, err = EnsureRechargeLotteryDefaultCampaign()
	require.NoError(t, err)
	return database
}

func TestRedeemImmediatelyGrantsRechargeLotteryDraws(t *testing.T) {
	database := setupRechargeLotteryFixture(t)
	user := User{Id: 42, Username: "alice", Password: "password", Status: common.UserStatusEnabled}
	require.NoError(t, database.Create(&user).Error)
	require.NoError(t, database.Create(&[]Redemption{
		{Key: "lottery-redeem-1", Status: common.RedemptionCodeStatusEnabled, Quota: 50_000_000},
		{Key: "lottery-redeem-2", Status: common.RedemptionCodeStatusEnabled, Quota: 25_000_000},
	}).Error)

	quota, err := Redeem("lottery-redeem-1", user.Id)
	require.NoError(t, err)
	assert.Equal(t, 50_000_000, quota)

	progress, err := GetRechargeLotteryRedemptionProgress(user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 50_000_000, progress.ObservedQuota)
	assert.Equal(t, 1, progress.RedemptionCount)
	assert.Equal(t, 1, progress.GrantedDraws)
	balance, err := GetRechargeLotteryBalance(RechargeLotteryPermanentCampaignId, user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 1, balance)

	_, err = Redeem("lottery-redeem-2", user.Id)
	require.NoError(t, err)
	progress, err = GetRechargeLotteryRedemptionProgress(user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 75_000_000, progress.ObservedQuota)
	assert.Equal(t, 2, progress.RedemptionCount)
	assert.Equal(t, 1, progress.GrantedDraws)
}

func TestCreateRechargeLotteryDrawAtomicallyCreatesRewardSubscription(t *testing.T) {
	database := setupRechargeLotteryFixture(t)
	user := User{Id: 7, Username: "draw-user", Password: "password", Status: common.UserStatusEnabled}
	require.NoError(t, database.Create(&user).Error)
	require.NoError(t, database.Create(&RechargeLotteryLedger{
		Id: "manual-grant-7", CampaignId: RechargeLotteryPermanentCampaignId,
		UserId: user.Id, Kind: "grant", Delta: 1, ReferenceId: "fixture", CreatedAt: 100,
	}).Error)
	campaign, err := GetRechargeLotteryCampaign(RechargeLotteryPermanentCampaignId)
	require.NoError(t, err)
	require.NotEmpty(t, campaign.Prizes)
	createdAt := common.GetTimestamp()
	draw := RechargeLotteryDrawBatch{
		Id: "draw-1", RequestKey: "draw-request-1", CampaignId: campaign.Id,
		UserId: user.Id, DrawCount: 1, TotalAmountUsd: 1, TotalQuota: 500_000,
		PreflightSubscriptionIds: "[]", CreatedAt: createdAt,
	}
	items := []RechargeLotteryDrawItem{{
		Id: "draw-item-1", PrizeId: campaign.Prizes[0].Id,
		AmountUsd: 1, QuotaAmount: 500_000, Rarity: "common", RandomValue: "1",
	}}

	saved, created, err := CreateRechargeLotteryDraw(draw, items)
	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, RechargeLotteryDrawCompleted, saved.Status)
	assert.Positive(t, saved.ExternalSubscriptionId)

	var subscription UserSubscription
	require.NoError(t, database.First(&subscription, saved.ExternalSubscriptionId).Error)
	assert.Equal(t, subscription.CreatedAt, saved.CompletedAt)
	assert.Equal(t, RechargeLotterySubscriptionSource, subscription.Source)
	assert.EqualValues(t, 500_000, subscription.AmountTotal)
	assert.EqualValues(t, RechargeLotterySubscriptionDays*86_400, subscription.EndTime-subscription.StartTime)

	replayed, replayCreated, err := CreateRechargeLotteryDraw(draw, items)
	require.NoError(t, err)
	assert.False(t, replayCreated)
	assert.Equal(t, saved.Id, replayed.Id)
	var subscriptionCount int64
	require.NoError(t, database.Model(&UserSubscription{}).Count(&subscriptionCount).Error)
	assert.EqualValues(t, 1, subscriptionCount)

	second := draw
	second.Id = "draw-2"
	second.RequestKey = "draw-request-2"
	items[0].Id = "draw-item-2"
	_, _, err = CreateRechargeLotteryDraw(second, items)
	assert.ErrorIs(t, err, ErrRechargeLotteryInsufficientBalance)
	require.NoError(t, database.Model(&UserSubscription{}).Count(&subscriptionCount).Error)
	assert.EqualValues(t, 1, subscriptionCount)
}

func TestFulfillMigratedRechargeLotteryDrawWithoutAdminToken(t *testing.T) {
	database := setupRechargeLotteryFixture(t)
	user := User{Id: 9, Username: "pending-user", Password: "password", Status: common.UserStatusEnabled}
	require.NoError(t, database.Create(&user).Error)
	draw := RechargeLotteryDrawBatch{
		Id: "pending-draw", RequestKey: "pending-request", CampaignId: RechargeLotteryPermanentCampaignId,
		UserId: user.Id, DrawCount: 1, TotalAmountUsd: 2, TotalQuota: 1_000_000,
		Status: RechargeLotteryDrawUnknown, PreflightSubscriptionIds: "[]",
		CreatedAt: common.GetTimestamp() - 100, UpdatedAt: common.GetTimestamp() - 100, NextAttemptAt: 1,
	}
	require.NoError(t, database.Create(&draw).Error)

	fulfilled, err := FulfillRechargeLotteryDraw(draw.Id)
	require.NoError(t, err)
	assert.Equal(t, RechargeLotteryDrawCompleted, fulfilled.Status)
	assert.Positive(t, fulfilled.ExternalSubscriptionId)

	var subscription UserSubscription
	require.NoError(t, database.First(&subscription, fulfilled.ExternalSubscriptionId).Error)
	assert.EqualValues(t, draw.TotalQuota, subscription.AmountTotal)
	assert.Equal(t, "recharge_lottery_draw:"+draw.Id, subscription.AdminNote)
}
