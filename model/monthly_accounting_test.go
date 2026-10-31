package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAccountingTest(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &AccountingSnapshot{}, &AccountingSnapshotUser{}, &AccountingRedemption{}))
	previousDB, previousBatch, previousType := DB, common.BatchUpdateEnabled, common.MainDatabaseType()
	DB, common.BatchUpdateEnabled = db, false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		DB, common.BatchUpdateEnabled = previousDB, previousBatch
		common.SetMainDatabaseType(previousType)
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	return db
}

func TestAccountingOctoberBaselineAndNovemberIncome(t *testing.T) {
	db := setupAccountingTest(t)
	oct, nov, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	require.NoError(t, db.Create(&[]User{
		{Id: 1, Username: "active", AffCode: "active", Quota: 2_000_000_000},
		{Id: 2, Username: "deleted", AffCode: "deleted", Quota: 1_000_000_000},
	}).Error)
	require.NoError(t, db.Delete(&User{Id: 2}).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(oct.Add(-time.Second), 500000))
	var count int64
	require.NoError(t, db.Model(&AccountingSnapshot{}).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(oct, 500000))
	details, err := ListAccountingSnapshotUsers("2026-10", 0, 20)
	require.NoError(t, err)
	require.Len(t, details, 2)
	assert.True(t, details[1].Deleted)
	assert.EqualValues(t, 1_000_000_000, details[1].Quota)
	// Change the live wallet and retry: October must remain immutable.
	require.NoError(t, db.Model(&User{}).Where("id = ?", 1).Update("quota", 2_200_000_000).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(oct.Add(time.Hour), 100000))
	require.NoError(t, db.Create(&AccountingRedemption{Quota: 800_000_000}).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(nov, 100000))
	rows, err := ListAccountingMonths(nov, 2026)
	require.NoError(t, err)
	require.Len(t, rows, 3)
	assert.Equal(t, "complete", rows[0].Status)
	assert.EqualValues(t, 3_000_000_000, rows[0].Opening.BalanceQuota)
	assert.EqualValues(t, 3_200_000_000, rows[0].Closing.BalanceQuota)
	require.NotNil(t, rows[0].ReceiptsQuota)
	require.NotNil(t, rows[0].RevenueQuota)
	assert.EqualValues(t, 800_000_000, *rows[0].ReceiptsQuota)
	assert.EqualValues(t, 600_000_000, *rows[0].RevenueQuota)
	assert.Equal(t, float64(500000), rows[0].Closing.QuotaPerCNY)
	assert.Equal(t, "in_progress", rows[1].Status)
	assert.Nil(t, rows[1].RevenueQuota)
	assert.Equal(t, "scheduled", rows[2].Status)
}

func TestAccountingMissedBoundaryNeverBecomesHistoricalIncome(t *testing.T) {
	db := setupAccountingTest(t)
	oct, nov, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	require.NoError(t, db.Create(&User{Id: 1, Username: "wallet", Quota: 500}).Error)
	rows, err := ListAccountingMonths(nov, 2026)
	require.NoError(t, err)
	assert.Equal(t, "missing", rows[0].Status)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(oct.Add(2*time.Hour), 500000))
	require.NoError(t, CaptureMonthlyAccountingSnapshot(nov, 500000))
	rows, err = ListAccountingMonths(nov, 2026)
	require.NoError(t, err)
	assert.Equal(t, "late", rows[0].Opening.Status)
	assert.Equal(t, oct.Add(2*time.Hour).Unix(), rows[0].Opening.CapturedAt)
	assert.Equal(t, "review", rows[0].Status)
	assert.Nil(t, rows[0].RevenueQuota)
	assert.Nil(t, rows[0].TransitionAdjustmentQuota)
	assert.Nil(t, rows[0].BookkeepingRevenueQuota)
}

func TestAccountingBatchUpdatesRequireReconciliation(t *testing.T) {
	db := setupAccountingTest(t)
	require.NoError(t, db.Create(&User{Id: 1, Username: "borrower", Quota: -100}).Error)
	oct, nov, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	common.BatchUpdateEnabled = true
	require.NoError(t, CaptureMonthlyAccountingSnapshot(oct, 500000))
	common.BatchUpdateEnabled = false
	require.NoError(t, CaptureMonthlyAccountingSnapshot(nov, 500000))
	rows, err := ListAccountingMonths(nov, 2026)
	require.NoError(t, err)
	assert.Equal(t, "batch_pending", rows[0].Opening.Status)
	assert.Equal(t, "review", rows[0].Status)
	assert.Nil(t, rows[0].RevenueQuota)
	assert.Nil(t, rows[0].TransitionAdjustmentQuota)
	assert.Nil(t, rows[0].BookkeepingRevenueQuota)
}

