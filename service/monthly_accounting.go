package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
)

var monthlyAccountingOnce sync.Once

// Poll at wall-clock minute boundaries, including 00:00 on the first. The
// period primary key makes restart/retry and multiple schedulers idempotent.
func StartMonthlyAccountingTask() {
	monthlyAccountingOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			for {
				now := time.Now()
				rate := operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate)
				if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
					logger.LogWarn(context.Background(), "monthly accounting requires a currency balance display")
				} else if err := model.CaptureMonthlyAccountingSnapshot(now, common.QuotaPerUnit/rate); err != nil {
					logger.LogWarn(context.Background(), fmt.Sprintf("monthly accounting snapshot failed: %v", err))
				}
				// Align to the next minute instead of inheriting process startup seconds.
				next := time.Now().Truncate(time.Minute).Add(time.Minute)
				timer := time.NewTimer(time.Until(next))
				<-timer.C
			}
		})
	})
}
