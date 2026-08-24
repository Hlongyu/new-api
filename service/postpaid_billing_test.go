package service

import (
	"errors"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPostpaidAdmissionDoesNotReserveQuota(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 801, 100)
	seedToken(t, 901, 801, "postpaid-admission", 1_000)

	info := &relaycommon.RelayInfo{
		UserId: 801, TokenId: 901, TokenKey: "postpaid-admission",
		RequestId: "postpaid-admission", StartTime: time.Now(),
	}
	ctx, _ := gin.CreateTestContext(nil)

	require.Nil(t, PreConsumeBilling(ctx, 500, info))
	require.NotNil(t, info.Billing)
	assert.Zero(t, info.FinalPreConsumedQuota)

	userQuota, err := model.GetUserQuota(801, true)
	require.NoError(t, err)
	assert.Equal(t, 100, userQuota)
	token, err := model.GetTokenById(901)
	require.NoError(t, err)
	assert.Equal(t, 1_000, token.RemainQuota)
}

func TestPostpaidSettlementConsumesSubscriptionsThenAllowsWalletArrears(t *testing.T) {
	truncate(t)
	seedUser(t, 802, 10)
	seedToken(t, 902, 802, "postpaid-split", 1_000)
	now := time.Now()
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		Id: 1001, UserId: 802, AmountTotal: 30, AmountUsed: 20,
		Status: "active", EndTime: now.Add(time.Hour).Unix(),
	}).Error)
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		Id: 1002, UserId: 802, AmountTotal: 20, AmountUsed: 5,
		Status: "active", EndTime: now.Add(2 * time.Hour).Unix(),
	}).Error)

	params := model.PostpaidSettlementParams{
		RequestId: "postpaid-split", UserId: 802, TokenId: 902,
		TokenKey: "postpaid-split", Quota: 50, StartedAt: now.Unix(),
	}
	result, err := model.SettlePostpaidRequest(params)
	require.NoError(t, err)
	assert.Equal(t, 25, result.SubscriptionQuota)
	assert.Equal(t, 25, result.WalletQuota)

	userQuota, err := model.GetUserQuota(802, true)
	require.NoError(t, err)
	assert.Equal(t, -15, userQuota)
	var first, second model.UserSubscription
	require.NoError(t, model.DB.First(&first, 1001).Error)
	require.NoError(t, model.DB.First(&second, 1002).Error)
	assert.EqualValues(t, 30, first.AmountUsed)
	assert.EqualValues(t, 20, second.AmountUsed)

	// Repeating the same target is a no-op rather than a duplicate charge.
	result, err = model.SettlePostpaidRequest(params)
	require.NoError(t, err)
	assert.Zero(t, result.AppliedDelta)
	userQuota, err = model.GetUserQuota(802, true)
	require.NoError(t, err)
	assert.Equal(t, -15, userQuota)

	token, err := model.GetTokenById(902)
	require.NoError(t, err)
	assert.Equal(t, 950, token.RemainQuota)
}

func TestPostpaidTargetReductionRefundsWalletBeforeSubscription(t *testing.T) {
	truncate(t)
	seedUser(t, 803, 10)
	seedToken(t, 903, 803, "postpaid-refund", 1_000)
	now := time.Now()
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		Id: 1003, UserId: 803, AmountTotal: 30, AmountUsed: 20,
		Status: "active", EndTime: now.Add(time.Hour).Unix(),
	}).Error)
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		Id: 1004, UserId: 803, AmountTotal: 20, AmountUsed: 5,
		Status: "active", EndTime: now.Add(2 * time.Hour).Unix(),
	}).Error)

	params := model.PostpaidSettlementParams{
		RequestId: "postpaid-refund", UserId: 803, TokenId: 903,
		TokenKey: "postpaid-refund", Quota: 50, StartedAt: now.Unix(),
	}
	_, err := model.SettlePostpaidRequest(params)
	require.NoError(t, err)
	params.Quota = 20
	result, err := model.SettlePostpaidRequest(params)
	require.NoError(t, err)
	assert.Equal(t, 20, result.SubscriptionQuota)
	assert.Zero(t, result.WalletQuota)

	userQuota, err := model.GetUserQuota(803, true)
	require.NoError(t, err)
	assert.Equal(t, 10, userQuota)
	var first, second model.UserSubscription
	require.NoError(t, model.DB.First(&first, 1003).Error)
	require.NoError(t, model.DB.First(&second, 1004).Error)
	assert.EqualValues(t, 30, first.AmountUsed)
	assert.EqualValues(t, 15, second.AmountUsed)
}

