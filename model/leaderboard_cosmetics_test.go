package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLeaderboardCosmeticsChargeIndependentlyAndRollback(t *testing.T) {
	database := setupLeaderboardTransactionTest(t, "cosmetics-charges")
	require.NoError(t, database.AutoMigrate(&RenameEvent{}))
	require.NoError(t, database.Create(&LeaderboardEntry{Id: 7, UserId: 42, Active: true, DisplayName: "Alice"}).Error)
	require.NoError(t, database.Create(&RenameCardBalance{UserId: 42, Balance: 2}).Error)
	title, avatar := "十个字的自定义王者称号", "avatar-one"
	// A title does not touch the avatar or use the weekly free rename.
	entry, err := UpdateLeaderboardProfile(42, LeaderboardProfileUpdate{CustomTitle: &title, PeriodKey: "week", Now: 100})
	require.NoError(t, err)
	assert.Equal(t, title, entry.CustomTitle)
	assert.Empty(t, entry.AvatarImage)
	balance, err := GetRenameCardBalance(42)
	require.NoError(t, err)
	assert.Equal(t, 1, balance)
	freeUsed, err := HasWeeklyFreeRename(42, "week")
	require.NoError(t, err)
	assert.False(t, freeUsed)
	// Repeating a successful save is free.
	_, err = UpdateLeaderboardProfile(42, LeaderboardProfileUpdate{CustomTitle: &title, PeriodKey: "week", Now: 101})
	require.NoError(t, err)
	nextTitle := "新称号"
	_, err = UpdateLeaderboardProfile(42, LeaderboardProfileUpdate{CustomTitle: &nextTitle, AvatarImage: &avatar, PeriodKey: "week", Now: 102})
	require.Error(t, err)
	stored, err := GetLeaderboardEntryByUserId(42)
	require.NoError(t, err)
	assert.Equal(t, title, stored.CustomTitle)
	assert.Empty(t, stored.AvatarImage)
	balance, err = GetRenameCardBalance(42)
	require.NoError(t, err)
	assert.Equal(t, 1, balance)
	entry, err = UpdateLeaderboardProfile(42, LeaderboardProfileUpdate{AvatarImage: &avatar, PeriodKey: "week", Now: 103})
	require.NoError(t, err)
	assert.Equal(t, title, entry.CustomTitle)
	assert.Equal(t, avatar, entry.AvatarImage)
	balance, err = GetRenameCardBalance(42)
	require.NoError(t, err)
	assert.Zero(t, balance)
	var events []RenameEvent
	require.NoError(t, database.Find(&events).Error)
	require.Len(t, events, 2)
	assert.Equal(t, "card", events[0].CostType)
	assert.Equal(t, "card", events[1].CostType)
}
