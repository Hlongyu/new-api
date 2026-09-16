package model

import (
	"errors"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupMonthlyRebateTest(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &UserSubscription{}, &PostpaidSettlement{}, &MonthlyRebate{}, &Midjourney{}, &PostpaidSettlementAllocation{}))
	previousDB, previousType, previousUnit := DB, common.MainDatabaseType(), common.QuotaPerUnit
	previousRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		DB = previousDB
		common.RedisEnabled = previousRedisEnabled
		common.SetMainDatabaseType(previousType)
		common.QuotaPerUnit = previousUnit
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.Create(&User{Id: 1, Username: "rebate-user", Quota: 12345, Group: "default"}).Error)
	return db
}

func TestCalculateMonthlyRebateWholeMonthStrictThresholds(t *testing.T) {
	for _, tc := range []struct {
		name        string
		wallet      int64
		rate, quota int
	}{
		{"none", 0, 0, 0},
		{"exact lower threshold", 350000000, 0, 0},
		{"one quota over lower threshold", 350000001, 5, 17500000},
		{"middle tier", 500000000, 5, 25000000},
		{"exact upper threshold", 700000000, 5, 35000000},
		{"one quota over upper threshold", 700000001, 10, 70000000},
		{"upper tier", 750000000, 10, 75000000},
		{"monthly base exceeds int32", 3000000000, 10, 300000000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rate, quota, err := CalculateMonthlyRebate(tc.wallet, 500000)
			require.NoError(t, err)
			assert.Equal(t, tc.rate, rate)
			assert.Equal(t, tc.quota, quota)
		})
	}
	for _, tc := range []struct {
		wallet int64
		unit   float64
	}{
		{-1, 500000}, {1, 0}, {1, math.NaN()}, {1, math.Inf(1)}, {math.MaxInt64, 500000},
	} {
		_, _, err := CalculateMonthlyRebate(tc.wallet, tc.unit)
		require.Error(t, err)
	}
}

func TestMonthlyRebateWindowUsesBeijingMonthAndRejectsUnfinishedMonth(t *testing.T) {
	now := time.Date(2026, 10, 1, 0, 0, 0, 0, time.FixedZone("Beijing", 8*3600))
	start, end, err := MonthlyRebateWindow("2026-09", now)
	require.NoError(t, err)
	assert.Equal(t, time.Date(2026, 8, 31, 16, 0, 0, 0, time.UTC).Unix(), start.Unix())
	assert.Equal(t, now.Unix(), end.Unix())
	for _, period := range []string{"2026-10", "2026-11", "2026-9", "invalid"} {
		_, _, err := MonthlyRebateWindow(period, now)
		require.Error(t, err)
	}
}

