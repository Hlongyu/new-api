package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMonthlyConsumptionMatchesRebateFundingAndIncludesInactiveUsers(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	require.NoError(t, db.Create(&User{Id: 2, Username: "no-usage", AffCode: "no-usage"}).Error)
	require.NoError(t, db.Create(&User{Id: 3, Username: "other-user", AffCode: "other-user"}).Error)
	start, end, err := BeijingConsumptionWindow("2026-09")
	require.NoError(t, err)
	require.NoError(t, db.Create(&[]PostpaidSettlement{
		{RequestId: "mixed", UserId: 1, WalletQuota: 500000000, SubscriptionQuota: 250000000, StartedAt: start.Unix()},
		{RequestId: "refund", UserId: 1, WalletQuota: 0, StartedAt: start.Unix() + 1},
		{RequestId: "old", UserId: 1, WalletQuota: 100, StartedAt: start.Unix() - 1},
		{RequestId: "next", UserId: 1, WalletQuota: 100, StartedAt: end.Unix()},
		{RequestId: "fee:violation", UserId: 1, WalletQuota: 100, StartedAt: start.Unix() + 2},
		{RequestId: "other", UserId: 3, WalletQuota: 250000000, StartedAt: start.Unix() + 3},
	}).Error)
	rows, total, err := ListMonthlyConsumption(start.Unix(), end.Unix(), 0, "", 0, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, rows, 2)
	assert.Equal(t, 1, rows[0].UserId)
	assert.EqualValues(t, 500000000, rows[0].WalletQuota)
	assert.EqualValues(t, 250000000, rows[0].SubscriptionQuota)
	assert.EqualValues(t, 750000000, rows[0].TotalQuota)
	_, err = RecalculateMonthlyRebates("2026-09", time.Unix(end.Unix(), 0))
	require.NoError(t, err)
	var bill MonthlyRebate
	require.NoError(t, db.Where("user_id = ?", 1).First(&bill).Error)
	assert.Equal(t, bill.WalletQuota, rows[0].WalletQuota)
	rows, total, err = ListMonthlyConsumption(start.Unix(), end.Unix(), 0, "", 2, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, rows, 1)
	assert.Equal(t, "no-usage", rows[0].Username)
	assert.Zero(t, rows[0].TotalQuota)
	rows, total, err = ListMonthlyConsumption(start.Unix(), end.Unix(), 1, "", 0, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	assert.Equal(t, 1, rows[0].UserId)
	rows, total, err = ListMonthlyConsumption(start.Unix(), end.Unix(), 0, "no-usage", 0, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	assert.Zero(t, rows[0].WalletQuota)
}
