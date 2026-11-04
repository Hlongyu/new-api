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
	require.NoError(t, database.Create(&RenameCardBalance{UserId: 42, Balance: 1}).Error)
	title, avatar := "十个字的自定义王者称号", "avatar-one"
	// A title uses the shared weekly allowance without touching the avatar.
	entry, err := UpdateLeaderboardProfile(42, LeaderboardProfileUpdate{CustomTitle: &title, PeriodKey: "week", Now: 100})
	require.NoError(t, err)
	assert.Equal(t, title, entry.CustomTitle)
	assert.Empty(t, entry.AvatarImage)
	balance, err := GetRenameCardBalance(42)
	require.NoError(t, err)
	assert.Equal(t, 1, balance)
	freeUsed, err := HasWeeklyFreeRename(42, "week")
	require.NoError(t, err)
	assert.True(t, freeUsed)
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
	assert.Equal(t, "free", events[0].CostType)
	assert.Equal(t, "card", events[1].CostType)
}

func TestLeaderboardProfileChangesShareWeeklyFreeAllowance(t *testing.T) {
	for _, first := range []string{"name", "title", "avatar"} {
		t.Run(first, func(t *testing.T) {
			database := setupLeaderboardTransactionTest(t, "shared-weekly-"+first)
			require.NoError(t, database.AutoMigrate(&RenameEvent{}))
			require.NoError(t, database.Create(&LeaderboardEntry{Id: 7, UserId: 42, Active: true, DisplayName: "Alice"}).Error)
			name, title, avatar := "Bob", "Champion", "avatar-one"
			changes := map[string]LeaderboardProfileUpdate{
				"name":   {DisplayName: &name, PeriodKey: "week", Now: 100},
				"title":  {CustomTitle: &title, PeriodKey: "week", Now: 100},
				"avatar": {AvatarImage: &avatar, PeriodKey: "week", Now: 100},
			}
			_, err := UpdateLeaderboardProfile(42, changes[first])
			require.NoError(t, err)
			used, err := HasWeeklyFreeRename(42, "week")
			require.NoError(t, err)
			assert.True(t, used)
			for _, next := range []string{"name", "title", "avatar"} {
				_, err = UpdateLeaderboardProfile(42, changes[next])
				if next == first {
					require.NoError(t, err) // Unchanged values consume nothing.
				} else {
					require.ErrorIs(t, err, ErrLeaderboardRenameCardNeeded)
				}
			}
			require.NoError(t, database.Create(&RenameCardBalance{UserId: 42, Balance: 2}).Error)
			_, err = UpdateLeaderboardProfile(42, LeaderboardProfileUpdate{DisplayName: &name, CustomTitle: &title, AvatarImage: &avatar, PeriodKey: "week", Now: 101})
			require.NoError(t, err)
			balance, err := GetRenameCardBalance(42)
			require.NoError(t, err)
			assert.Zero(t, balance)
			avatar = "avatar-next-week"
			_, err = UpdateLeaderboardProfile(42, LeaderboardProfileUpdate{AvatarImage: &avatar, PeriodKey: "next-week", Now: 200})
			require.NoError(t, err)
			var events []RenameEvent
			require.NoError(t, database.Order("created_at ASC, cost_type DESC").Find(&events).Error)
			require.Len(t, events, 4)
			assert.Equal(t, "free", events[0].CostType)
			assert.Equal(t, "card", events[1].CostType)
			assert.Equal(t, "card", events[2].CostType)
			assert.Equal(t, "free", events[3].CostType)
			for _, event := range events {
				assert.NotContains(t, event.NewName, "avatar-")
			}
		})
	}
}

func TestLeaderboardProfileCombinedChangesRollbackWeeklyAllowance(t *testing.T) {
	database := setupLeaderboardTransactionTest(t, "shared-weekly-rollback")
	require.NoError(t, database.AutoMigrate(&RenameEvent{}))
	require.NoError(t, database.Create(&LeaderboardEntry{Id: 7, UserId: 42, Active: true, DisplayName: "Alice"}).Error)
	require.NoError(t, database.Create(&RenameCardBalance{UserId: 42, Balance: 1}).Error)
	name, title, avatar := "Bob", "Champion", "avatar-one"
	update := LeaderboardProfileUpdate{DisplayName: &name, CustomTitle: &title, AvatarImage: &avatar, PeriodKey: "week", Now: 100}
	_, err := UpdateLeaderboardProfile(42, update)
	require.ErrorIs(t, err, ErrLeaderboardRenameCardNeeded)
	stored, err := GetLeaderboardEntryByUserId(42)
	require.NoError(t, err)
	assert.Equal(t, "Alice", stored.DisplayName)
	assert.Empty(t, stored.CustomTitle)
	assert.Empty(t, stored.AvatarImage)
	balance, err := GetRenameCardBalance(42)
	require.NoError(t, err)
	assert.Equal(t, 1, balance)
	var count int64
	require.NoError(t, database.Model(&RenameEvent{}).Count(&count).Error)
	assert.Zero(t, count)
	update.DisplayName = nil
	entry, err := UpdateLeaderboardProfile(42, update)
	require.NoError(t, err)
	assert.Equal(t, title, entry.CustomTitle)
	assert.Equal(t, avatar, entry.AvatarImage)
	balance, err = GetRenameCardBalance(42)
	require.NoError(t, err)
	assert.Zero(t, balance)
	used, err := HasWeeklyFreeRename(42, "week")
	require.NoError(t, err)
	assert.True(t, used)
}
