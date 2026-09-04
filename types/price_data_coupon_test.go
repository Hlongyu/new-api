package types

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGroupRatioInfoApplyCouponCapUsesAbsoluteUpperBound(t *testing.T) {
	info := GroupRatioInfo{GroupRatio: 1.2}

	applied := info.ApplyCouponCap(42, "GPT Pro trial", 0.1, 1_800_000_000, "batch-42", 10)

	assert.True(t, applied)
	assert.Equal(t, 1.2, info.OriginalGroupRatio)
	assert.Equal(t, 0.1, info.GroupRatio)
	assert.Equal(t, 42, info.CouponId)
	assert.Equal(t, "GPT Pro trial", info.CouponName)
	assert.Equal(t, "batch-42", info.CouponIssueBatchId)
	assert.Equal(t, 10, info.CouponRPMLimit)
}

func TestGroupRatioInfoApplyCouponCapNeverRaisesExistingRatio(t *testing.T) {
	info := GroupRatioInfo{GroupRatio: 0.05}

	applied := info.ApplyCouponCap(42, "GPT Pro trial", 0.1, 1_800_000_000, "batch-42", 10)

	assert.False(t, applied)
	assert.Equal(t, 0.05, info.GroupRatio)
	assert.Zero(t, info.CouponId)
}
