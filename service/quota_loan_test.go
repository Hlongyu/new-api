package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
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
