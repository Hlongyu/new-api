package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetRankProgressReplaysAllCoreHistory(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:rank-replay?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(
		&model.QuotaData{}, &model.SponsorOrder{}, &model.RenameCardOrder{},
	))
	previousDB := model.DB
	previousQuotaPerUnit := common.QuotaPerUnit
	model.DB = database
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() {
		model.DB = previousDB
		common.QuotaPerUnit = previousQuotaPerUnit
	})

	location, err := time.LoadLocation(leaderboardTimeZone)
	require.NoError(t, err)
	historical := time.Date(2018, time.January, 2, 12, 0, 0, 0, location).Unix()
	require.NoError(t, database.Create(&model.QuotaData{
		UserID: 42, CreatedAt: historical, UseGroup: "default",
		Quota: 1_500_000, TokenUsed: 100, Count: 1,
	}).Error)
	require.NoError(t, database.Create(&model.QuotaData{
		UserID: 42, CreatedAt: historical, UseGroup: "",
		Quota: 50_000_000, TokenUsed: 100, Count: 1,
	}).Error)
	require.NoError(t, database.Create(&model.SponsorOrder{
		Id: "sponsor-history", RequestKey: "sponsor-history", UserId: 42,
		AmountCny: 2, Status: model.LeaderboardOrderCompleted,
		CreatedAt: historical, UpdatedAt: historical, CompletedAt: historical,
	}).Error)
	require.NoError(t, database.Create(&model.RenameCardOrder{
		Id: "rename-history", RequestKey: "rename-history", UserId: 42,
		Quantity: 3, AmountCny: 3, Status: model.LeaderboardOrderCompleted,
		CreatedAt: historical, UpdatedAt: historical, CompletedAt: historical,
	}).Error)

	progress, err := GetRankProgress(42)
	require.NoError(t, err)
	assert.EqualValues(t, 3, progress.TokenScore)
	assert.EqualValues(t, 10, progress.SponsorScore)
	assert.EqualValues(t, 6, progress.RenameScore)
	assert.EqualValues(t, 19, progress.TotalScore)
	assert.Equal(t, "黑铁 IV", progress.Label)
	assert.EqualValues(t, 19, progress.Score)
}

func TestTierBoardHidesSponsorBadgeForAnonymousProfile(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:rank-privacy?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(
		&model.QuotaData{}, &model.SponsorOrder{}, &model.RenameCardOrder{},
		&model.LeaderboardEntry{}, &model.LeaderboardExcludedUser{},
	))
	previousDB := model.DB
	previousQuotaPerUnit := common.QuotaPerUnit
	model.DB = database
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() {
		model.DB = previousDB
		common.QuotaPerUnit = previousQuotaPerUnit
	})

	now := time.Now().Unix()
	require.NoError(t, database.Create(&model.LeaderboardEntry{
		UserId: 42, Username: "alice", SourceName: "Alice", DisplayName: "Alice",
		AnonymousName: "Anonymous Alice", CreatedAt: now, Active: true,
		Participating: true, ParticipateRank: true, ShowRankBadge: true,
	}).Error)
	require.NoError(t, database.Create(&model.SponsorOrder{
		Id: "private-sponsor", RequestKey: "private-sponsor", UserId: 42,
		AmountCny: 100, Status: model.LeaderboardOrderCompleted,
		CreatedAt: now, UpdatedAt: now, CompletedAt: now,
	}).Error)

	payload, err := GetTierBoard()
	require.NoError(t, err)
	require.Len(t, payload.Entries, 1)
	assert.Equal(t, "Anonymous Alice", payload.Entries[0].DisplayName)
	assert.Nil(t, payload.Entries[0].SponsorBadge)
	assert.False(t, payload.Entries[0].IsSponsor)
}

func TestUsageBoardCreatesProfileForCoreUsageUser(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:usage-profile-discovery?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(
		&model.User{}, &model.QuotaData{}, &model.SponsorOrder{}, &model.RenameCardOrder{},
		&model.LeaderboardEntry{}, &model.LeaderboardExcludedUser{},
	))
	previousDB := model.DB
	previousQuotaPerUnit := common.QuotaPerUnit
	model.DB = database
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() {
		model.DB = previousDB
		common.QuotaPerUnit = previousQuotaPerUnit
	})

	now := time.Now().Unix()
	require.NoError(t, database.Create(&model.User{Id: 77, Username: "new-user"}).Error)
	require.NoError(t, database.Create(&model.QuotaData{
		UserID: 77, Username: "new-user", CreatedAt: now, UseGroup: "default",
		Quota: 500_000, TokenUsed: 10, Count: 1,
	}).Error)

	payload, err := GetUsageBoard("all")
	require.NoError(t, err)
	require.Len(t, payload.Entries, 1)
	assert.Contains(t, payload.Entries[0].DisplayName, "匿名用户 ")

	entry, err := model.GetLeaderboardEntryByUserId(77)
	require.NoError(t, err)
	assert.Equal(t, "new-user", entry.Username)
	assert.True(t, entry.ParticipateRank)
}
