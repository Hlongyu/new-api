package service

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestQuotaLoanAvailableCreditAccountsForPartialRepayment(t *testing.T) {
	assert.Equal(t, 0, quotaLoanAvailableCredit(10, 4_750_000, 500_000))
	assert.Equal(t, 1, quotaLoanAvailableCredit(10, 4_500_000, 500_000))
	assert.Equal(t, 10, quotaLoanAvailableCredit(10, 0, 500_000))
}

func TestQuotaLoanPayloadPreservesFractionalOutstandingAmount(t *testing.T) {
	payload := quotaLoanPayload(model.QuotaLoan{OutstandingQuota: 750_000}, 500_000)
	assert.InDelta(t, 1.5, payload.OutstandingAmount, 0.000001)
}

func TestGetQuotaLoanContextIncludesCompleteTransactionHistory(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:quota-loan-open-history?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(
		&model.QuotaData{}, &model.SponsorOrder{}, &model.RenameCardOrder{},
		&model.QuotaLoan{}, &model.QuotaLoanEvent{},
	))
	previousDB := model.DB
	previousQuotaPerUnit := common.QuotaPerUnit
	model.DB = database
	common.QuotaPerUnit = 500_000
	invalidateRankReplayCache()
	t.Cleanup(func() {
		model.DB = previousDB
		common.QuotaPerUnit = previousQuotaPerUnit
		invalidateRankReplayCache()
	})

	loans := make([]model.QuotaLoan, 22)
	for index := range loans {
		status := model.QuotaLoanSettled
		outstandingQuota := 0
		completedAt := int64(index + 100)
		if index == 0 {
			status = model.QuotaLoanActive
			outstandingQuota = 500_000
			completedAt = 0
		}
		loans[index] = model.QuotaLoan{
			Id: fmt.Sprintf("loan-%02d", index), RequestKey: fmt.Sprintf("request-%02d", index),
			UserId: 42, EntryId: 1, TierKey: "iron", TierName: "黑铁 IV",
			CreditAmount: 1, QuotaAmount: 500_000, OutstandingQuota: outstandingQuota,
			Status: status, CreatedAt: int64(index + 1), UpdatedAt: int64(index + 1),
			DueAt: 4_102_444_800, CompletedAt: completedAt,
		}
	}
	require.NoError(t, database.Create(&loans).Error)

	context, err := GetQuotaLoanContext(42, false)
	require.NoError(t, err)
	assert.Equal(t, 1.0, context.OutstandingAmount)
	require.Len(t, context.OpenGrants, 1)
	assert.Equal(t, "loan-00", context.OpenGrants[0].Id)
	assert.Contains(t, context.Grants, context.OpenGrants[0])
	assert.Len(t, context.Grants, 22)
}
