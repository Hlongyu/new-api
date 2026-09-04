package rank

import (
	"sort"
	"time"
)

const dayLayout = "2006-01-02"

type Tier struct {
	Key                   string
	Name                  string
	SegmentScore          int64
	PromotionWindowDays   int
	PromotionRequiredDays int
	ActiveScoreRequired   int64
}

var Tiers = []Tier{
	{Key: "iron", Name: "黑铁", SegmentScore: 20, PromotionWindowDays: 3, PromotionRequiredDays: 1, ActiveScoreRequired: 5},
	{Key: "bronze", Name: "青铜", SegmentScore: 30, PromotionWindowDays: 3, PromotionRequiredDays: 1, ActiveScoreRequired: 8},
	{Key: "silver", Name: "白银", SegmentScore: 45, PromotionWindowDays: 5, PromotionRequiredDays: 2, ActiveScoreRequired: 8},
	{Key: "gold", Name: "黄金", SegmentScore: 65, PromotionWindowDays: 5, PromotionRequiredDays: 2, ActiveScoreRequired: 10},
	{Key: "platinum", Name: "铂金", SegmentScore: 90, PromotionWindowDays: 7, PromotionRequiredDays: 3, ActiveScoreRequired: 10},
	{Key: "diamond", Name: "钻石", SegmentScore: 120, PromotionWindowDays: 7, PromotionRequiredDays: 3, ActiveScoreRequired: 15},
	{Key: "master", Name: "大师", SegmentScore: 160, PromotionWindowDays: 10, PromotionRequiredDays: 4, ActiveScoreRequired: 15},
	{Key: "grandmaster", Name: "宗师", SegmentScore: 220, PromotionWindowDays: 10, PromotionRequiredDays: 5, ActiveScoreRequired: 20},
	{Key: "challenger", Name: "王者", SegmentScore: 300},
}

var Divisions = []string{"IV", "III", "II", "I"}

func ParseTierKey(value string) (int, bool) {
	for index, tier := range Tiers {
		if tier.Key == value {
			return index, true
		}
	}
	return 0, false
}

type DailyScore struct {
	Day          string
	TokenScore   int64
	RenameScore  int64
	SponsorScore int64
}

type Promotion struct {
	TargetTierKey          string `json:"targetTierKey"`
	TargetTierName         string `json:"targetTierName"`
	WindowDays             int    `json:"windowDays"`
	RequiredDays           int    `json:"requiredDays"`
	ActiveScoreRequired    int64  `json:"activeScoreRequired"`
	CheckedDays            int    `json:"checkedDays"`
	ActiveDays             int    `json:"activeDays"`
	TodayScore             int64  `json:"todayScore"`
	TodayRequiredRemaining int64  `json:"todayRequiredRemaining"`
	TodayCounts            bool   `json:"todayCounts"`
	targetTierIndex        int
}

type Progress struct {
	TierKey       string     `json:"tierKey"`
	TierName      string     `json:"tierName"`
	TierIndex     int        `json:"tierIndex"`
	Division      string     `json:"division"`
	DivisionIndex int        `json:"divisionIndex"`
	Label         string     `json:"label"`
	Score         int64      `json:"score"`
	SegmentScore  int64      `json:"segmentScore"`
	PendingScore  int64      `json:"pendingScore"`
	TokenScore    int64      `json:"tokenScore"`
	RenameScore   int64      `json:"renameScore"`
	SponsorScore  int64      `json:"sponsorScore"`
	TotalScore    int64      `json:"totalScore"`
	RankValue     int64      `json:"rankValue"`
	Promotion     *Promotion `json:"promotion"`
}

type state struct {
	tierIndex     int
	divisionIndex int
	score         int64
	pendingScore  int64
	promotion     *Promotion
}

