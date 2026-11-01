package model

import (
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestGroupConsumptionOwnerSnapshotExclusionsAndRefunds(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	previous := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previous })
	require.NoError(t, db.AutoMigrate(&Log{}))
	require.NoError(t, db.Create(&[]PostpaidSettlement{
		{RequestId: "mixed", UserId: 2, ActualQuota: 150, WalletQuota: 100, SubscriptionQuota: 50, StartedAt: 100, CreatedAt: 100, UpdatedAt: 100},
		{RequestId: "excluded", UserId: 3, ActualQuota: 90, WalletQuota: 90, StartedAt: 101, CreatedAt: 101, UpdatedAt: 101},
		{RequestId: "refunded", UserId: 2, StartedAt: 102},
		{RequestId: "other", UserId: 2, ActualQuota: 800, WalletQuota: 800, StartedAt: 103, CreatedAt: 103, UpdatedAt: 103},
		{RequestId: "missing", UserId: 2, ActualQuota: 20, WalletQuota: 20, StartedAt: 104},
		{RequestId: "boundary", UserId: 2, ActualQuota: 70, WalletQuota: 70, StartedAt: 200},
	}).Error)
	require.NoError(t, db.Create(&[]Log{
		{RequestId: "mixed", Group: "custom-a", GroupOwnerUserID: 1, Type: LogTypeConsume},
		{RequestId: "mixed", Group: "custom-a", GroupOwnerUserID: 1, Type: LogTypeConsume},
		{RequestId: "excluded", Group: "custom-a", GroupOwnerUserID: 1, Type: LogTypeConsume},
		{RequestId: "refunded", Group: "custom-a", GroupOwnerUserID: 1, Type: LogTypeConsume},
		{RequestId: "other", Group: "custom-b", GroupOwnerUserID: 9, Type: LogTypeConsume},
		{RequestId: "boundary", Group: "custom-a", GroupOwnerUserID: 1, Type: LogTypeConsume},
	}).Error)
	report, err := ListGroupConsumption(100, 200, 1, []int{3}, nil)
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	assert.Equal(t, GroupConsumption{Group: "custom-a", OwnerUserID: 1, WalletQuota: 100, SubscriptionQuota: 50, TotalQuota: 150, Requests: 2}, report.Items[0])
	assert.Zero(t, report.UnattributedRequests)
	report, err = ListGroupConsumption(100, 200, 0, nil, nil)
	require.NoError(t, err)
	require.Len(t, report.Items, 2)
	assert.EqualValues(t, 190, report.Items[0].WalletQuota)
	assert.EqualValues(t, 1, report.UnattributedRequests)
}

func TestAccountingGroupExclusionDoesNotDoubleDeductUsersOrSubscriptions(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	previous := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previous })
	require.NoError(t, db.AutoMigrate(&Log{}))
	require.NoError(t, db.Create(&[]PostpaidSettlement{
		{RequestId: "included", UserId: 2, ActualQuota: 150, WalletQuota: 100, SubscriptionQuota: 50, StartedAt: 100, CreatedAt: 100, UpdatedAt: 100},
		{RequestId: "excluded", UserId: 3, ActualQuota: 900, WalletQuota: 900, StartedAt: 101, CreatedAt: 101, UpdatedAt: 101},
	}).Error)
	require.NoError(t, db.Create(&[]Log{
		{RequestId: "included", Group: "custom-a", Type: LogTypeConsume},
		{RequestId: "excluded", Group: "custom-a", Type: LogTypeConsume},
	}).Error)
	revenue, bookkeeping := int64(300), int64(-200)
	rows := []AccountingMonth{{Status: "complete", Opening: &AccountingSnapshot{CapturedAt: 100}, Closing: &AccountingSnapshot{CapturedAt: 200}, RevenueQuota: &revenue, BookkeepingRevenueQuota: &bookkeeping}}
	require.NoError(t, ApplyAccountingGroupExclusions(rows, []string{"custom-a"}, []int{3}))
	require.NotNil(t, rows[0].RevenueQuota)
	assert.EqualValues(t, 200, *rows[0].RevenueQuota)
	assert.EqualValues(t, -300, *rows[0].BookkeepingRevenueQuota)
	assert.EqualValues(t, 100, *rows[0].ExcludedGroupWalletQuota)
	require.NoError(t, db.Create(&PostpaidSettlement{RequestId: "missing", UserId: 2, ActualQuota: 10, WalletQuota: 10, StartedAt: 103, CreatedAt: 103, UpdatedAt: 103}).Error)
	require.NoError(t, ApplyAccountingGroupExclusions(rows, []string{"custom-a"}, []int{3}))
	assert.Equal(t, "review", rows[0].Status)
	assert.Nil(t, rows[0].RevenueQuota)
	assert.Nil(t, rows[0].BookkeepingRevenueQuota)
}

