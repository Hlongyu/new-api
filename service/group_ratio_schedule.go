package service

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

// A one-second poll is independent of traffic and system-task interval jobs.
// Pending rows survive downtime and are applied in chronological order at startup.
func RunGroupRatioScheduleWorker() {
	if !common.IsMasterNode {
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		for i := 0; i < 100; i++ {
			changed, err := model.ApplyNextGroupRatioSchedule(time.Now().Unix())
			if err != nil {
				logger.LogError(context.Background(), "scheduled group ratio update failed: "+err.Error())
				break
			}
			if !changed {
				break
			}
		}
		<-ticker.C
	}
}