func Calculate(scores []DailyScore, today string) Progress {
	state := state{}
	byDay := make(map[string]DailyScore, len(scores))
	days := make([]string, 0, len(scores))
	var tokenScore int64
	var renameScore int64
	var sponsorScore int64

	for _, score := range scores {
		if score.Day == "" || score.Day > today {
			continue
		}
		current, exists := byDay[score.Day]
		if !exists {
			days = append(days, score.Day)
		}
		current.Day = score.Day
		current.TokenScore += max(score.TokenScore, 0)
		current.RenameScore += max(score.RenameScore, 0)
		current.SponsorScore += max(score.SponsorScore, 0)
		byDay[score.Day] = current
		tokenScore += max(score.TokenScore, 0)
		renameScore += max(score.RenameScore, 0)
		sponsorScore += max(score.SponsorScore, 0)
	}

	if len(days) > 0 {
		sort.Strings(days)
		cursor, cursorErr := time.Parse(dayLayout, days[0])
		end, endErr := time.Parse(dayLayout, today)
		if cursorErr == nil && endErr == nil {
			for !cursor.After(end) {
				day := cursor.Format(dayLayout)
				daily := byDay[day]
				gained := daily.TokenScore + daily.RenameScore + daily.SponsorScore
				if day == today && state.promotion != nil {
					state.promotion.TodayScore = max(gained, 0)
					state.promotion.TodayRequiredRemaining = max(state.promotion.ActiveScoreRequired-state.promotion.TodayScore, 0)
					state.promotion.TodayCounts = true
				}
				applyDailyScore(&state, gained, day != today)
				cursor = cursor.AddDate(0, 0, 1)
			}
		}
	}

	tier := Tiers[state.tierIndex]
	return Progress{
		TierKey:       tier.Key,
		TierName:      tier.Name,
		TierIndex:     state.tierIndex,
		Division:      Divisions[state.divisionIndex],
		DivisionIndex: state.divisionIndex,
		Label:         tier.Name + " " + Divisions[state.divisionIndex],
		Score:         state.score,
		SegmentScore:  tier.SegmentScore,
		PendingScore:  state.pendingScore,
		TokenScore:    tokenScore,
		RenameScore:   renameScore,
		SponsorScore:  sponsorScore,
		TotalScore:    tokenScore + renameScore + sponsorScore,
		RankValue:     int64(state.tierIndex)*10_000 + int64(state.divisionIndex)*1_000 + state.score,
		Promotion:     state.promotion,
	}
}

func applyScoreOutsidePromotion(value *state, score int64) {
	remaining := max(score, 0)
	for remaining > 0 {
		tier := Tiers[value.tierIndex]
		need := tier.SegmentScore - value.score
		if remaining < need {
			value.score += remaining
			return
		}
		remaining -= need
		if value.divisionIndex < len(Divisions)-1 {
			value.divisionIndex++
			value.score = 0
			continue
		}
		startPromotion(value, remaining)
		return
	}
}

func startPromotion(value *state, overflow int64) {
	tier := Tiers[value.tierIndex]
	if value.tierIndex+1 >= len(Tiers) {
		value.score = min(tier.SegmentScore, value.score+overflow)
		return
	}
	value.divisionIndex = len(Divisions) - 1
	value.score = tier.SegmentScore
	value.pendingScore += max(overflow, 0)
	target := Tiers[value.tierIndex+1]
	value.promotion = &Promotion{
		TargetTierKey:          target.Key,
		TargetTierName:         target.Name,
		WindowDays:             tier.PromotionWindowDays,
		RequiredDays:           tier.PromotionRequiredDays,
		ActiveScoreRequired:    tier.ActiveScoreRequired,
		TodayRequiredRemaining: tier.ActiveScoreRequired,
		targetTierIndex:        value.tierIndex + 1,
	}
}

func applyDailyScore(value *state, score int64, allowFailure bool) {
	gained := max(score, 0)
	if value.promotion == nil {
		applyScoreOutsidePromotion(value, gained)
		return
	}
	value.pendingScore += gained
	value.promotion.CheckedDays++
	if gained >= value.promotion.ActiveScoreRequired {
		value.promotion.ActiveDays++
	}
	if value.promotion.ActiveDays >= value.promotion.RequiredDays {
		promotionSuccess(value)
		return
	}
	if allowFailure && value.promotion.CheckedDays >= value.promotion.WindowDays {
		promotionFailure(value)
	}
}

func promotionSuccess(value *state) {
	pending := value.pendingScore
	value.tierIndex = value.promotion.targetTierIndex
	value.divisionIndex = 0
	value.score = 0
	value.pendingScore = 0
	value.promotion = nil
	applyScoreOutsidePromotion(value, pending)
}

func promotionFailure(value *state) {
	value.score = Tiers[value.tierIndex].SegmentScore / 2
	value.pendingScore = 0
	value.promotion = nil
}
