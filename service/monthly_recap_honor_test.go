package service

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMonthlyRecapHonorThresholdAndEvidence(t *testing.T) {
	for _, tc := range []struct {
		name     string
		quota    int64
		original float64
		status   string
	}{
		{"below", 14, 100, "value_connoisseur"},
		{"exactly threshold", 15, 100, "spark_collector"},
		{"above", 16, 100, "spark_collector"},
		{"baseline", 25, 100, "spark_collector"},
		{"rounding below", 149999, 1000000, "value_connoisseur"},
		{"rounding above", 150001, 1000000, "spark_collector"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recap := &MonthlyRecap{RecapMetrics: RecapMetrics{Requests: 1, PricedRequests: 1, Quota: tc.quota, OriginalQuota: tc.original}}
			honor := EvaluateMonthlyRecapHonor(recap)
			assert.Equal(t, tc.status, honor.Code)
			require.NotNil(t, honor.EffectiveRatio)
			assert.Equal(t, float64(tc.quota)/tc.original, *honor.EffectiveRatio)
			if tc.status == "value_connoisseur" {
				assert.Equal(t, "value_connoisseur", honor.Code)
				require.NotNil(t, honor.SavingsFraction)
				assert.InDelta(t, 1-float64(tc.quota)/tc.original/0.25, *honor.SavingsFraction, 1e-12)
			} else {
				assert.Nil(t, honor.SavingsFraction)
			}
		})
	}
}

func TestMonthlyRecapHonorRequiresReliableClosedMonth(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*MonthlyRecap)
	}{
		{"current month", func(r *MonthlyRecap) { r.InProgress = true }},
		{"missing history", func(r *MonthlyRecap) { r.HistoryIncomplete = true }},
		{"unreadable", func(r *MonthlyRecap) { r.UnreadableUsage = 1 }},
		{"unpriced", func(r *MonthlyRecap) { r.PricedRequests = 0 }},
		{"empty", func(r *MonthlyRecap) { r.Requests = 0; r.PricedRequests = 0 }},
		{"zero original", func(r *MonthlyRecap) { r.OriginalQuota = 0 }},
		{"negative charge", func(r *MonthlyRecap) { r.Quota = -1 }},
		{"infinite original", func(r *MonthlyRecap) { r.OriginalQuota = math.Inf(1) }},
		{"invalid original", func(r *MonthlyRecap) { r.OriginalQuota = math.NaN() }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recap := &MonthlyRecap{RecapMetrics: RecapMetrics{Requests: 1, PricedRequests: 1, Quota: 14, OriginalQuota: 100}}
			tc.change(recap)
			honor := EvaluateMonthlyRecapHonor(recap)
			if recap.InProgress || recap.Requests == 0 || recap.HistoryIncomplete {
				assert.Equal(t, "unavailable", honor.Status)
			} else {
				assert.Equal(t, "spark_collector", honor.Code)
			}
			assert.Nil(t, honor.EffectiveRatio)
		})
	}
}

func TestMonthlyRecapMainTitlesAndBadges(t *testing.T) {
	for _, tc := range []struct {
		name                           string
		active, streak, deep, requests int
		share                          float64
		hour                           int
		code                           string
	}{
		{"consistency first", 25, 25, 4, 1000, 1, 2, "evergreen"},
		{"exploration", 5, 5, 4, 1000, 1, 2, "explorer"},
		{"loyalty", 7, 7, 0, 100, 0.8, 2, "trusted_partner"},
		{"night", 5, 5, 0, 100, 0.6, 2, "night_owl"},
		{"morning", 5, 5, 0, 100, 0.6, 8, "morning_companion"},
		{"practice", 5, 5, 0, 100, 0.6, 18, "practitioner"},
		{"first step", 1, 1, 0, 1, 1, 18, "spark_collector"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recap := &MonthlyRecap{RecapMetrics: RecapMetrics{Requests: int64(tc.requests)}, Days: make([]RecapDay, 30)}
			for i := 0; i < tc.active; i++ {
				recap.Days[i].Requests = 3
			}
			recap.Hours[tc.hour] = int64(tc.requests)
			recap.Models = []RecapModel{{Name: "favorite", RecapMetrics: RecapMetrics{Requests: int64(float64(tc.requests) * tc.share)}}}
			for i := 0; i < tc.deep; i++ {
				recap.Models = append(recap.Models, RecapModel{ActiveDays: 3, RecapMetrics: RecapMetrics{Requests: 20}})
			}
			got := EvaluateMonthlyRecapHonor(recap)
			assert.Equal(t, tc.code, got.Code)
			assert.LessOrEqual(t, len(got.Badges), 2)
			if tc.code == "evergreen" {
				assert.NotContains(t, got.Badges, "fortnight")
			}
			if tc.code == "explorer" {
				assert.NotContains(t, got.Badges, "versatile")
			}
		})
	}
	recap := &MonthlyRecap{RecapMetrics: RecapMetrics{Requests: 1000, PricedRequests: 1000, Quota: 14, OriginalQuota: 100, InputTokens: 1000000, CacheReadTokens: 950000}, Days: make([]RecapDay, 30)}
	for i := range recap.Days {
		recap.Days[i].Requests = 3
	}
	got := EvaluateMonthlyRecapHonor(recap)
	assert.Equal(t, "value_connoisseur", got.Code)
	assert.Equal(t, []string{"full_attendance", "fortnight"}, got.Badges)
}
