package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	quotaDataTokenMetricsMigration = "quota_data_token_metrics_v1"
	quotaDataTokenTotalsMigration  = "quota_data_token_metrics_v2"
	quotaDataBackfillLogBatchSize  = 1000
)

type QuotaDataTokenMetricsBackfillResult struct {
	AlreadyCompleted bool
	CandidateRows    int
	UpdatedRows      int
	AmbiguousRows    int
	ScannedLogs      int
}

type quotaDataTokenMetricsKey struct {
	UserID    int
	Username  string
	ModelName string
	CreatedAt int64
	UseGroup  string
	TokenID   int
	ChannelID int
}

type quotaDataTokenMetrics struct {
	InputTokens     int
	OutputTokens    int
	CacheReadTokens int
}

type quotaDataBackfillOther struct {
	Claude              bool   `json:"claude"`
	InputTokensTotal    int    `json:"input_tokens_total"`
	CacheTokens         int    `json:"cache_tokens"`
	CacheCreationTokens int    `json:"cache_creation_tokens"`
	CacheCreation5m     int    `json:"cache_creation_tokens_5m"`
	CacheCreation1h     int    `json:"cache_creation_tokens_1h"`
	CacheWriteTokens    int    `json:"cache_write_tokens"`
	UsageSemantic       string `json:"usage_semantic"`
}

func (other quotaDataBackfillOther) cacheCreationTokens() int {
	return max(
		max(other.CacheCreationTokens, other.CacheWriteTokens),
		max(other.CacheCreation5m, 0)+max(other.CacheCreation1h, 0),
	)
}

func BackfillQuotaDataTokenMetrics() (QuotaDataTokenMetricsBackfillResult, error) {
	result := QuotaDataTokenMetricsBackfillResult{}

	var migration DataMigration
	err := DB.Where("name = ?", quotaDataTokenMetricsMigration).First(&migration).Error
	if err == nil {
		result.AlreadyCompleted = true
		return result, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return result, err
	}

	var quotaRows []QuotaData
	err = DB.
		Select("id, user_id, username, model_name, created_at, use_group, token_id, channel_id").
		Where("input_tokens = 0 AND output_tokens = 0 AND cache_read_tokens = 0").
		Find(&quotaRows).Error
	if err != nil {
		return result, err
	}
	result.CandidateRows = len(quotaRows)

	if len(quotaRows) == 0 {
		return result, markQuotaDataTokenMetricsBackfillComplete()
	}

	quotaRowIDs := make(map[quotaDataTokenMetricsKey][]int, len(quotaRows))
	startTime := quotaRows[0].CreatedAt
	endTime := quotaRows[0].CreatedAt + 3599
	for _, row := range quotaRows {
		key := quotaDataTokenMetricsKey{
			UserID:    row.UserID,
			Username:  row.Username,
			ModelName: row.ModelName,
			CreatedAt: row.CreatedAt,
			UseGroup:  row.UseGroup,
			TokenID:   row.TokenID,
			ChannelID: row.ChannelID,
		}
		quotaRowIDs[key] = append(quotaRowIDs[key], row.Id)
		if row.CreatedAt < startTime {
			startTime = row.CreatedAt
		}
		if row.CreatedAt+3599 > endTime {
			endTime = row.CreatedAt + 3599
		}
	}

	metricsByKey := make(map[quotaDataTokenMetricsKey]quotaDataTokenMetrics, len(quotaRows))
	for offset := 0; ; offset += quotaDataBackfillLogBatchSize {
		var logs []Log
		err = LOG_DB.
			Select("id, user_id, username, model_name, created_at, prompt_tokens, completion_tokens, channel_id, token_id, "+logGroupCol+", other").
			Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, startTime, endTime).
			Order("created_at ASC, id ASC").
			Limit(quotaDataBackfillLogBatchSize).
			Offset(offset).
			Find(&logs).Error
		if err != nil {
			return result, err
		}
		result.ScannedLogs += len(logs)

		for _, log := range logs {
			key := quotaDataTokenMetricsKey{
				UserID:    log.UserId,
				Username:  log.Username,
				ModelName: log.ModelName,
				CreatedAt: log.CreatedAt - (log.CreatedAt % 3600),
				UseGroup:  log.Group,
				TokenID:   log.TokenId,
				ChannelID: log.ChannelId,
			}
			if _, ok := quotaRowIDs[key]; !ok {
				continue
			}

			other := quotaDataBackfillOther{}
			if log.Other != "" {
				_ = common.Unmarshal([]byte(log.Other), &other)
			}
			cacheReadTokens := max(other.CacheTokens, 0)
			inputTokens := max(log.PromptTokens, 0)
			if other.InputTokensTotal > 0 {
				inputTokens = other.InputTokensTotal
			} else if other.Claude || other.UsageSemantic == "anthropic" {
				inputTokens += cacheReadTokens + other.cacheCreationTokens()
			}

			metrics := metricsByKey[key]
			metrics.InputTokens += inputTokens
			metrics.OutputTokens += max(log.CompletionTokens, 0)
			metrics.CacheReadTokens += cacheReadTokens
			metricsByKey[key] = metrics
		}

		if len(logs) < quotaDataBackfillLogBatchSize {
			break
		}
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		for key, metrics := range metricsByKey {
			rowIDs := quotaRowIDs[key]
			if len(rowIDs) != 1 {
				result.AmbiguousRows += len(rowIDs)
				continue
			}
			if metrics.InputTokens == 0 && metrics.OutputTokens == 0 && metrics.CacheReadTokens == 0 {
				continue
			}
			update := tx.Model(&QuotaData{}).
				Where("id = ? AND input_tokens = 0 AND output_tokens = 0 AND cache_read_tokens = 0", rowIDs[0]).
				Updates(map[string]interface{}{
					"input_tokens":      metrics.InputTokens,
					"output_tokens":     metrics.OutputTokens,
					"cache_read_tokens": metrics.CacheReadTokens,
				})
			if update.Error != nil {
				return update.Error
			}
			result.UpdatedRows += int(update.RowsAffected)
		}
		return nil
	})
	if err != nil {
		return result, err
	}

	err = markQuotaDataTokenMetricsBackfillComplete()
	return result, err
}

