package service

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

// BillingSession tracks a request's postpaid target. No wallet, subscription,
// or token quota is reserved before the upstream request runs.
type BillingSession struct {
	relayInfo *relaycommon.RelayInfo
	mu        sync.Mutex
}

func billingStartedAt(relayInfo *relaycommon.RelayInfo) int64 {
	if relayInfo.RateLimitAt > 0 {
		return relayInfo.RateLimitAt
	}
	return relayInfo.StartTime.Unix()
}

// Settle reconciles the request to actualQuota. The model layer makes the
// target idempotent by request ID, so repeated and cumulative settlements are
// safe. Subscriptions are consumed first and the uncovered amount is charged
// to the wallet, which may become negative.
func (s *BillingSession) Settle(actualQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if actualQuota < 0 {
		return fmt.Errorf("actual quota cannot be negative: %d", actualQuota)
	}

	requestId := s.relayInfo.RequestId
	if requestId == "" {
		requestId = common.NewRequestId()
		s.relayInfo.RequestId = requestId
	}
	tokenId := s.relayInfo.TokenId
	if s.relayInfo.IsPlayground {
		tokenId = 0
	}
	result, err := model.SettlePostpaidRequest(model.PostpaidSettlementParams{
		RequestId: requestId,
		UserId:    s.relayInfo.UserId,
		TokenId:   tokenId,
		TokenKey:  s.relayInfo.TokenKey,
		Quota:     actualQuota,
		StartedAt: billingStartedAt(s.relayInfo),
	})
	if err != nil {
		return err
	}

	s.relayInfo.FinalPreConsumedQuota = 0
	s.relayInfo.SubscriptionPreConsumed = 0
	s.relayInfo.SubscriptionPostDelta = int64(result.SubscriptionQuota)
	s.relayInfo.SubscriptionQuota = result.SubscriptionQuota
	s.relayInfo.WalletQuota = result.WalletQuota
	s.relayInfo.SubscriptionId = 0
	s.relayInfo.SubscriptionAmountTotal = 0
	s.relayInfo.SubscriptionAmountUsedAfterPreConsume = 0
	switch {
	case result.SubscriptionQuota > 0 && result.WalletQuota > 0:
		s.relayInfo.BillingSource = BillingSourceHybrid
	case result.SubscriptionQuota > 0:
		s.relayInfo.BillingSource = BillingSourceSubscription
	default:
		s.relayInfo.BillingSource = BillingSourceWallet
	}
	return nil
}

func (s *BillingSession) Refund(_ *gin.Context) {}

func (s *BillingSession) NeedsRefund() bool { return false }

func (s *BillingSession) GetPreConsumedQuota() int { return 0 }

// Reserve intentionally does nothing. Estimates may still change when an
// auto-group retry selects a different group, but only actual usage is billed.
func (s *BillingSession) Reserve(targetQuota int) error {
	if targetQuota < 0 {
		return fmt.Errorf("target quota cannot be negative: %d", targetQuota)
	}
	return nil
}

// NewBillingSession performs admission only. Paid requests are allowed while
// the wallet is positive; no funding source or token quota is modified here.
func NewBillingSession(_ *gin.Context, relayInfo *relaycommon.RelayInfo, _ int) (*BillingSession, *types.NewAPIError) {
	if relayInfo == nil {
		return nil, types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	if userQuota <= 0 {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("用户额度不足, 剩余额度: %s", logger.FormatQuota(userQuota)),
			types.ErrorCodeInsufficientUserQuota,
			http.StatusForbidden,
			types.ErrOptionWithSkipRetry(),
			types.ErrOptionWithNoRecordErrorLog(),
		)
	}
	relayInfo.UserQuota = userQuota
	relayInfo.FinalPreConsumedQuota = 0
	return &BillingSession{relayInfo: relayInfo}, nil
}
