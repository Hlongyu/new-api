package service

import "math"

// RecapHonor stores the award decision and evidence with the usage snapshot.
type RecapHonor struct {
	RuleVersion     int      `json:"rule_version"`
	Status          string   `json:"status"`
	Code            string   `json:"code,omitempty"`
	Baseline        float64  `json:"baseline"`
	Threshold       float64  `json:"threshold"`
	EffectiveRatio  *float64 `json:"effective_ratio,omitempty"`
	SavingsFraction *float64 `json:"savings_fraction,omitempty"`
	ActiveDays      int      `json:"active_days"`
	LongestStreak   int      `json:"longest_streak"`
	DeepModels      int      `json:"deep_models"`
	DominantModel   string   `json:"dominant_model,omitempty"`
	DominantShare   float64  `json:"dominant_share"`
	NightShare      float64  `json:"night_share"`
	MorningShare    float64  `json:"morning_share"`
	Badges          []string `json:"badges"`
}

func EvaluateMonthlyRecapHonor(recap *MonthlyRecap) *RecapHonor {
	honor := &RecapHonor{RuleVersion: 1, Status: "unavailable", Baseline: 0.25, Threshold: 0.15, Badges: []string{}}
	if recap.InProgress || recap.Requests <= 0 || recap.HistoryIncomplete {
		return honor
	}
	streak, attendance := 0, 0
	for _, day := range recap.Days {
		if day.Requests > 0 {
			attendance++
		}
		if day.Requests >= 3 {
			honor.ActiveDays++
			streak++
			honor.LongestStreak = max(honor.LongestStreak, streak)
		} else {
			streak = 0
		}
	}
	for _, entry := range recap.Models {
		if entry.Requests >= 20 && entry.ActiveDays >= 3 {
			honor.DeepModels++
		}
		share := float64(entry.Requests) / float64(recap.Requests)
		if share > honor.DominantShare {
			honor.DominantShare = share
			honor.DominantModel = entry.Name
		}
	}
	var nightRequests, morningRequests int64
	for hour, count := range recap.Hours {
		if hour < 6 {
			nightRequests += count
		}
		if hour >= 6 && hour < 12 {
			morningRequests += count
		}
	}
	honor.NightShare = float64(nightRequests) / float64(recap.Requests)
	honor.MorningShare = float64(morningRequests) / float64(recap.Requests)

	if recap.UnreadableUsage == 0 && recap.PricedRequests == recap.Requests && recap.Quota >= 0 && recap.OriginalQuota > 0 && !math.IsNaN(recap.OriginalQuota) && !math.IsInf(recap.OriginalQuota, 0) {
		ratio := float64(recap.Quota) / recap.OriginalQuota
		honor.EffectiveRatio = &ratio
		if ratio < honor.Threshold {
			honor.Code = "value_connoisseur"
			savings := 1 - ratio/honor.Baseline
			honor.SavingsFraction = &savings
		}
	}
	honor.Status = "awarded"
	if honor.Code == "" {
		switch {
		case len(recap.Days) > 0 && honor.ActiveDays*5 >= len(recap.Days)*4 && honor.LongestStreak >= 7:
			honor.Code = "evergreen"
		case honor.DeepModels >= 4:
			honor.Code = "explorer"
		case recap.Requests >= 100 && honor.ActiveDays >= 7 && honor.DominantShare >= 0.8:
			honor.Code = "trusted_partner"
		case recap.Requests >= 100 && honor.ActiveDays >= 5 && honor.NightShare >= 0.5:
			honor.Code = "night_owl"
		case recap.Requests >= 100 && honor.ActiveDays >= 5 && honor.MorningShare >= 0.5:
			honor.Code = "morning_companion"
		case recap.Requests >= 100 && honor.ActiveDays >= 5:
			honor.Code = "practitioner"
		default:
			honor.Code = "spark_collector"
		}
	}
	if len(recap.Days) > 0 && attendance == len(recap.Days) && honor.Code != "evergreen" {
		honor.Badges = append(honor.Badges, "full_attendance")
	}
	if honor.LongestStreak >= 14 && honor.Code != "evergreen" {
		honor.Badges = append(honor.Badges, "fortnight")
	}
	if recap.Requests >= 1000 {
		honor.Badges = append(honor.Badges, "thousand_echoes")
	}
	if recap.UnreadableUsage == 0 && recap.InputTokens >= 1000000 && recap.CacheReadTokens <= recap.InputTokens && float64(recap.CacheReadTokens)/float64(recap.InputTokens) >= 0.9 {
		honor.Badges = append(honor.Badges, "context_harmony")
	}
	if honor.DeepModels >= 3 && honor.Code != "explorer" {
		honor.Badges = append(honor.Badges, "versatile")
	}
	if len(honor.Badges) > 2 {
		honor.Badges = honor.Badges[:2]
	}
	return honor
}