func markQuotaDataTokenMetricsBackfillComplete() error {
	return markDataMigrationComplete(quotaDataTokenMetricsMigration)
}

func BackfillQuotaDataTokenTotals() (QuotaDataTokenMetricsBackfillResult, error) {
	result := QuotaDataTokenMetricsBackfillResult{}

	var migration DataMigration
	err := DB.Where("name = ?", quotaDataTokenTotalsMigration).First(&migration).Error
	if err == nil {
		result.AlreadyCompleted = true
		return result, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return result, err
	}

	var quotaRows []QuotaData
	err = DB.
		Select("id, user_id, username, model_name, created_at, use_group, token_id, channel_id, token_used, input_tokens, output_tokens, cache_read_tokens").
		Find(&quotaRows).Error
	if err != nil {
		return result, err
	}
	result.CandidateRows = len(quotaRows)
	if len(quotaRows) == 0 {
		return result, markDataMigrationComplete(quotaDataTokenTotalsMigration)
	}

	quotaRowsByID := make(map[int]QuotaData, len(quotaRows))
	quotaRowIDs := make(map[quotaDataTokenMetricsKey][]int, len(quotaRows))
	startTime := quotaRows[0].CreatedAt
	endTime := quotaRows[0].CreatedAt + 3599
	for _, row := range quotaRows {
		key := quotaDataTokenMetricsKey{
			UserID: row.UserID, Username: row.Username, ModelName: row.ModelName,
			CreatedAt: row.CreatedAt, UseGroup: row.UseGroup, TokenID: row.TokenID,
			ChannelID: row.ChannelID,
		}
		quotaRowsByID[row.Id] = row
		quotaRowIDs[key] = append(quotaRowIDs[key], row.Id)
		if row.CreatedAt < startTime {
			startTime = row.CreatedAt
		}
		if row.CreatedAt+3599 > endTime {
			endTime = row.CreatedAt + 3599
		}
	}

	metricsByKey := make(map[quotaDataTokenMetricsKey]quotaDataTokenMetrics, len(quotaRows))
	lastLogID := 0
	for {
		var logs []Log
		err = LOG_DB.
			Select("id, user_id, username, model_name, created_at, prompt_tokens, completion_tokens, channel_id, token_id, "+logGroupCol+", other").
			Where("type = ? AND created_at >= ? AND created_at <= ? AND id > ?", LogTypeConsume, startTime, endTime, lastLogID).
			Order("id ASC").
			Limit(quotaDataBackfillLogBatchSize).
			Find(&logs).Error
		if err != nil {
			return result, err
		}
		result.ScannedLogs += len(logs)
		for _, log := range logs {
			lastLogID = log.Id
			key := quotaDataTokenMetricsKey{
				UserID: log.UserId, Username: log.Username, ModelName: log.ModelName,
				CreatedAt: log.CreatedAt - (log.CreatedAt % 3600), UseGroup: log.Group,
				TokenID: log.TokenId, ChannelID: log.ChannelId,
			}
			if _, ok := quotaRowIDs[key]; !ok {
				continue
			}

			other := quotaDataBackfillOther{}
			if log.Other != "" {
				_ = common.Unmarshal([]byte(log.Other), &other)
			}
			cacheReadTokens := max(other.CacheTokens, 0)
			inputTokens := max(log.PromptTokens, 0)
			if other.InputTokensTotal > 0 {
				inputTokens = other.InputTokensTotal
			} else if other.Claude || other.UsageSemantic == "anthropic" {
				inputTokens += cacheReadTokens + other.cacheCreationTokens()
			}

			metrics := metricsByKey[key]
			metrics.InputTokens += inputTokens
			metrics.OutputTokens += max(log.CompletionTokens, 0)
			metrics.CacheReadTokens += cacheReadTokens
			metricsByKey[key] = metrics
		}
		if len(logs) < quotaDataBackfillLogBatchSize {
			break
		}
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		updatedRowIDs := make(map[int]struct{}, len(metricsByKey))
		for key, metrics := range metricsByKey {
			rowIDs := quotaRowIDs[key]
			if len(rowIDs) != 1 {
				result.AmbiguousRows += len(rowIDs)
				continue
			}
			if metrics.InputTokens == 0 && metrics.OutputTokens == 0 && metrics.CacheReadTokens == 0 {
				continue
			}
			rowID := rowIDs[0]
			update := tx.Model(&QuotaData{}).Where("id = ?", rowID).Updates(map[string]interface{}{
				"input_tokens": metrics.InputTokens, "output_tokens": metrics.OutputTokens,
				"cache_read_tokens": metrics.CacheReadTokens,
				"token_used":        metrics.InputTokens + metrics.OutputTokens,
			})
			if update.Error != nil {
				return update.Error
			}
			result.UpdatedRows += int(update.RowsAffected)
			updatedRowIDs[rowID] = struct{}{}
		}

		for rowID, row := range quotaRowsByID {
			if _, ok := updatedRowIDs[rowID]; ok {
				continue
			}
			if row.InputTokens == 0 && row.OutputTokens == 0 && row.CacheReadTokens == 0 {
				continue
			}
			update := tx.Model(&QuotaData{}).Where("id = ?", rowID).
				Update("token_used", row.InputTokens+row.OutputTokens)
			if update.Error != nil {
				return update.Error
			}
			result.UpdatedRows += int(update.RowsAffected)
		}
		return nil
	})
	if err != nil {
		return result, err
	}

	return result, markDataMigrationComplete(quotaDataTokenTotalsMigration)
}

func markDataMigrationComplete(name string) error {
	migration := DataMigration{
		Name:        name,
		CompletedAt: time.Now().Unix(),
	}
	return DB.FirstOrCreate(&migration, DataMigration{Name: name}).Error
}
