package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func customSubscriptionTestTime(t *testing.T, year int, month time.Month, day int, hour int) time.Time {
	t.Helper()
	location, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)
	return time.Date(year, month, day, hour, 0, 0, 0, location)
}

func TestResolveCustomSubscriptionResetStateAlignsWeeklyWindowFromMonday(t *testing.T) {
	start := customSubscriptionTestTime(t, 2026, time.September, 7, 0)
	end := customSubscriptionTestTime(t, 2026, time.October, 5, 0)
	current := customSubscriptionTestTime(t, 2026, time.September, 9, 12)

	lastReset, nextReset, err := resolveCustomSubscriptionResetState(
		start.Unix(), end.Unix(), start.Unix(), SubscriptionResetIntervalWeek, 1, "Asia/Shanghai", current.Unix(),
	)

	require.NoError(t, err)
	assert.Equal(t, start.Unix(), lastReset)
	assert.Equal(t, customSubscriptionTestTime(t, 2026, time.September, 14, 0).Unix(), nextReset)

	lastReset, nextReset, err = resolveCustomSubscriptionResetState(
		start.Unix(), end.Unix(), start.Unix(), SubscriptionResetIntervalWeek, 1, "Asia/Shanghai",
		customSubscriptionTestTime(t, 2026, time.September, 28, 0).Unix(),
	)
	require.NoError(t, err)
	assert.Equal(t, customSubscriptionTestTime(t, 2026, time.September, 28, 0).Unix(), lastReset)
	assert.Zero(t, nextReset, "the entitlement end is not another quota refresh")
}

func TestResolveCustomSubscriptionResetStateKeepsDailyNineOClockBoundary(t *testing.T) {
	start := customSubscriptionTestTime(t, 2026, time.September, 10, 9)
	end := customSubscriptionTestTime(t, 2026, time.October, 10, 9)
	current := customSubscriptionTestTime(t, 2026, time.September, 12, 14)

	lastReset, nextReset, err := resolveCustomSubscriptionResetState(
		start.Unix(), end.Unix(), start.Unix(), SubscriptionResetIntervalDay, 1, "Asia/Shanghai", current.Unix(),
	)

	require.NoError(t, err)
	assert.Equal(t, customSubscriptionTestTime(t, 2026, time.September, 12, 9).Unix(), lastReset)
	assert.Equal(t, customSubscriptionTestTime(t, 2026, time.September, 13, 9).Unix(), nextReset)
}

func TestResolveCustomSubscriptionResetStateClampsMonthlyBoundary(t *testing.T) {
	start := customSubscriptionTestTime(t, 2027, time.January, 31, 9)
	end := customSubscriptionTestTime(t, 2027, time.May, 31, 9)
	current := customSubscriptionTestTime(t, 2027, time.February, 28, 14)

	lastReset, nextReset, err := resolveCustomSubscriptionResetState(
		start.Unix(), end.Unix(), start.Unix(), SubscriptionResetIntervalMonth, 1, "Asia/Shanghai", current.Unix(),
	)

	require.NoError(t, err)
	assert.Equal(t, customSubscriptionTestTime(t, 2027, time.February, 28, 9).Unix(), lastReset)
	assert.Equal(t, customSubscriptionTestTime(t, 2027, time.March, 31, 9).Unix(), nextReset)
}

func TestCreateCustomUserSubscriptionStoresIndependentSchedule(t *testing.T) {
	truncateTables(t)
	user := User{
		Username: "custom-subscription-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)
	now := GetDBTimestamp()
	start := now - 2*24*3600

	subscription, err := CreateCustomUserSubscription(user.Id, CustomSubscriptionGrant{
		Title:               "Four week contract",
		StartTime:           start,
		EndTime:             start + 28*24*3600,
		AmountTotal:         1000,
		ResetAnchorTime:     start,
		ResetIntervalValue:  1,
		ResetIntervalUnit:   SubscriptionResetIntervalWeek,
		ResetTimezone:       "Asia/Shanghai",
		PriceAmount:         299,
		AllowWalletOverflow: false,
		GrantedBy:           99,
	})

	require.NoError(t, err)
	assert.Zero(t, subscription.PlanId)
	assert.Equal(t, SubscriptionSourceAdminCustom, subscription.Source)
	assert.Equal(t, "Four week contract", subscription.Title)
	assert.Equal(t, "USD", subscription.Currency)
	assert.EqualValues(t, 299, subscription.PriceAmount)
	assert.Greater(t, subscription.NextResetTime, now)
	assert.False(t, subscription.AllowWalletOverflow)
}

func TestFutureCustomSubscriptionIsNotUsable(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:        7101,
		PlanId:        0,
		AmountTotal:   1000,
		StartTime:     now + 3600,
		EndTime:       now + 7200,
		Status:        "active",
		Source:        SubscriptionSourceAdminCustom,
		ResetTimezone: "UTC",
	}).Error)

	hasQuota, err := HasUsableSubscriptionQuota(7101, now)
	require.NoError(t, err)
	assert.False(t, hasQuota)
	hasActive, err := HasActiveUserSubscription(7101)
	require.NoError(t, err)
	assert.False(t, hasActive)
}

func TestResetDueSubscriptionsResetsCustomSubscriptionWithoutPlan(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	anchor := now - 48*3600 - 60
	subscription := &UserSubscription{
		UserId:              7201,
		PlanId:              0,
		AmountTotal:         1000,
		AmountUsed:          900,
		StartTime:           anchor,
		EndTime:             now + 7*24*3600,
		Status:              "active",
		Source:              SubscriptionSourceAdminCustom,
		LastResetTime:       anchor,
		NextResetTime:       now - 60,
		ResetAnchorTime:     anchor,
		ResetIntervalValue:  1,
		ResetIntervalUnit:   SubscriptionResetIntervalDay,
		ResetTimezone:       "UTC",
		AllowWalletOverflow: true,
	}
	require.NoError(t, DB.Create(subscription).Error)

	resetCount, err := ResetDueSubscriptions(10)
	require.NoError(t, err)
	assert.Equal(t, 1, resetCount)
	require.NoError(t, DB.First(subscription, subscription.Id).Error)
	assert.Zero(t, subscription.AmountUsed)
	assert.Greater(t, subscription.NextResetTime, now)
}

func TestAdminSubscriptionListKeepsInternalNoteOutOfSelfResponse(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:      7301,
		AmountTotal: 1000,
		StartTime:   now - 60,
		EndTime:     now + 3600,
		Status:      "active",
		Source:      SubscriptionSourceAdminCustom,
		Title:       "Private contract",
		AdminNote:   "internal-only terms",
		GrantedBy:   91,
	}).Error)

	selfSubscriptions, err := GetAllUserSubscriptions(7301)
	require.NoError(t, err)
	require.Len(t, selfSubscriptions, 1)
	assert.Empty(t, selfSubscriptions[0].AdminNote)
	assert.Zero(t, selfSubscriptions[0].GrantedBy)

	adminSubscriptions, err := GetAllUserSubscriptionsForAdmin(7301)
	require.NoError(t, err)
	require.Len(t, adminSubscriptions, 1)
	assert.Equal(t, "internal-only terms", adminSubscriptions[0].AdminNote)
	assert.Equal(t, 91, adminSubscriptions[0].GrantedBy)
}
