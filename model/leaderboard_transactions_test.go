package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupLeaderboardTransactionTest(t *testing.T, name string) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(
		&User{}, &LeaderboardEntry{}, &SponsorOrder{}, &RenameCardBalance{},
		&RenameCardOrder{}, &QuotaLoan{}, &QuotaLoanEvent{},
	))
	previousDB := DB
	previousDatabaseType := common.MainDatabaseType()
	previousRedisEnabled := common.RedisEnabled
	DB = database
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousDatabaseType)
		common.RedisEnabled = previousRedisEnabled
	})
	return database
}

func TestLeaderboardWalletOrdersAreIdempotent(t *testing.T) {
	database := setupLeaderboardTransactionTest(t, "leaderboard-wallet-idempotency")
	require.NoError(t, database.Create(&User{Id: 42, Username: "alice", Quota: 20_000_000}).Error)
	require.NoError(t, database.Create(&LeaderboardEntry{
		Id: 7, UserId: 42, Username: "alice", SourceName: "Alice",
		DisplayName: "Alice", AnonymousName: "Anonymous Alice",
		CreatedAt: 1, Active: true, Participating: true,
	}).Error)

	firstCards, err := PurchaseRenameCards("rename-request", 42, 7, 2, 2, 1_000_000, 100)
	require.NoError(t, err)
	secondCards, err := PurchaseRenameCards("rename-request", 42, 7, 2, 2, 1_000_000, 101)
	require.NoError(t, err)
	assert.Equal(t, firstCards.Id, secondCards.Id)

	firstSponsor, err := CreateSponsorOrder("sponsor-request", 42, 7, 4, 2_000_000, false, "", 102)
	require.NoError(t, err)
	secondSponsor, err := CreateSponsorOrder("sponsor-request", 42, 7, 4, 2_000_000, false, "", 103)
	require.NoError(t, err)
	assert.Equal(t, firstSponsor.Id, secondSponsor.Id)

	var user User
	require.NoError(t, database.First(&user, 42).Error)
	assert.Equal(t, 17_000_000, user.Quota)
	var balance RenameCardBalance
	require.NoError(t, database.First(&balance, "user_id = ?", 42).Error)
	assert.Equal(t, 2, balance.Balance)
	var cardOrders int64
	var sponsorOrders int64
	require.NoError(t, database.Model(&RenameCardOrder{}).Count(&cardOrders).Error)
	require.NoError(t, database.Model(&SponsorOrder{}).Count(&sponsorOrders).Error)
	assert.EqualValues(t, 1, cardOrders)
	assert.EqualValues(t, 1, sponsorOrders)
}

func TestQuotaLoanGrantIsIdempotent(t *testing.T) {
	database := setupLeaderboardTransactionTest(t, "quota-loan-idempotency")
	require.NoError(t, database.Create(&User{Id: 42, Username: "alice", Quota: 1_000_000}).Error)

	first, err := CreateQuotaLoan(
		"loan-request", 42, 7, "bronze", "青铜", 10,
		5_000_000, 25_000_000, 1_000, 100,
	)
	require.NoError(t, err)
	second, err := CreateQuotaLoan(
		"loan-request", 42, 7, "bronze", "青铜", 10,
		5_000_000, 25_000_000, 1_000, 101,
	)
	require.NoError(t, err)
	assert.Equal(t, first.Id, second.Id)

	var user User
	require.NoError(t, database.First(&user, 42).Error)
	assert.Equal(t, 6_000_000, user.Quota)
	var loans int64
	var events int64
	require.NoError(t, database.Model(&QuotaLoan{}).Count(&loans).Error)
	require.NoError(t, database.Model(&QuotaLoanEvent{}).Count(&events).Error)
	assert.EqualValues(t, 1, loans)
	assert.EqualValues(t, 0, events)
}

func TestQuotaLoanGrantRejectsMigratedPendingLoan(t *testing.T) {
	database := setupLeaderboardTransactionTest(t, "quota-loan-pending")
	require.NoError(t, database.Create(&User{Id: 42, Username: "alice", Quota: 1_000_000}).Error)
	require.NoError(t, database.Create(&QuotaLoan{
		Id: "legacy-unknown", RequestKey: "legacy-unknown", UserId: 42, EntryId: 7,
		TierKey: "bronze", TierName: "青铜", CreditAmount: 10, QuotaAmount: 5_000_000,
		OutstandingQuota: 5_000_000, Status: LeaderboardOrderUnknown,
		CreatedAt: 1, UpdatedAt: 1, DueAt: 1_000,
	}).Error)

	_, err := CreateQuotaLoan(
		"new-request", 42, 7, "bronze", "青铜", 10,
		5_000_000, 25_000_000, 1_000, 100,
	)
	assert.ErrorIs(t, err, ErrQuotaLoanPending)

	var user User
	require.NoError(t, database.First(&user, 42).Error)
	assert.Equal(t, 1_000_000, user.Quota)
}
