package model

import (
	"fmt"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupConsumptionMonthTest(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupMonthlyRebateTest(t)
	previousLog := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousLog })
	require.NoError(t, db.AutoMigrate(&Log{}, &PersonalGroup{}, &ConsumptionMonth{}, &ConsumptionAttribution{}, &ConsumptionContribution{}, &ConsumptionAggregate{}))
	return db
}

func TestPersistedConsumptionSurvivesRestartAndLogRetention(t *testing.T) {
	db := setupConsumptionMonthTest(t)
	start, end, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	require.NoError(t, db.Create(&PostpaidSettlement{RequestId: "historical", UserId: 2, WalletQuota: 100, SubscriptionQuota: 50, StartedAt: start.Unix(), CreatedAt: start.Unix(), UpdatedAt: start.Unix()}).Error)
	require.NoError(t, db.Create(&Log{RequestId: "historical", Group: "custom-a", GroupOwnerUserID: 1, Type: LogTypeConsume}).Error)
	filters := ConsumptionFilters{Dimension: "group", Source: "all"}
	first, err := QueryPersistedConsumption(start.Unix(), end.Unix(), 1, filters)
	require.NoError(t, err)
	require.Len(t, first.Items, 1)
	assert.EqualValues(t, 150, first.Items[0].TotalQuota)
	var original PostpaidSettlement
	require.NoError(t, db.Where("request_id = ?", "historical").First(&original).Error)
	assert.Equal(t, start.Unix(), original.UpdatedAt, "reporting must not rewrite billing timestamps")

	// A fresh DB handle has no in-process state. Removing raw logs proves that the
	// next query consumes persisted aggregates rather than rebuilding attribution.
	reopened, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := reopened.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	DB, LOG_DB = reopened, reopened
	require.NoError(t, reopened.Migrator().DropTable(&Log{}))
	report, err := QueryPersistedConsumption(start.Unix(), end.Unix(), 1, filters)
	require.NoError(t, err)
	assert.Equal(t, first.Items, report.Items)
	filters.Dimension = "user"
	filters.Source = "wallet"
	filters.GroupExclusions = map[string][]int{"custom-a": {2}}
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 0, filters)
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	assert.Zero(t, report.Items[0].TotalQuota)
	foreign, err := QueryPersistedConsumption(start.Unix(), end.Unix(), 9, filters)
	require.NoError(t, err)
	assert.Empty(t, foreign.Items)
}

func TestPersistedConsumptionIncrementalSettlementRefundAndLateAttribution(t *testing.T) {
	db := setupConsumptionMonthTest(t)
	start, end, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	filters := ConsumptionFilters{Dimension: "group", Source: "all"}
	report, err := QueryPersistedConsumption(start.Unix(), end.Unix(), 0, filters)
	require.NoError(t, err)
	assert.Empty(t, report.Items)
	params := PostpaidSettlementParams{RequestId: "new-request", UserId: 1, Quota: 100, StartedAt: start.Unix() + 1}
	_, err = SettlePostpaidRequest(params)
	require.NoError(t, err)
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 0, filters)
	require.NoError(t, err)
	assert.EqualValues(t, 1, report.UnattributedRequests)
	// Consume log arrives after an earlier query already counted missing attribution.
	require.NoError(t, createLog(&Log{RequestId: params.RequestId, UserId: 1, Group: "custom-a", GroupOwnerUserID: 3, Type: LogTypeConsume}))
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 3, filters)
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	assert.EqualValues(t, 100, report.Items[0].WalletQuota)
	// Duplicate log/settlement notifications never double count the request.
	require.NoError(t, createLog(&Log{RequestId: params.RequestId, UserId: 1, Group: "custom-a", GroupOwnerUserID: 3, Type: LogTypeConsume}))
	_, err = SettlePostpaidRequest(params)
	require.NoError(t, err)
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 0, filters)
	require.NoError(t, err)
	assert.EqualValues(t, 100, report.Items[0].WalletQuota)
	assert.EqualValues(t, 1, report.Items[0].Requests)
	assert.Zero(t, report.UnattributedRequests)
	require.NoError(t, db.Migrator().DropTable(&Log{}))
	params.Quota = 20
	_, err = SettlePostpaidRequest(params)
	require.NoError(t, err)
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 3, filters)
	require.NoError(t, err)
	assert.EqualValues(t, 20, report.Items[0].WalletQuota)
	params.Quota = 0
	_, err = SettlePostpaidRequest(params)
	require.NoError(t, err)
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 3, filters)
	require.NoError(t, err)
	assert.Zero(t, report.Items[0].WalletQuota)
	assert.EqualValues(t, 1, report.Items[0].Requests)
	var state ConsumptionMonth
	require.NoError(t, db.First(&state, "period = ?", "2026-10").Error)
	assert.True(t, state.Initialized)
	assert.Zero(t, state.BackfillLimit, "new requests do not reset the completed backfill")
}