func TestAccountingCaptureFailureRollsBackClaimAndCanRetry(t *testing.T) {
	db := setupAccountingTest(t)
	oct, _, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	require.NoError(t, db.Migrator().DropTable(&AccountingSnapshotUser{}))
	require.Error(t, CaptureMonthlyAccountingSnapshot(oct, 500000))
	var count int64
	require.NoError(t, db.Model(&AccountingSnapshot{}).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, db.AutoMigrate(&AccountingSnapshotUser{}))
	require.NoError(t, CaptureMonthlyAccountingSnapshot(oct, 500000))
	require.NoError(t, db.Model(&AccountingSnapshot{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestAccountingYearBoundaryUsesFollowingJanuaryClosing(t *testing.T) {
	db := setupAccountingTest(t)
	dec, jan, err := BeijingConsumptionWindow("2026-12")
	require.NoError(t, err)
	require.NoError(t, db.Create(&User{Id: 1, Username: "wallet", Quota: 1000}).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(dec, 500000))
	require.NoError(t, db.Model(&User{}).Where("id = ?", 1).Update("quota", 600).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(jan, 500000))
	rows, err := ListAccountingMonths(jan, 2026)
	require.NoError(t, err)
	require.NotNil(t, rows[2].RevenueQuota)
	assert.EqualValues(t, 400, *rows[2].RevenueQuota)
}

func TestAccountingNegativeWalletAndLoanRepaymentContributeToRevenue(t *testing.T) {
	for _, scenario := range []string{"negative-wallet", "loan-repayment"} {
		t.Run(scenario, func(t *testing.T) {
			db := setupAccountingTest(t)
			oct, nov, err := BeijingConsumptionWindow("2026-10")
			require.NoError(t, err)
			require.NoError(t, db.Create(&User{Id: 1, Username: "wallet", Quota: 1000}).Error)
			require.NoError(t, CaptureMonthlyAccountingSnapshot(oct, 500000))
			if scenario == "negative-wallet" {
				require.NoError(t, db.Model(&User{}).Where("id = ?", 1).Update("quota", -100).Error)
			} else {
				require.NoError(t, db.Create(&AccountingRedemption{Quota: 500, RepaidQuota: 500}).Error)
			}
			require.NoError(t, CaptureMonthlyAccountingSnapshot(nov, 500000))
			rows, err := ListAccountingMonths(nov, 2026)
			require.NoError(t, err)
			assert.Equal(t, "complete", rows[0].Status)
			require.NotNil(t, rows[0].RevenueQuota)
			require.NotNil(t, rows[0].BookkeepingRevenueQuota)
			if scenario == "negative-wallet" {
				assert.EqualValues(t, 1100, *rows[0].RevenueQuota)
				assert.EqualValues(t, 1, rows[0].Closing.NegativeUserCount)
				assert.EqualValues(t, 100, *rows[0].BookkeepingRevenueQuota)
			} else {
				assert.EqualValues(t, 500, *rows[0].RevenueQuota)
				assert.EqualValues(t, -500, *rows[0].BookkeepingRevenueQuota)
			}
		})
	}
}

func TestAccountingCutoverReversesOldIncomeOnceAndPreservesRealBalances(t *testing.T) {
	db := setupAccountingTest(t)
	oct, nov, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	dec := nov.AddDate(0, 1, 0)
	require.NoError(t, db.Create(&User{Id: 1, Username: "cutover", Quota: 30000}).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(oct, 1))
	require.NoError(t, db.Create(&AccountingRedemption{Quota: 20000}).Error)
	require.NoError(t, db.Model(&User{}).Where("id = ?", 1).Update("quota", 38000).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(nov, 1))
	require.NoError(t, db.Create(&AccountingRedemption{Quota: 15000}).Error)
	require.NoError(t, db.Model(&User{}).Where("id = ?", 1).Update("quota", 35000).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(dec, 1))
	rows, err := ListAccountingMonths(dec, 2026)
	require.NoError(t, err)
	require.NotNil(t, rows[0].TransitionAdjustmentQuota)
	require.NotNil(t, rows[0].BookkeepingRevenueQuota)
	require.NotNil(t, rows[1].TransitionAdjustmentQuota)
	require.NotNil(t, rows[1].BookkeepingRevenueQuota)
	assert.EqualValues(t, 30000, rows[0].Opening.BalanceQuota)
	assert.EqualValues(t, 12000, *rows[0].RevenueQuota)
	assert.EqualValues(t, -30000, *rows[0].TransitionAdjustmentQuota)
	assert.EqualValues(t, -18000, *rows[0].BookkeepingRevenueQuota)
	assert.Equal(t, "complete", rows[0].Status)
	assert.Zero(t, *rows[1].TransitionAdjustmentQuota)
	assert.EqualValues(t, 18000, *rows[1].BookkeepingRevenueQuota)
	// Cumulative old cash income + new bookkeeping income equals earned income.
	assert.EqualValues(t, 30000, 30000+*rows[0].BookkeepingRevenueQuota+*rows[1].BookkeepingRevenueQuota)
	again, err := ListAccountingMonths(dec, 2026)
	require.NoError(t, err)
	assert.Equal(t, rows, again)
	details, err := ListAccountingSnapshotUsers("2026-10", 0, 20)
	require.NoError(t, err)
	require.Len(t, details, 1)
	assert.EqualValues(t, 30000, details[0].Quota)
}

func TestAccountingLegacyNegativeSnapshotsKeepReceiptsIncludingRepayment(t *testing.T) {
	for _, delay := range []time.Duration{0, time.Minute} {
		t.Run(delay.String(), func(t *testing.T) {
			db := setupAccountingTest(t)
			oct, nov, err := BeijingConsumptionWindow("2026-10")
			require.NoError(t, err)
			require.NoError(t, db.Create(&[]AccountingSnapshot{
				{Period: "2026-10", ScheduledAt: oct.Unix(), CapturedAt: oct.Add(delay).Unix(), Status: "negative_balance", QuotaPerCNY: 500000, BalanceQuota: 54797035097, RedeemedQuota: 615000000, RepaidQuota: 250000000, NegativeUserCount: 4},
				{Period: "2026-11", ScheduledAt: nov.Unix(), CapturedAt: nov.Unix(), Status: "negative_balance", QuotaPerCNY: 500000, BalanceQuota: 54019378771, RedeemedQuota: 1882500000, RepaidQuota: 1237500000, NegativeUserCount: 5},
			}).Error)
			rows, err := ListAccountingMonths(nov, 2026)
			require.NoError(t, err)
			if delay == 0 {
				assert.Equal(t, "complete", rows[0].Status)
				require.NotNil(t, rows[0].RevenueQuota)
				assert.EqualValues(t, 2045156326, *rows[0].RevenueQuota)
				assert.Equal(t, "captured", rows[0].Opening.Status)
				assert.Equal(t, "in_progress", rows[1].Status)
			} else {
				assert.Equal(t, "review", rows[0].Status)
				assert.Nil(t, rows[0].RevenueQuota)
			}
			var stored AccountingSnapshot
			require.NoError(t, db.First(&stored, "period = ?", "2026-10").Error)
			assert.Equal(t, "negative_balance", stored.Status)
		})
	}
}

func TestAccountingExclusionsRemoveBalancesAndFullReceiptsWithoutChangingSnapshots(t *testing.T) {
	db := setupAccountingTest(t)
	oct, nov, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	require.NoError(t, db.Create(&[]User{
		{Id: 1, Username: "owner", AffCode: "owner", Quota: 1000},
		{Id: 2, Username: "customer", AffCode: "customer", Quota: 2000},
		{Id: 3, Username: "owner-debt", AffCode: "owner-debt", Quota: -100},
	}).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(oct, 1))
	require.NoError(t, db.Create(&[]AccountingRedemption{
		{UserId: 1, Quota: 500, RepaidQuota: 500, CreatedAt: oct.Unix()},
		{UserId: 2, Quota: 300, CreatedAt: oct.Add(time.Hour).Unix()},
	}).Error)
	require.NoError(t, db.Model(&User{}).Where("id = ?", 1).Update("quota", 800).Error)
	require.NoError(t, db.Model(&User{}).Where("id = ?", 2).Update("quota", 1800).Error)
	require.NoError(t, db.Model(&User{}).Where("id = ?", 3).Update("quota", -200).Error)
	require.NoError(t, db.Delete(&User{Id: 3}).Error)
	require.NoError(t, CaptureMonthlyAccountingSnapshot(nov, 1))
	// A receipt at the closing boundary belongs to the next period.
	require.NoError(t, db.Create(&AccountingRedemption{UserId: 1, Quota: 100, CreatedAt: nov.Unix()}).Error)
	rows, err := ListAccountingMonths(nov, 2026, 1, 3)
	require.NoError(t, err)
	require.NotNil(t, rows[0].RevenueQuota)
	assert.EqualValues(t, 2000, rows[0].Opening.BalanceQuota)
	assert.EqualValues(t, 1800, rows[0].Closing.BalanceQuota)
	assert.EqualValues(t, 300, *rows[0].ReceiptsQuota)
	assert.EqualValues(t, 500, *rows[0].RevenueQuota)
	assert.EqualValues(t, -2000, *rows[0].TransitionAdjustmentQuota)
	assert.EqualValues(t, -1500, *rows[0].BookkeepingRevenueQuota)
	all, err := ListAccountingMonths(nov, 2026)
	require.NoError(t, err)
	require.NotNil(t, all[0].RevenueQuota)
	assert.EqualValues(t, 1300, *all[0].RevenueQuota)
	assert.EqualValues(t, 2900, all[0].Opening.BalanceQuota)
	empty, err := ListAccountingMonths(nov, 2026, 1, 2, 3)
	require.NoError(t, err)
	require.NotNil(t, empty[0].RevenueQuota)
	assert.Zero(t, *empty[0].RevenueQuota)
}
