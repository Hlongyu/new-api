package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupCouponUser(t *testing.T, username string) User {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Coupon{}))
	user := User{Username: username, Password: "password", Status: common.UserStatusEnabled, AffCode: common.GetUUID()}
	require.NoError(t, DB.Create(&user).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Where("user_id = ?", user.Id).Delete(&Coupon{}).Error)
		require.NoError(t, DB.Unscoped().Delete(&User{}, user.Id).Error)
	})
	return user
}

func issueCouponForTest(t *testing.T, user User, now int64, group string, ratioPPM int) Coupon {
	t.Helper()
	coupons, err := IssueCoupons(IssueCouponParams{
		UserIds:               []int{user.Id},
		Name:                  "Pro trial",
		ApplicableGroup:       group,
		RatioPPM:              ratioPPM,
		ValidForSeconds:       7 * 24 * 60 * 60,
		ActiveDurationSeconds: 60 * 60,
		IssuerId:              user.Id,
		IssueBatchId:          common.GetUUID(),
		IdempotencyKey:        common.GetUUID(),
		Now:                   now,
	})
	require.NoError(t, err)
	require.Len(t, coupons, 1)
	return coupons[0]
}

func TestIssueCouponsUsesReceiptBasedActivationPeriodAndIsIdempotent(t *testing.T) {
	user := setupCouponUser(t, "coupon-issue-user")
	now := int64(1_800_000_000)
	params := IssueCouponParams{
		UserIds:               []int{user.Id},
		Name:                  "GPT Pro 0.1x",
		ApplicableGroup:       "gpt-pro",
		RatioPPM:              100_000,
		ValidForSeconds:       7 * 24 * 60 * 60,
		ActiveDurationSeconds: 60 * 60,
		IssuerId:              user.Id,
		IssueBatchId:          common.GetUUID(),
		IdempotencyKey:        "coupon-issue-idempotency",
		Now:                   now,
	}

	first, err := IssueCoupons(params)
	require.NoError(t, err)
	require.Len(t, first, 1)
	assert.Equal(t, now+7*24*60*60, first[0].ActivateBefore)
	assert.Equal(t, int64(60*60), first[0].ActiveDurationSeconds)
	assert.Equal(t, CouponEffectiveStatusAvailable, first[0].EffectiveStatus)

	second, err := IssueCoupons(params)
	require.NoError(t, err)
	require.Len(t, second, 1)
	assert.Equal(t, first[0].Id, second[0].Id)

	var count int64
	require.NoError(t, DB.Model(&Coupon{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestIssueCouponsCanTargetAllUsersInBatches(t *testing.T) {
	issuer := setupCouponUser(t, "coupon-all-issuer")
	setupCouponUser(t, "coupon-all-recipient")
	key := "coupon-all-users-idempotency"
	t.Cleanup(func() {
		require.NoError(t, DB.Where("idempotency_key = ?", key).Delete(&Coupon{}).Error)
	})
	var userCount int64
	require.NoError(t, DB.Model(&User{}).Count(&userCount).Error)
	params := IssueCouponParams{
		AllUsers:              true,
		Name:                  "Everyone trial",
		ApplicableGroup:       "gpt-pro",
		RatioPPM:              100_000,
		ValidForSeconds:       7 * 24 * 60 * 60,
		ActiveDurationSeconds: 60 * 60,
		IssuerId:              issuer.Id,
		IssueBatchId:          common.GetUUID(),
		IdempotencyKey:        key,
		Now:                   1_800_050_000,
	}

	first, err := IssueCoupons(params)
	require.NoError(t, err)
	assert.Len(t, first, int(userCount))
	second, err := IssueCoupons(params)
	require.NoError(t, err)
	assert.Len(t, second, int(userCount))
	assert.Equal(t, first[0].IssueBatchId, second[0].IssueBatchId)

	var couponCount int64
	require.NoError(t, DB.Model(&Coupon{}).Where("idempotency_key = ?", key).Count(&couponCount).Error)
	assert.Equal(t, userCount, couponCount)
}

func TestGetAdminCouponsSearchesRecipientAndPopulatesStatus(t *testing.T) {
	user := setupCouponUser(t, "coupon-admin-list-recipient")
	now := int64(1_800_075_000)
	issued := issueCouponForTest(t, user, now, "gpt-pro", 100_000)

	coupons, total, err := GetAdminCoupons(user.Username, 0, 10, now+1)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, coupons, 1)
	assert.Equal(t, issued.Id, coupons[0].Id)
	assert.Equal(t, user.Username, coupons[0].Username)
	assert.Equal(t, CouponEffectiveStatusAvailable, coupons[0].EffectiveStatus)
}

func TestActivateCouponGrantsFullDurationAndResolvesActiveCoupon(t *testing.T) {
	user := setupCouponUser(t, "coupon-active-user")
	issuedAt := int64(1_800_100_000)
	coupon := issueCouponForTest(t, user, issuedAt, "gpt-pro", 100_000)
	activatedAt := coupon.ActivateBefore - 1

	active, err := ActivateCoupon(coupon.Id, user.Id, activatedAt)
	require.NoError(t, err)
	assert.Equal(t, activatedAt+60*60, active.ActiveUntil)
	assert.Greater(t, active.ActiveUntil, coupon.ActivateBefore)
	assert.Equal(t, CouponEffectiveStatusActive, active.EffectiveStatus)

	resolved, err := GetActiveCoupon(user.Id, "gpt-pro", activatedAt+1)
	require.NoError(t, err)
	require.NotNil(t, resolved)
	assert.Equal(t, coupon.Id, resolved.Id)
	assert.InDelta(t, 0.1, resolved.Ratio(), 0.000001)

	resolved, err = GetActiveCoupon(user.Id, "gpt-pro", active.ActiveUntil)
	require.NoError(t, err)
	assert.Nil(t, resolved)
}

func TestActivateCouponRejectsExpiredAndSameGroupConflict(t *testing.T) {
	user := setupCouponUser(t, "coupon-conflict-user")
	now := int64(1_800_200_000)
	first := issueCouponForTest(t, user, now, "gpt-pro", 100_000)
	second := issueCouponForTest(t, user, now, "gpt-pro", 200_000)
	expired := issueCouponForTest(t, user, now, "other", 300_000)

	_, err := ActivateCoupon(first.Id, user.Id, now+1)
	require.NoError(t, err)
	_, err = ActivateCoupon(second.Id, user.Id, now+2)
	assert.ErrorIs(t, err, ErrCouponActiveConflict)
	_, err = ActivateCoupon(expired.Id, user.Id, expired.ActivateBefore)
	assert.ErrorIs(t, err, ErrCouponExpired)
}

func TestRevokeCouponStopsFutureResolution(t *testing.T) {
	user := setupCouponUser(t, "coupon-revoke-user")
	now := int64(1_800_300_000)
	coupon := issueCouponForTest(t, user, now, "gpt-pro", 100_000)
	_, err := ActivateCoupon(coupon.Id, user.Id, now+1)
	require.NoError(t, err)

	revokerId := user.Id + 1000
	revoked, err := RevokeCoupon(coupon.Id, revokerId, now+2)
	require.NoError(t, err)
	assert.Equal(t, CouponEffectiveStatusRevoked, revoked.EffectiveStatus)
	assert.Equal(t, user.Id, revoked.IssuerId)
	assert.Equal(t, revokerId, revoked.RevokerId)
	second, err := RevokeCoupon(coupon.Id, revokerId+1, now+3)
	require.NoError(t, err)
	assert.Equal(t, revoked.RevokedAt, second.RevokedAt)
	assert.Equal(t, revokerId, second.RevokerId)
	resolved, err := GetActiveCoupon(user.Id, "gpt-pro", now+3)
	require.NoError(t, err)
	assert.Nil(t, resolved)
}

func TestIssueCouponsRejectsOutOfRangeBillingTerms(t *testing.T) {
	user := setupCouponUser(t, "coupon-invalid-terms-user")
	params := IssueCouponParams{
		UserIds:               []int{user.Id},
		Name:                  "Invalid",
		ApplicableGroup:       "gpt-pro",
		RatioPPM:              0,
		ValidForSeconds:       7 * 24 * 60 * 60,
		ActiveDurationSeconds: 60 * 60,
		IssuerId:              user.Id,
		IssueBatchId:          common.GetUUID(),
		IdempotencyKey:        common.GetUUID(),
		Now:                   1_800_400_000,
	}

	_, err := IssueCoupons(params)
	require.Error(t, err)
	params.RatioPPM = 100_000
	params.ActiveDurationSeconds = MaxCouponActiveDurationSeconds + 1
	_, err = IssueCoupons(params)
	require.Error(t, err)
}