func TestPostpaidRefundAfterSubscriptionResetDoesNotCreateNegativeUsage(t *testing.T) {
	truncate(t)
	seedUser(t, 806, 10)
	seedToken(t, 906, 806, "postpaid-reset-refund", 1_000)
	now := time.Now()
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		Id: 1006, UserId: 806, AmountTotal: 100, AmountUsed: 0,
		Status: "active", EndTime: now.Add(time.Hour).Unix(),
	}).Error)
	params := model.PostpaidSettlementParams{
		RequestId: "postpaid-reset-refund", UserId: 806, TokenId: 906,
		TokenKey: "postpaid-reset-refund", Quota: 40, StartedAt: now.Unix(),
	}
	_, err := model.SettlePostpaidRequest(params)
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).Where("id = ?", 1006).Update("amount_used", 0).Error)

	params.Quota = 0
	result, err := model.SettlePostpaidRequest(params)
	require.NoError(t, err)
	assert.Zero(t, result.SubscriptionQuota)
	var subscription model.UserSubscription
	require.NoError(t, model.DB.First(&subscription, 1006).Error)
	assert.Zero(t, subscription.AmountUsed)
}

func TestPostpaidAdmissionAllowsUsableSubscriptionWithNegativeWallet(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 804, -10)
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		Id: 1005, UserId: 804, AmountTotal: 100, AmountUsed: 0,
		Status: "active", EndTime: time.Now().Add(time.Hour).Unix(),
	}).Error)

	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{UserId: 804}
	session, apiErr := NewBillingSession(ctx, info, 0)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, -10, info.UserQuota)
}

func TestPostpaidAdmissionRejectsUnavailableSubscriptionsWithoutWallet(t *testing.T) {
	tests := []struct {
		name       string
		status     string
		endTime    int64
		amountUsed int64
	}{
		{name: "exhausted", status: "active", endTime: time.Now().Add(time.Hour).Unix(), amountUsed: 100},
		{name: "expired", status: "active", endTime: time.Now().Add(-time.Hour).Unix(), amountUsed: 0},
		{name: "cancelled", status: "cancelled", endTime: time.Now().Add(time.Hour).Unix(), amountUsed: 0},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			truncate(t)
			userId := 810 + index
			seedUser(t, userId, 0)
			require.NoError(t, model.DB.Create(&model.UserSubscription{
				Id: 1010 + index, UserId: userId, AmountTotal: 100, AmountUsed: test.amountUsed,
				Status: test.status, EndTime: test.endTime,
			}).Error)

			ctx, _ := gin.CreateTestContext(nil)
			_, apiErr := NewBillingSession(ctx, &relaycommon.RelayInfo{UserId: userId}, 0)
			require.NotNil(t, apiErr)
			assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
		})
	}
}