func TestAccountingGroupExclusionRequiresReviewForCrossMonthSettlement(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	for _, tc := range []struct {
		name                      string
		started, created, updated int64
	}{
		{"late settlement", 150, 210, 210},
		{"later refund", 150, 150, 210},
		{"previous month request settled this month", 90, 110, 110},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, db.Exec("DELETE FROM postpaid_settlements").Error)
			require.NoError(t, db.Create(&PostpaidSettlement{RequestId: tc.name, UserId: 2, WalletQuota: 100, StartedAt: tc.started, CreatedAt: tc.created, UpdatedAt: tc.updated}).Error)
			revenue := int64(300)
			rows := []AccountingMonth{{Status: "complete", Opening: &AccountingSnapshot{CapturedAt: 100}, Closing: &AccountingSnapshot{CapturedAt: 200}, RevenueQuota: &revenue, BookkeepingRevenueQuota: &revenue}}
			require.NoError(t, ApplyAccountingGroupExclusions(rows, []string{"custom-a"}, nil))
			assert.Equal(t, "review", rows[0].Status)
			assert.Nil(t, rows[0].RevenueQuota)
		})
	}
}

func TestConsumptionDimensionsShareScopeFundingAndExclusions(t *testing.T) {
	db := setupMonthlyRebateTest(t)
	previous := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previous })
	require.NoError(t, db.AutoMigrate(&Log{}))
	require.NoError(t, db.Create(&[]PostpaidSettlement{
		{RequestId: "a-user2", UserId: 2, WalletQuota: 100, SubscriptionQuota: 50, StartedAt: 100},
		{RequestId: "a-user3", UserId: 3, WalletQuota: 40, SubscriptionQuota: 20, StartedAt: 101},
		{RequestId: "b-user2", UserId: 2, WalletQuota: 200, SubscriptionQuota: 70, StartedAt: 102},
		{RequestId: "foreign", UserId: 2, WalletQuota: 900, SubscriptionQuota: 300, StartedAt: 103},
	}).Error)
	require.NoError(t, db.Create(&[]Log{
		{RequestId: "a-user2", Group: "custom-a", GroupOwnerUserID: 1, Type: LogTypeConsume},
		{RequestId: "a-user3", Group: "custom-a", GroupOwnerUserID: 1, Type: LogTypeConsume},
		{RequestId: "b-user2", Group: "custom-b", GroupOwnerUserID: 1, Type: LogTypeConsume},
		{RequestId: "foreign", Group: "custom-other", GroupOwnerUserID: 9, Type: LogTypeConsume},
	}).Error)
	filters := ConsumptionFilters{Dimension: "user", Source: "all", GroupExclusions: map[string][]int{"custom-a": {2}}}
	report, err := QueryConsumption(100, 200, 1, filters)
	require.NoError(t, err)
	require.Len(t, report.Items, 2)
	assert.Equal(t, 2, report.Items[0].UserID)
	assert.EqualValues(t, 270, report.Items[0].TotalQuota)
	assert.EqualValues(t, 60, report.Items[1].TotalQuota)
	assert.Len(t, report.Groups, 2)
	filters.Dimension = "group"
	grouped, err := QueryConsumption(100, 200, 1, filters)
	require.NoError(t, err)
	assert.Equal(t, report.Items[0].TotalQuota+report.Items[1].TotalQuota, grouped.Items[0].TotalQuota+grouped.Items[1].TotalQuota)
	filters.Dimension = "user"
	filters.Group = "custom-a"
	filters.Source = "subscription"
	filters.UserID = 3
	report, err = QueryConsumption(100, 200, 1, filters)
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	assert.EqualValues(t, 0, report.Items[0].WalletQuota)
	assert.EqualValues(t, 20, report.Items[0].SubscriptionQuota)
	assert.EqualValues(t, 20, report.Items[0].TotalQuota)
	assert.EqualValues(t, 1, report.Items[0].Requests)
	filters.Group = "custom-other"
	report, err = QueryConsumption(100, 200, 1, filters)
	require.NoError(t, err)
	assert.Empty(t, report.Items)
	filters = ConsumptionFilters{Dimension: "user", Source: "all", UserID: 2}
	report, err = QueryConsumption(100, 200, 0, filters)
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	assert.EqualValues(t, 1620, report.Items[0].TotalQuota)
}