func TestMonthlyRebateOnlyWalletConsumptionAndExactlyOneManualIssuance(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	now := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	start, end, err := MonthlyRebateWindow("2026-09", now)
	require.NoError(t, err)
	require.NoError(t, db.Create(&[]PostpaidSettlement{
		{RequestId: "wallet", UserId: 1, WalletQuota: 500000000, StartedAt: start.Unix()},
		{RequestId: "hybrid", UserId: 1, WalletQuota: 250000000, SubscriptionQuota: 500000000, StartedAt: start.Unix() + 1},
		{RequestId: "subscription", UserId: 1, SubscriptionQuota: 500000000, StartedAt: start.Unix() + 2},
		{RequestId: "before", UserId: 1, WalletQuota: 500000000, StartedAt: start.Unix() - 1},
		{RequestId: "after", UserId: 1, WalletQuota: 500000000, StartedAt: end.Unix()},
		{RequestId: "fee:violation", UserId: 1, WalletQuota: 500000000, StartedAt: start.Unix() + 3},
	}).Error)
	processed, err := RecalculateMonthlyRebates("2026-09", now)
	require.NoError(t, err)
	assert.Equal(t, 1, processed)
	var bill MonthlyRebate
	require.NoError(t, db.First(&bill).Error)
	assert.EqualValues(t, 750000000, bill.WalletQuota)
	assert.Equal(t, MonthlyRebatePending, bill.Status)
	var count int64
	require.NoError(t, db.Model(&UserSubscription{}).Count(&count).Error)
	assert.Zero(t, count, "calculation must never issue a reward")
	granted, err := IssueMonthlyRebate(bill.Id, bill.Revision, 99, now)
	require.NoError(t, err)
	assert.Equal(t, 75000000, granted.IssuedQuota)
	assert.Equal(t, 99, granted.IssuedBy)
	require.Positive(t, granted.SubscriptionId)
	var subscription UserSubscription
	require.NoError(t, db.First(&subscription, granted.SubscriptionId).Error)
	assert.EqualValues(t, 75000000, subscription.AmountTotal)
	assert.Equal(t, now.AddDate(1, 0, 0).Unix(), subscription.EndTime)
	assert.Equal(t, MonthlyRebateSubscriptionSource, subscription.Source)
	assert.Equal(t, SubscriptionResetNever, subscription.ResetIntervalUnit)
	assert.Zero(t, subscription.NextResetTime)
	var user User
	require.NoError(t, db.First(&user, 1).Error)
	assert.Equal(t, 12345, user.Quota)
	assert.Equal(t, "default", user.Group)
	replay, err := IssueMonthlyRebate(bill.Id, bill.Revision, 100, now.Add(time.Hour))
	require.NoError(t, err)
	assert.Equal(t, granted.SubscriptionId, replay.SubscriptionId)
	assert.Equal(t, 99, replay.IssuedBy)
	require.NoError(t, db.Model(&UserSubscription{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	// Deleting a reward does not make its historical bill issuable again.
	require.NoError(t, db.Delete(&subscription).Error)
	_, err = IssueMonthlyRebate(bill.Id, bill.Revision, 100, now)
	require.NoError(t, err)
	rows, total, summary, err := ListMonthlyRebates("2026-09", MonthlyRebateIssued, 1, 0, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	assert.Equal(t, "deleted", rows[0].SubscriptionStatus)
	assert.EqualValues(t, 1, summary.Issued)
	assert.EqualValues(t, 75000000, summary.IssuedQuota)
	require.NoError(t, db.Model(&UserSubscription{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestMonthlyRebateRequiresReviewAfterRefundAndPreservesIssuedSnapshot(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	now := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	start, _, err := MonthlyRebateWindow("2026-09", now)
	require.NoError(t, err)
	settlement := PostpaidSettlement{RequestId: "refundable", UserId: 1, WalletQuota: 750000000, StartedAt: start.Unix()}
	require.NoError(t, db.Create(&settlement).Error)
	_, err = RecalculateMonthlyRebates("2026-09", now)
	require.NoError(t, err)
	var bill MonthlyRebate
	require.NoError(t, db.First(&bill).Error)
	// The admin reviewed 1500 USD, but a refund now reduces it to 1000 USD.
	require.NoError(t, db.Model(&settlement).Update("wallet_quota", 500000000).Error)
	changed, err := IssueMonthlyRebate(bill.Id, bill.Revision, 99, now)
	require.ErrorIs(t, err, ErrMonthlyRebateChanged)
	assert.Equal(t, 25000000, changed.RebateQuota)
	assert.Greater(t, changed.Revision, bill.Revision)
	var count int64
	require.NoError(t, db.Model(&UserSubscription{}).Count(&count).Error)
	assert.Zero(t, count)
	granted, err := IssueMonthlyRebate(changed.Id, changed.Revision, 99, now)
	require.NoError(t, err)
	require.NoError(t, db.Model(&settlement).Update("wallet_quota", 0).Error)
	_, err = RecalculateMonthlyRebates("2026-09", now.Add(time.Hour))
	require.NoError(t, err)
	require.NoError(t, db.First(&bill, bill.Id).Error)
	assert.Equal(t, MonthlyRebateNeedsReview, bill.Status)
	assert.Zero(t, bill.RebateQuota)
	assert.Equal(t, 25000000, bill.IssuedQuota)
	assert.EqualValues(t, 500000000, bill.IssuedWalletQuota)
	assert.Equal(t, granted.SubscriptionId, bill.SubscriptionId)
	var subscription UserSubscription
	require.NoError(t, db.First(&subscription, bill.SubscriptionId).Error)
	assert.EqualValues(t, 25000000, subscription.AmountTotal, "reconciliation must not silently claw back issued rewards")
}

func TestMonthlyRebateGrantFailureRollsBackAndCanRetry(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	now := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	start, _, err := MonthlyRebateWindow("2026-09", now)
	require.NoError(t, err)
	require.NoError(t, db.Create(&PostpaidSettlement{RequestId: "grant-failure", UserId: 1, WalletQuota: 500000000, StartedAt: start.Unix()}).Error)
	_, err = RecalculateMonthlyRebates("2026-09", now)
	require.NoError(t, err)
	var bill MonthlyRebate
	require.NoError(t, db.First(&bill).Error)
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:fail-rebate-save", func(tx *gorm.DB) {
		if row, ok := tx.Statement.Dest.(*MonthlyRebate); ok && row.IssuedAt > 0 {
			tx.AddError(errors.New("injected issuance failure"))
		}
	}))
	_, err = IssueMonthlyRebate(bill.Id, bill.Revision, 99, now)
	require.Error(t, err)
	var count int64
	require.NoError(t, db.Model(&UserSubscription{}).Count(&count).Error)
	assert.Zero(t, count, "subscription creation must roll back with the bill")
	require.NoError(t, db.First(&bill, bill.Id).Error)
	assert.Equal(t, MonthlyRebateFailed, bill.Status)
	assert.Contains(t, bill.LastError, "injected issuance failure")
	assert.Zero(t, bill.IssuedAt)
	_, err = RecalculateMonthlyRebates("2026-09", now.Add(time.Hour))
	require.NoError(t, err)
	require.NoError(t, db.First(&bill, bill.Id).Error)
	assert.Equal(t, MonthlyRebateFailed, bill.Status, "background reconciliation must preserve a failed issuance for review")
	require.NoError(t, db.Callback().Update().Remove("test:fail-rebate-save"))
	_, err = IssueMonthlyRebate(bill.Id, bill.Revision, 99, now)
	require.NoError(t, err)
	require.NoError(t, db.Model(&UserSubscription{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestMonthlyRebateBlocksAmbiguousLegacyMidjourneyRefunds(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	now := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	start, _, err := MonthlyRebateWindow("2026-09", now)
	require.NoError(t, err)
	require.NoError(t, db.Create(&PostpaidSettlement{RequestId: "legacy-mj", UserId: 1, WalletQuota: 500000000, StartedAt: start.Unix()}).Error)
	require.NoError(t, db.Create(&Midjourney{UserId: 1, Code: 1, SubmitTime: start.UnixMilli(), Quota: 10000, Status: "FAILURE"}).Error)
	_, err = RecalculateMonthlyRebates("2026-09", now)
	require.NoError(t, err)
	var bill MonthlyRebate
	require.NoError(t, db.First(&bill).Error)
	assert.Equal(t, MonthlyRebateNeedsReview, bill.Status)
	assert.Contains(t, bill.LastError, "Midjourney")
	_, err = IssueMonthlyRebate(bill.Id, bill.Revision, 99, now)
	require.ErrorIs(t, err, ErrMonthlyRebateChanged)
	var count int64
	require.NoError(t, db.Model(&UserSubscription{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestMonthlyRebateConsumptionDoesNotEarnAnotherRebate(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	now := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	start, _, err := MonthlyRebateWindow("2026-09", now)
	require.NoError(t, err)
	require.NoError(t, db.Create(&PostpaidSettlement{RequestId: "original-wallet", UserId: 1, WalletQuota: 500000000, StartedAt: start.Unix()}).Error)
	_, err = RecalculateMonthlyRebates("2026-09", now)
	require.NoError(t, err)
	var bill MonthlyRebate
	require.NoError(t, db.First(&bill).Error)
	_, err = IssueMonthlyRebate(bill.Id, bill.Revision, 99, now)
	require.NoError(t, err)
	// Settlement reads the DB clock, so align the subscription's active window
	// with it while keeping the requested billing month explicit.
	require.NoError(t, db.Model(&UserSubscription{}).Where("user_id = ?", 1).
		Updates(map[string]interface{}{"start_time": GetDBTimestamp() - 1, "end_time": GetDBTimestamp() + 3600}).Error)
	settlement, err := SettlePostpaidRequest(PostpaidSettlementParams{RequestId: "spend-reward", UserId: 1, Quota: 1000000, StartedAt: now.Unix()})
	require.NoError(t, err)
	assert.Equal(t, 1000000, settlement.SubscriptionQuota)
	assert.Zero(t, settlement.WalletQuota)
	processed, err := RecalculateMonthlyRebates("2026-10", now.AddDate(0, 1, 0))
	require.NoError(t, err)
	assert.Zero(t, processed)
}