func TestTokenRateLimitsUseFirstCallAnchoredWindows(t *testing.T) {
	truncate(t)
	now := time.Date(2026, time.August, 24, 12, 0, 0, 0, time.UTC)
	seedUser(t, 805, 100)
	seedToken(t, 905, 805, "periodic-limit", 1_000)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 905).
		Updates(map[string]interface{}{
			"five_hour_quota": 40,
			"daily_quota":     100,
			"weekly_quota":    200,
		}).Error)
	token, err := model.GetTokenById(905)
	require.NoError(t, err)
	require.NoError(t, model.CheckTokenQuotaLimits(token, now.Unix()))
	usage, err := model.GetTokenQuotaUsageState(905, now.Unix())
	require.NoError(t, err)
	assert.Zero(t, usage.FiveHourUsed)
	assert.Equal(t, now.Add(5*time.Hour).Unix(), usage.FiveHourResetAt)
	assert.Equal(t, now.Add(24*time.Hour).Unix(), usage.DailyResetAt)
	assert.Equal(t, now.Add(7*24*time.Hour).Unix(), usage.WeeklyResetAt)

	_, err = model.SettlePostpaidRequest(model.PostpaidSettlementParams{
		RequestId: "periodic-limit", UserId: 805, TokenId: 905,
		TokenKey: "periodic-limit", Quota: 50, StartedAt: now.Unix(),
	})
	require.NoError(t, err)
	token, err = model.GetTokenById(905)
	require.NoError(t, err)
	err = model.CheckTokenQuotaLimits(token, now.Unix())
	require.Error(t, err)
	assert.True(t, errors.Is(err, model.ErrTokenFiveHourQuotaExceeded))

	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 905).Update("five_hour_quota", 200).Error)
	token, err = model.GetTokenById(905)
	require.NoError(t, err)
	tenHoursLater := now.Add(10 * time.Hour)
	require.NoError(t, model.CheckTokenQuotaLimits(token, tenHoursLater.Unix()))
	usage, err = model.GetTokenQuotaUsageState(905, tenHoursLater.Unix())
	require.NoError(t, err)
	assert.Zero(t, usage.FiveHourUsed)
	assert.Equal(t, tenHoursLater.Add(5*time.Hour).Unix(), usage.FiveHourResetAt)
	assert.EqualValues(t, 50, usage.DailyUsed)

	_, err = model.SettlePostpaidRequest(model.PostpaidSettlementParams{
		RequestId: "periodic-limit-ten-hours", UserId: 805, TokenId: 905,
		TokenKey: "periodic-limit", Quota: 60, StartedAt: tenHoursLater.Unix(),
	})
	require.NoError(t, err)
	token, err = model.GetTokenById(905)
	require.NoError(t, err)
	err = model.CheckTokenQuotaLimits(token, tenHoursLater.Unix())
	require.Error(t, err)
	assert.True(t, errors.Is(err, model.ErrTokenDailyQuotaExceeded))

	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 905).Update("daily_quota", 200).Error)
	token, err = model.GetTokenById(905)
	require.NoError(t, err)
	nextDay := now.Add(24 * time.Hour)
	require.NoError(t, model.CheckTokenQuotaLimits(token, nextDay.Unix()))
	_, err = model.SettlePostpaidRequest(model.PostpaidSettlementParams{
		RequestId: "periodic-limit-next-day", UserId: 805, TokenId: 905,
		TokenKey: "periodic-limit", Quota: 100, StartedAt: nextDay.Unix(),
	})
	require.NoError(t, err)
	token, err = model.GetTokenById(905)
	require.NoError(t, err)
	err = model.CheckTokenQuotaLimits(token, nextDay.Unix())
	require.Error(t, err)
	assert.True(t, errors.Is(err, model.ErrTokenWeeklyQuotaExceeded))

	require.Error(t, model.ResetTokenQuotaUsage(905, 999))
	require.NoError(t, model.ResetTokenQuotaUsage(905, 805))
	usage, err = model.GetTokenQuotaUsageState(905, nextDay.Unix())
	require.NoError(t, err)
	assert.Equal(t, model.TokenQuotaUsageState{}, usage)
}

func TestPostpaidTokenOverageNeverMakesRemainingQuotaNegative(t *testing.T) {
	truncate(t)
	seedUser(t, 807, 100)
	seedToken(t, 907, 807, "token-overage", 20)
	now := time.Now()
	params := model.PostpaidSettlementParams{
		RequestId: "token-overage", UserId: 807, TokenId: 907,
		TokenKey: "token-overage", Quota: 50, StartedAt: now.Unix(),
	}
	_, err := model.SettlePostpaidRequest(params)
	require.NoError(t, err)
	token, err := model.GetTokenById(907)
	require.NoError(t, err)
	assert.Zero(t, token.RemainQuota)
	assert.Equal(t, 30, token.QuotaOverage)
	assert.Equal(t, 50, token.UsedQuota)

	params.Quota = 10
	_, err = model.SettlePostpaidRequest(params)
	require.NoError(t, err)
	token, err = model.GetTokenById(907)
	require.NoError(t, err)
	assert.Equal(t, 10, token.RemainQuota)
	assert.Zero(t, token.QuotaOverage)
	assert.Equal(t, 10, token.UsedQuota)
}
