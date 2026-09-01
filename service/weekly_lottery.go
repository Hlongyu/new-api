package service

import (
	"crypto/rand"
	"errors"
	"math/big"
	"sort"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const weeklyLotteryRuleVersion = 2

type LotteryPrize struct {
	AmountUsd float64 `json:"amountUsd"`
	Weight    int     `json:"weight"`
}

type LotteryDrawPayload struct {
	Id           string  `json:"id,omitempty"`
	RuleVersion  int     `json:"ruleVersion,omitempty"`
	PeriodKey    string  `json:"periodKey,omitempty"`
	Rank         int     `json:"rank,omitempty"`
	AmountUsd    float64 `json:"amountUsd"`
	QuotaAmount  int     `json:"quotaAmount,omitempty"`
	Status       string  `json:"status"`
	DisplayName  string  `json:"displayName,omitempty"`
	CreatedAt    int64   `json:"createdAt,omitempty"`
	UpdatedAt    int64   `json:"updatedAt,omitempty"`
	CompletedAt  int64   `json:"completedAt"`
	ErrorMessage string  `json:"errorMessage,omitempty"`
	UserId       int     `json:"userId,omitempty"`
	UserName     string  `json:"userName,omitempty"`
}

type LotteryOpportunityPayload struct {
	PeriodKey    string              `json:"periodKey"`
	WeekStart    int64               `json:"weekStart"`
	WeekEnd      int64               `json:"weekEnd"`
	Rank         int                 `json:"rank"`
	DisplayName  string              `json:"displayName"`
	TokenUsed    int64               `json:"tokenUsed,omitempty"`
	Quota        int64               `json:"quota,omitempty"`
	AmountUsd    float64             `json:"amountUsd,omitempty"`
	RequestCount int64               `json:"requestCount,omitempty"`
	IsMe         bool                `json:"isMe"`
	Draw         *LotteryDrawPayload `json:"draw"`
}

type LotteryWeeklyHistory struct {
	PeriodKey string                      `json:"periodKey"`
	WeekStart int64                       `json:"weekStart"`
	WeekEnd   int64                       `json:"weekEnd"`
	Winners   []LotteryOpportunityPayload `json:"winners"`
}

type LotteryPayload struct {
	Enabled              bool                        `json:"enabled"`
	Configured           bool                        `json:"configured"`
	IsRoot               bool                        `json:"isRoot"`
	RuleVersion          int                         `json:"ruleVersion"`
	PeriodKey            string                      `json:"periodKey"`
	WeekStart            int64                       `json:"weekStart"`
	WeekEnd              int64                       `json:"weekEnd"`
	TimeZone             string                      `json:"timeZone"`
	PrizesByRank         [][]LotteryPrize            `json:"prizesByRank"`
	Winners              []LotteryOpportunityPayload `json:"winners"`
	Opportunities        []LotteryOpportunityPayload `json:"opportunities"`
	PendingOpportunities int                         `json:"pendingOpportunities"`
	Me                   *struct {
		PeriodKey string              `json:"periodKey"`
		Rank      int                 `json:"rank"`
		Prizes    []LotteryPrize      `json:"prizes"`
		CanDraw   bool                `json:"canDraw"`
		Draw      *LotteryDrawPayload `json:"draw"`
	} `json:"me"`
	NextDraw *struct {
		PeriodKey string              `json:"periodKey"`
		WeekStart int64               `json:"weekStart"`
		WeekEnd   int64               `json:"weekEnd"`
		Rank      int                 `json:"rank"`
		Prizes    []LotteryPrize      `json:"prizes"`
		Draw      *LotteryDrawPayload `json:"draw"`
	} `json:"nextDraw"`
	CanDraw       bool                   `json:"canDraw"`
	WeeklyHistory []LotteryWeeklyHistory `json:"weeklyHistory"`
	AdminIssues   []LotteryDrawPayload   `json:"adminIssues,omitempty"`
}

type lotteryOpportunity struct {
	model.LotteryOpportunity
	pool []LotteryPrize
	draw *model.LotteryDraw
}

func GetWeeklyLottery(userId int, isRoot bool) (*LotteryPayload, error) {
	pools, err := configuredLotteryPrizePools()
	if err != nil {
		return nil, err
	}
	weekStart, weekEnd, weekKey, err := previousLeaderboardWeek(time.Now())
	if err != nil {
		return nil, err
	}
	if len(pools) > 0 {
		if err := settleWeeklyLottery(weekStart, weekEnd, weekKey, pools); err != nil {
			return nil, err
		}
	}
	opportunities, err := loadLotteryOpportunities(pools, weekKey)
	if err != nil {
		return nil, err
	}
	payload := &LotteryPayload{
		Enabled: common.LeaderboardLotteryEnabled, Configured: len(pools) > 0,
		IsRoot: isRoot, RuleVersion: weeklyLotteryRuleVersion,
		PeriodKey: weekKey, WeekStart: weekStart, WeekEnd: weekEnd,
		TimeZone: leaderboardTimeZone, PrizesByRank: pools,
		Winners: make([]LotteryOpportunityPayload, 0), Opportunities: make([]LotteryOpportunityPayload, 0),
		WeeklyHistory: make([]LotteryWeeklyHistory, 0),
	}
	historyByKey := make(map[string]*LotteryWeeklyHistory)
	var next *lotteryOpportunity
	for index := range opportunities {
		opportunity := &opportunities[index]
		public := lotteryOpportunityPayload(*opportunity, userId, isRoot)
		if opportunity.PeriodKey == weekKey {
			payload.Winners = append(payload.Winners, public)
		}
		if opportunity.UserId == userId {
			payload.Opportunities = append(payload.Opportunities, public)
			if opportunity.draw == nil || opportunity.draw.Status == model.LeaderboardOrderFailed {
				payload.PendingOpportunities++
				if next == nil {
					next = opportunity
				}
			}
			if opportunity.PeriodKey == weekKey {
				payload.Me = &struct {
					PeriodKey string              `json:"periodKey"`
					Rank      int                 `json:"rank"`
					Prizes    []LotteryPrize      `json:"prizes"`
					CanDraw   bool                `json:"canDraw"`
					Draw      *LotteryDrawPayload `json:"draw"`
				}{PeriodKey: weekKey, Rank: opportunity.DrawRank, Prizes: opportunity.pool,
					CanDraw: common.LeaderboardLotteryEnabled && len(pools) > 0 && (opportunity.draw == nil || opportunity.draw.Status == model.LeaderboardOrderFailed),
					Draw:    public.Draw}
			}
		}
		history := historyByKey[opportunity.PeriodKey]
		if history == nil {
			start, end, rangeErr := leaderboardWeekFromKey(opportunity.PeriodKey)
			if rangeErr != nil {
				return nil, rangeErr
			}
			history = &LotteryWeeklyHistory{PeriodKey: opportunity.PeriodKey, WeekStart: start, WeekEnd: end, Winners: make([]LotteryOpportunityPayload, 0)}
			historyByKey[opportunity.PeriodKey] = history
		}
		history.Winners = append(history.Winners, public)
	}
	if next != nil {
		start, end, rangeErr := leaderboardWeekFromKey(next.PeriodKey)
		if rangeErr != nil {
			return nil, rangeErr
		}
		nextPayload := lotteryOpportunityPayload(*next, userId, isRoot)
		payload.NextDraw = &struct {
			PeriodKey string              `json:"periodKey"`
			WeekStart int64               `json:"weekStart"`
			WeekEnd   int64               `json:"weekEnd"`
			Rank      int                 `json:"rank"`
			Prizes    []LotteryPrize      `json:"prizes"`
			Draw      *LotteryDrawPayload `json:"draw"`
		}{PeriodKey: next.PeriodKey, WeekStart: start, WeekEnd: end, Rank: next.DrawRank, Prizes: next.pool, Draw: nextPayload.Draw}
	}
	payload.CanDraw = common.LeaderboardLotteryEnabled && len(pools) > 0 && next != nil
	for _, history := range historyByKey {
		payload.WeeklyHistory = append(payload.WeeklyHistory, *history)
	}
	sort.Slice(payload.WeeklyHistory, func(left int, right int) bool {
		return payload.WeeklyHistory[left].WeekStart > payload.WeeklyHistory[right].WeekStart
	})
	if isRoot {
		for _, opportunity := range opportunities {
			if opportunity.draw == nil || opportunity.draw.Status != model.LeaderboardOrderUnknown {
				continue
			}
			entry, _ := model.GetLeaderboardEntryByUserId(opportunity.UserId)
			draw := lotteryDrawPayload(*opportunity.draw, true)
			draw.UserId = opportunity.UserId
			if entry != nil {
				draw.UserName = leaderboardDisplayName(*entry)
			}
			payload.AdminIssues = append(payload.AdminIssues, draw)
		}
	}
	return payload, nil
}

func DrawWeeklyLottery(userId int) (*LotteryDrawPayload, error) {
	pools, err := configuredLotteryPrizePools()
	if err != nil {
		return nil, err
	}
	if !common.LeaderboardLotteryEnabled || len(pools) == 0 {
		return nil, errors.New("抽奖活动未配置")
	}
	weekStart, weekEnd, weekKey, err := previousLeaderboardWeek(time.Now())
	if err != nil {
		return nil, err
	}
	if err := settleWeeklyLottery(weekStart, weekEnd, weekKey, pools); err != nil {
		return nil, err
	}
	opportunities, err := loadLotteryOpportunities(pools, weekKey)
	if err != nil {
		return nil, err
	}
	for _, opportunity := range opportunities {
		if opportunity.UserId != userId || (opportunity.draw != nil && opportunity.draw.Status != model.LeaderboardOrderFailed) {
			continue
		}
		prize, err := pickLotteryPrize(opportunity.pool)
		if err != nil {
			return nil, err
		}
		quotaAmount, err := common.QuotaRoundStrict(prize.AmountUsd * common.QuotaPerUnit)
		if err != nil {
			return nil, err
		}
		draw, err := model.DrawLotteryPrize(opportunity.LotteryOpportunity, prize.AmountUsd, quotaAmount, common.GetTimestamp())
		if err != nil {
			return nil, err
		}
		payload := lotteryDrawPayload(*draw, true)
		return &payload, nil
	}
	return nil, errors.New("暂无可领取的抽奖机会")
}

func ResolveWeeklyLotteryDraw(id string, resolution string) (*LotteryDrawPayload, error) {
	if resolution != model.LeaderboardOrderCompleted && resolution != model.LeaderboardOrderFailed {
		return nil, errors.New("核查结果无效")
	}
	message := "Root 已确认额度未到账，可重新领取"
	if resolution == model.LeaderboardOrderCompleted {
		message = "Root 已确认额度到账"
	}
	draw, err := model.ResolveUnknownLotteryDraw(id, resolution, message, common.GetTimestamp())
	if err != nil {
		return nil, err
	}
	payload := lotteryDrawPayload(*draw, true)
	return &payload, nil
}

func settleWeeklyLottery(start int64, end int64, periodKey string, pools [][]LotteryPrize) error {
	settled, err := model.IsLotteryPeriodSettled(weeklyLotteryRuleVersion, periodKey)
	if err != nil || settled {
		return err
	}
	usage, err := model.GetLeaderboardUsageTotals(start, end)
	if err != nil {
		return err
	}
	usageUserIds := make([]int, 0, len(usage))
	for _, row := range usage {
		usageUserIds = append(usageUserIds, row.UserId)
	}
	entries, err := leaderboardProfilesForUsers(usageUserIds)
	if err != nil {
		return err
	}
	excludedIds, err := model.GetExcludedLeaderboardUserIds()
	if err != nil {
		return err
	}
	excluded := make(map[int]bool, len(excludedIds))
	for _, userId := range excludedIds {
		excluded[userId] = true
	}
	entryByUser := make(map[int]model.LeaderboardEntry, len(entries))
	for _, entry := range entries {
		entryByUser[entry.UserId] = entry
	}
	rows := make([]model.LeaderboardUsageTotal, 0, len(usage))
	for _, row := range usage {
		if row.Quota > 0 && !excluded[row.UserId] {
			if _, ok := entryByUser[row.UserId]; ok {
				rows = append(rows, row)
			}
		}
	}
	sort.Slice(rows, func(left int, right int) bool {
		if rows[left].Quota != rows[right].Quota {
			return rows[left].Quota > rows[right].Quota
		}
		if rows[left].TokenUsed != rows[right].TokenUsed {
			return rows[left].TokenUsed > rows[right].TokenUsed
		}
		if rows[left].RequestCount != rows[right].RequestCount {
			return rows[left].RequestCount > rows[right].RequestCount
		}
		return entryByUser[rows[left].UserId].Id < entryByUser[rows[right].UserId].Id
	})
	count := min(len(rows), len(pools))
	opportunities := make([]model.LotteryOpportunity, 0, count)
	for index := 0; index < count; index++ {
		entry := entryByUser[rows[index].UserId]
		displayName := entry.AnonymousName
		if entry.IsNamePublic && entry.ParticipateWeek {
			displayName = entry.DisplayName
		}
		poolBytes, err := common.Marshal(pools[index])
		if err != nil {
			return err
		}
		opportunities = append(opportunities, model.LotteryOpportunity{
			DrawRank: index + 1, UserId: entry.UserId, EntryId: entry.Id,
			DisplayNameSnapshot: displayName, TokenUsed: rows[index].TokenUsed,
			Quota: rows[index].Quota, RequestCount: rows[index].RequestCount,
			PrizePoolJson: string(poolBytes), CreatedAt: common.GetTimestamp(),
		})
	}
	return model.SettleLotteryPeriod(weeklyLotteryRuleVersion, periodKey, opportunities, common.GetTimestamp())
}

func loadLotteryOpportunities(fallbackPools [][]LotteryPrize, maximumPeriodKey string) ([]lotteryOpportunity, error) {
	rows, err := model.ListLotteryOpportunities(weeklyLotteryRuleVersion)
	if err != nil {
		return nil, err
	}
	draws, err := model.ListLotteryDraws(weeklyLotteryRuleVersion)
	if err != nil {
		return nil, err
	}
	drawByKey := make(map[string]model.LotteryDraw, len(draws))
	for _, draw := range draws {
		drawByKey[draw.PeriodKey+":"+strconv.Itoa(draw.DrawRank)] = draw
	}
	entries, err := model.ListLeaderboardEntries()
	if err != nil {
		return nil, err
	}
	entryByUser := make(map[int]model.LeaderboardEntry, len(entries))
	for _, entry := range entries {
		entryByUser[entry.UserId] = entry
	}
	result := make([]lotteryOpportunity, 0, len(rows))
	for _, row := range rows {
		if row.PeriodKey > maximumPeriodKey {
			continue
		}
		if entry, ok := entryByUser[row.UserId]; ok {
			row.DisplayNameSnapshot = entry.AnonymousName
			if entry.IsNamePublic && entry.ParticipateWeek {
				row.DisplayNameSnapshot = entry.DisplayName
			}
		}
		pool := make([]LotteryPrize, 0)
		if row.PrizePoolJson != "" {
			_ = common.Unmarshal([]byte(row.PrizePoolJson), &pool)
		}
		if len(pool) == 0 && row.DrawRank > 0 && row.DrawRank <= len(fallbackPools) {
			pool = fallbackPools[row.DrawRank-1]
		}
		current := lotteryOpportunity{LotteryOpportunity: row, pool: pool}
		if draw, ok := drawByKey[row.PeriodKey+":"+strconv.Itoa(row.DrawRank)]; ok {
			drawCopy := draw
			current.draw = &drawCopy
		}
		result = append(result, current)
	}
	return result, nil
}

func configuredLotteryPrizePools() ([][]LotteryPrize, error) {
	defaultPools := [][]LotteryPrize{
		{{AmountUsd: 1, Weight: 40}, {AmountUsd: 2, Weight: 30}, {AmountUsd: 5, Weight: 20}, {AmountUsd: 10, Weight: 9}, {AmountUsd: 50, Weight: 1}},
		{{AmountUsd: 1, Weight: 50}, {AmountUsd: 2, Weight: 30}, {AmountUsd: 5, Weight: 15}, {AmountUsd: 10, Weight: 4}, {AmountUsd: 20, Weight: 1}},
		{{AmountUsd: 1, Weight: 60}, {AmountUsd: 2, Weight: 25}, {AmountUsd: 5, Weight: 12}, {AmountUsd: 10, Weight: 3}},
	}
	if common.LeaderboardLotteryPrizes == "" {
		return defaultPools, nil
	}
	var nested [][]LotteryPrize
	if err := common.Unmarshal([]byte(common.LeaderboardLotteryPrizes), &nested); err != nil || len(nested) == 0 {
		var flat []LotteryPrize
		if flatErr := common.Unmarshal([]byte(common.LeaderboardLotteryPrizes), &flat); flatErr != nil || len(flat) == 0 {
			return nil, errors.New("LOTTERY_PRIZES 必须是有效奖池数组")
		}
		nested = make([][]LotteryPrize, 3)
		for index := range nested {
			nested[index] = append([]LotteryPrize(nil), flat...)
		}
	}
	if len(nested) > 3 {
		return nil, errors.New("LOTTERY_PRIZES 最多支持前三名")
	}
	for _, pool := range nested {
		if len(pool) == 0 {
			return nil, errors.New("奖池不能为空")
		}
		for _, prize := range pool {
			if prize.AmountUsd <= 0 || prize.Weight <= 0 {
				return nil, errors.New("奖池金额和权重必须为正数")
			}
		}
	}
	return nested, nil
}

func pickLotteryPrize(pool []LotteryPrize) (LotteryPrize, error) {
	totalWeight := 0
	for _, prize := range pool {
		totalWeight += prize.Weight
	}
	if totalWeight <= 0 {
		return LotteryPrize{}, errors.New("奖池为空")
	}
	value, err := rand.Int(rand.Reader, big.NewInt(int64(totalWeight)))
	if err != nil {
		return LotteryPrize{}, err
	}
	remaining := int(value.Int64())
	for _, prize := range pool {
		remaining -= prize.Weight
		if remaining < 0 {
			return prize, nil
		}
	}
	return pool[len(pool)-1], nil
}

func lotteryOpportunityPayload(opportunity lotteryOpportunity, userId int, includeUsage bool) LotteryOpportunityPayload {
	start, end, _ := leaderboardWeekFromKey(opportunity.PeriodKey)
	payload := LotteryOpportunityPayload{
		PeriodKey: opportunity.PeriodKey, WeekStart: start, WeekEnd: end,
		Rank: opportunity.DrawRank, DisplayName: opportunity.DisplayNameSnapshot,
		IsMe: opportunity.UserId == userId,
	}
	if includeUsage {
		payload.TokenUsed = opportunity.TokenUsed
		payload.Quota = opportunity.Quota
		payload.RequestCount = opportunity.RequestCount
		payload.AmountUsd = float64(opportunity.Quota) / common.QuotaPerUnit
	}
	if opportunity.draw != nil {
		draw := lotteryDrawPayload(*opportunity.draw, false)
		payload.Draw = &draw
	}
	return payload
}

func lotteryDrawPayload(draw model.LotteryDraw, includeError bool) LotteryDrawPayload {
	payload := LotteryDrawPayload{
		RuleVersion: draw.RuleVersion, PeriodKey: draw.PeriodKey, Rank: draw.DrawRank,
		AmountUsd: draw.AmountUsd, QuotaAmount: draw.QuotaAmount, Status: draw.Status,
		DisplayName: draw.DisplayNameSnapshot, CreatedAt: draw.CreatedAt,
		UpdatedAt: draw.UpdatedAt, CompletedAt: draw.CompletedAt,
	}
	if includeError {
		payload.Id = draw.Id
		payload.ErrorMessage = draw.ErrorMessage
	}
	return payload
}

func previousLeaderboardWeek(now time.Time) (int64, int64, string, error) {
	location, err := time.LoadLocation(leaderboardTimeZone)
	if err != nil {
		return 0, 0, "", err
	}
	local := now.In(location)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	offset := (int(dayStart.Weekday()) + 6) % 7
	currentWeek := dayStart.AddDate(0, 0, -offset)
	previousWeek := currentWeek.AddDate(0, 0, -7)
	return previousWeek.Unix(), currentWeek.Unix(), previousWeek.Format("2006-01-02"), nil
}

func leaderboardWeekFromKey(key string) (int64, int64, error) {
	location, err := time.LoadLocation(leaderboardTimeZone)
	if err != nil {
		return 0, 0, err
	}
	start, err := time.ParseInLocation("2006-01-02", key, location)
	if err != nil {
		return 0, 0, err
	}
	return start.Unix(), start.AddDate(0, 0, 7).Unix(), nil
}
