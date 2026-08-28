package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
)

func TestAppendBillingInfoIncludesFrozenCouponAcrossFundingSources(t *testing.T) {
	relayInfo := &relaycommon.RelayInfo{
		BillingSource:     BillingSourceHybrid,
		SubscriptionQuota: 60,
		WalletQuota:       40,
		PriceData: hosttypes.PriceData{GroupRatioInfo: hosttypes.GroupRatioInfo{
			GroupRatio:         0.1,
			OriginalGroupRatio: 1.2,
			CouponId:           42,
			CouponName:         "GPT Pro trial",
			CouponRatio:        0.1,
			CouponActiveUntil:  1_800_000_000,
		}},
	}
	other := map[string]interface{}{}

	appendBillingInfo(relayInfo, other)

	assert.Equal(t, BillingSourceHybrid, other["billing_source"])
	assert.Equal(t, 60, other["subscription_consumed"])
	assert.Equal(t, 40, other["wallet_quota_deducted"])
	assert.Equal(t, 42, other["coupon_id"])
	assert.Equal(t, 1.2, other["original_group_ratio"])
	assert.Equal(t, 0.1, other["coupon_ratio"])
}

func TestTaskBillingOtherUsesSubmittedCouponSnapshotAfterExpiry(t *testing.T) {
	task := &model.Task{PrivateData: model.TaskPrivateData{BillingContext: &model.TaskBillingContext{
		GroupRatio:         0.1,
		CouponId:           42,
		CouponName:         "GPT Pro trial",
		CouponRatio:        0.1,
		OriginalGroupRatio: 1.2,
		CouponActiveUntil:  1_800_000_000,
	}}}

	other := taskBillingOther(task)

	assert.Equal(t, 42, other["coupon_id"])
	assert.Equal(t, "GPT Pro trial", other["coupon_name"])
	assert.Equal(t, 0.1, other["group_ratio"])
	assert.Equal(t, int64(1_800_000_000), other["coupon_active_until"])
}