func TestPersistedConsumptionLogBeforeSettlementAndConflictingOwner(t *testing.T) {
	db := setupConsumptionMonthTest(t)
	start, end, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	filters := ConsumptionFilters{Dimension: "group", Source: "all"}
	require.NoError(t, createLog(&Log{RequestId: "early-log", Group: "custom-a", GroupOwnerUserID: 3, Type: LogTypeConsume}))
	params := PostpaidSettlementParams{RequestId: "early-log", UserId: 1, Quota: 100, StartedAt: start.Unix()}
	_, err = SettlePostpaidRequest(params)
	require.NoError(t, err)
	report, err := QueryPersistedConsumption(start.Unix(), end.Unix(), 3, filters)
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	require.NoError(t, createLog(&Log{RequestId: "early-log", Group: "custom-b", GroupOwnerUserID: 4, Type: LogTypeConsume}))
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 4, filters)
	require.NoError(t, err)
	assert.Empty(t, report.Items)
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 3, filters)
	require.NoError(t, err)
	assert.Empty(t, report.Items)
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 0, filters)
	require.NoError(t, err)
	assert.EqualValues(t, 1, report.UnattributedRequests)
	var count int64
	require.NoError(t, db.Model(&ConsumptionContribution{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestConsumptionMonthBackfillResumesAtBatchBoundary(t *testing.T) {
	db := setupConsumptionMonthTest(t)
	start, end, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	// One more than a backfill batch protects checkpoint recovery at the boundary.
	settlements := make([]PostpaidSettlement, 501)
	logs := make([]Log, 501)
	for i := range settlements {
		id := fmt.Sprintf("batch-%d", i)
		settlements[i] = PostpaidSettlement{RequestId: id, UserId: 1, WalletQuota: 1, StartedAt: start.Unix()}
		logs[i] = Log{RequestId: id, Group: "custom-a", GroupOwnerUserID: 3, Type: LogTypeConsume}
	}
	require.NoError(t, db.CreateInBatches(&settlements, 100).Error)
	require.NoError(t, db.CreateInBatches(&logs, 100).Error)
	done, err := syncConsumptionMonthBatch(db, db, "2026-10", start.Unix(), end.Unix())
	require.NoError(t, err)
	assert.False(t, done)
	var checkpoint ConsumptionMonth
	require.NoError(t, db.First(&checkpoint, "period = ?", "2026-10").Error)
	assert.Equal(t, settlements[499].Id, checkpoint.BackfillID)
	// First batch no longer has logs. Resuming must not revisit it or lose totals.
	require.NoError(t, db.Where("request_id <> ?", settlements[500].RequestId).Delete(&Log{}).Error)
	report, err := QueryPersistedConsumption(start.Unix(), end.Unix(), 3, ConsumptionFilters{Dimension: "group", Source: "all"})
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	assert.EqualValues(t, 501, report.Items[0].WalletQuota)
	assert.EqualValues(t, 501, report.Items[0].Requests)
}

func TestConsumptionMonthFailureRollsBackContributionAndRetries(t *testing.T) {
	db := setupConsumptionMonthTest(t)
	start, end, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	require.NoError(t, db.Create(&PostpaidSettlement{RequestId: "rollback", UserId: 1, WalletQuota: 100, StartedAt: start.Unix()}).Error)
	require.NoError(t, db.Create(&Log{RequestId: "rollback", Group: "custom-a", GroupOwnerUserID: 3, Type: LogTypeConsume}).Error)
	require.NoError(t, db.Exec("CREATE TRIGGER fail_contribution BEFORE INSERT ON consumption_contributions BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").Error)
	_, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 0, ConsumptionFilters{Dimension: "group", Source: "all"})
	require.Error(t, err)
	var count int64
	require.NoError(t, db.Model(&ConsumptionAggregate{}).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, db.Exec("DROP TRIGGER fail_contribution").Error)
	report, err := QueryPersistedConsumption(start.Unix(), end.Unix(), 3, ConsumptionFilters{Dimension: "group", Source: "all"})
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	assert.EqualValues(t, 100, report.Items[0].WalletQuota)
}

func TestPersistedHistoricalConflictCannotTransferOwnershipOnRetry(t *testing.T) {
	db := setupConsumptionMonthTest(t)
	start, end, err := BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	require.NoError(t, db.Create(&PostpaidSettlement{RequestId: "legacy-conflict", UserId: 1, WalletQuota: 100, StartedAt: start.Unix()}).Error)
	require.NoError(t, db.Create(&Log{RequestId: "legacy-conflict", Group: "custom-a", GroupOwnerUserID: 3, Type: LogTypeConsume}).Error)
	filters := ConsumptionFilters{Dimension: "group", Source: "all"}
	report, err := QueryPersistedConsumption(start.Unix(), end.Unix(), 3, filters)
	require.NoError(t, err)
	require.Len(t, report.Items, 1)
	require.NoError(t, createLog(&Log{RequestId: "legacy-conflict", Group: "custom-b", GroupOwnerUserID: 4, Type: LogTypeConsume}))
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 4, filters)
	require.NoError(t, err)
	assert.Empty(t, report.Items)
	require.NoError(t, createLog(&Log{RequestId: "legacy-conflict", Group: "custom-b", GroupOwnerUserID: 4, Type: LogTypeConsume}))
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 4, filters)
	require.NoError(t, err)
	assert.Empty(t, report.Items)
	report, err = QueryPersistedConsumption(start.Unix(), end.Unix(), 0, filters)
	require.NoError(t, err)
	assert.EqualValues(t, 1, report.UnattributedRequests)
}
