package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

var monthlyRebateReconciliationOnce sync.Once

// Only months explicitly prepared by an administrator are reconciled. This task
// detects late refunds and charges, but never approves or issues a subscription.
func StartMonthlyRebateReconciliationTask() {
	monthlyRebateReconciliationOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(time.Hour)
			defer ticker.Stop()
			reconcilePreparedMonthlyRebates()
			for range ticker.C {
				reconcilePreparedMonthlyRebates()
			}
		})
	})
}

func reconcilePreparedMonthlyRebates() {
	var periods []string
	if err := model.DB.Model(&model.MonthlyRebate{}).Distinct("period").Pluck("period", &periods).Error; err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("monthly rebate reconciliation failed: %v", err))
		return
	}
	for _, period := range periods {
		if _, err := model.RecalculateMonthlyRebates(period, time.Now()); err != nil {
			logger.LogWarn(context.Background(), fmt.Sprintf("monthly rebate reconciliation failed for %s: %v", period, err))
		}
	}
}
