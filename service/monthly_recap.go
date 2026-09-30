package service

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

type RecapMetrics struct {
	Requests         int64   `json:"requests"`
	InputTokens      int64   `json:"input_tokens"`
	OutputTokens     int64   `json:"output_tokens"`
	CacheReadTokens  int64   `json:"cache_read_tokens"`
	CacheWriteTokens int64   `json:"cache_write_tokens"`
	Quota            int64   `json:"quota"`
	OriginalQuota    float64 `json:"original_quota"`
	PricedRequests   int64   `json:"priced_requests"`
}

type RecapModel struct {
	Name string `json:"name"`
	RecapMetrics
}

type RecapDay struct {
	Date     string `json:"date"`
	Requests int64  `json:"requests"`
	Tokens   int64  `json:"tokens"`
	Quota    int64  `json:"quota"`
}

type MonthlyRecap struct {
	Subject     *model.MonthlyRecapUser `json:"subject,omitempty"`
	Period      string                  `json:"period"`
	AsOf        int64                   `json:"as_of"`
	InProgress  bool                    `json:"in_progress"`
	Groups      []string                `json:"groups"`
	QuotaPerUSD float64                 `json:"quota_per_usd"`
	RecapMetrics
	Models            []RecapModel `json:"models"`
	Days              []RecapDay   `json:"days"`
	Hours             [24]int64    `json:"hours"`
	Weekdays          [7]int64     `json:"weekdays"`
	ActiveDays        int          `json:"active_days"`
	LongestStreak     int          `json:"longest_streak"`
	Errors            int64        `json:"errors"`
	HistoryIncomplete bool         `json:"history_incomplete"`
	UnreadableUsage   int64        `json:"unreadable_usage"`
}

// OriginalQuota is a historical estimate before the group discount, preserving
// request multipliers and tool charges. Unknown/zero discounts are not treated
// as free original pricing. Only aggregate metrics are returned to the caller.
func GetMonthlyRecap(ctx context.Context, userID int, groups []string, start, end, now time.Time) (*MonthlyRecap, error) {
	result := &MonthlyRecap{Period: start.Format("2006-01"), AsOf: now.Unix(), InProgress: now.Before(end), Groups: groups, QuotaPerUSD: common.QuotaPerUnit, Models: []RecapModel{}, Days: []RecapDay{}}
	for day := start; day.Before(end); day = day.AddDate(0, 0, 1) {
		result.Days = append(result.Days, RecapDay{Date: day.Format("2006-01-02")})
	}
	models := make(map[string]*RecapModel)
	// Compare only closed hourly buckets: the current bucket can be flushed
	// after the log read and must not look like missing historical records.
	historyEnd := min(end.Unix(), now.Truncate(time.Hour).Unix())
	var retainedHistorical int64
	err := model.VisitMonthlyRecapLogs(ctx, userID, groups, start.Unix(), min(end.Unix(), now.Unix()+1), func(log model.Log) error {
		if log.Type == model.LogTypeError {
			result.Errors++
			return nil
		}
		if log.CreatedAt < historyEnd {
			retainedHistorical++
		}
		var other struct {
			InputTotal    int64    `json:"input_tokens_total"`
			CacheRead     int64    `json:"cache_tokens"`
			CacheWrite    int64    `json:"cache_write_tokens"`
			CacheCreation int64    `json:"cache_creation_tokens"`
			Cache5m       int64    `json:"cache_creation_tokens_5m"`
			Cache1h       int64    `json:"cache_creation_tokens_1h"`
			Claude        bool     `json:"claude"`
			Semantic      string   `json:"usage_semantic"`
			GroupRatio    *float64 `json:"group_ratio"`
		}
		parsed := log.Other != "" && common.UnmarshalJsonStr(log.Other, &other) == nil
		if !parsed {
			result.UnreadableUsage++
		}
		input, output := int64(max(log.PromptTokens, 0)), int64(max(log.CompletionTokens, 0))
		read := max(other.CacheRead, 0)
		write := max(max(other.CacheWrite, other.CacheCreation), max(other.Cache5m, 0)+max(other.Cache1h, 0))
		if other.InputTotal > 0 {
			input = other.InputTotal
		} else if other.Claude || other.Semantic == "anthropic" {
			input += read + write
		}
		entry := models[log.ModelName]
		if entry == nil {
			entry = &RecapModel{Name: log.ModelName}
			models[log.ModelName] = entry
		}
		for _, metrics := range []*RecapMetrics{&result.RecapMetrics, &entry.RecapMetrics} {
			metrics.Requests++
			metrics.InputTokens += input
			metrics.OutputTokens += output
			metrics.CacheReadTokens += read
			metrics.CacheWriteTokens += write
			metrics.Quota += int64(log.Quota)
			if parsed && other.GroupRatio != nil && *other.GroupRatio > 0 && log.Quota >= 0 {
				original := float64(log.Quota) / *other.GroupRatio
				if !math.IsNaN(original) && !math.IsInf(original+metrics.OriginalQuota, 0) {
					metrics.OriginalQuota += original
					metrics.PricedRequests++
				}
			}
		}
		at := time.Unix(log.CreatedAt, 0).In(start.Location())
		day := &result.Days[at.Day()-1]
		day.Requests++
		day.Tokens += input + output
		day.Quota += int64(log.Quota)
		result.Hours[at.Hour()]++
		result.Weekdays[int(at.Weekday())]++
		return nil
	})
	if err != nil {
		return nil, err
	}
	streak := 0
	for _, day := range result.Days {
		if day.Requests == 0 {
			streak = 0
			continue
		}
		result.ActiveDays++
		streak++
		result.LongestStreak = max(result.LongestStreak, streak)
	}
	for _, entry := range models {
		result.Models = append(result.Models, *entry)
	}
	sort.Slice(result.Models, func(i, j int) bool {
		if result.Models[i].Requests == result.Models[j].Requests {
			return result.Models[i].Name < result.Models[j].Name
		}
		return result.Models[i].Requests > result.Models[j].Requests
	})
	recorded, err := model.MonthlyRecapRecordedRequests(ctx, userID, groups, start.Unix(), historyEnd)
	if err != nil {
		return nil, err
	}
	result.HistoryIncomplete = recorded > retainedHistorical
	return result, nil
}
