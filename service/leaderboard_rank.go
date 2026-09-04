package service

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	rankengine "github.com/QuantumNous/new-api/pkg/rank"
	"gorm.io/gorm"
)

const leaderboardTimeZone = "Asia/Shanghai"
const rankReplayCacheTTL = 30 * time.Second

type rankReplayCacheEntry struct {
	database     *gorm.DB
	quotaPerUnit float64
	expiresAt    time.Time
	progresses   map[int]rankengine.Progress
	hasUsage     map[int]bool
	lastUpdated  int64
}

var rankReplayCache = struct {
	sync.Mutex
	entries map[int]rankReplayCacheEntry
}{entries: make(map[int]rankReplayCacheEntry)}

type SponsorBadge struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

type LeaderboardRow struct {
	Id            int           `json:"id"`
	DisplayName   string        `json:"displayName"`
	RankLabel     string        `json:"rankLabel,omitempty"`
	ShowRankBadge bool          `json:"showRankBadge"`
	UpdatedAt     int64         `json:"updatedAt,omitempty"`
	TokenUsed     int64         `json:"tokenUsed,omitempty"`
	RequestCount  int64         `json:"requestCount,omitempty"`
	Rank          int           `json:"rank,omitempty"`
	SponsorBadge  *SponsorBadge `json:"sponsorBadge"`
	IsSponsor     bool          `json:"isSponsor,omitempty"`
}

type UsageBoardPayload struct {
	Period      string           `json:"period"`
	PeriodKey   string           `json:"periodKey"`
	TimeZone    string           `json:"timeZone"`
	Entries     []LeaderboardRow `json:"entries"`
	MemberCount int              `json:"memberCount"`
	Totals      struct {
		TokenUsed    int64 `json:"tokenUsed"`
		RequestCount int64 `json:"requestCount"`
	} `json:"totals"`
	LastSyncAt int64 `json:"lastSyncAt"`
}

type TierBoardPayload struct {
	TimeZone string           `json:"timeZone"`
	Entries  []LeaderboardRow `json:"entries"`
	Totals   struct {
		MemberCount int `json:"memberCount"`
	} `json:"totals"`
	LastSyncAt int64 `json:"lastSyncAt"`
}

type rankSource struct {
	quota        int64
	renameScore  int64
	sponsorScore int64
}

func GetRankProgress(userId int) (rankengine.Progress, error) {
	progresses, _, _, err := getRankProgresses(userId)
	if err != nil {
		return rankengine.Progress{}, err
	}
	if progress, ok := progresses[userId]; ok {
		return progress, nil
	}
	today, err := leaderboardDayKey(common.GetTimestamp())
	if err != nil {
		return rankengine.Progress{}, err
	}
	return rankengine.Calculate(nil, today), nil
}

func GetCouponRankRecipientUserIds(rankMin string, rankMax string) ([]int, error) {
	minPosition, minValid := rankengine.ParseTierKey(rankMin)
	maxPosition, maxValid := rankengine.ParseTierKey(rankMax)
	if !minValid || !maxValid || minPosition > maxPosition {
		return nil, errors.New("invalid coupon rank range")
	}
	progresses, _, _, err := getRankProgresses(0)
	if err != nil {
		return nil, err
	}
	userIds, err := model.GetAllUserIds()
	if err != nil {
		return nil, err
	}
	today, err := leaderboardDayKey(common.GetTimestamp())
	if err != nil {
		return nil, err
	}
	defaultProgress := rankengine.Calculate(nil, today)
	recipients := make([]int, 0)
	for _, userId := range userIds {
		progress, found := progresses[userId]
		if !found {
			progress = defaultProgress
		}
		position := progress.TierIndex
		if position >= minPosition && position <= maxPosition {
			recipients = append(recipients, userId)
		}
	}
	return recipients, nil
}

func getRankProgresses(userId int) (map[int]rankengine.Progress, map[int]bool, int64, error) {
	rankReplayCache.Lock()
	defer rankReplayCache.Unlock()
	now := time.Now()
	cacheKeys := []int{userId}
	if userId > 0 {
		cacheKeys = append([]int{0}, cacheKeys...)
	}
	for _, cacheKey := range cacheKeys {
		cached, ok := rankReplayCache.entries[cacheKey]
		if ok && cached.database == model.DB && cached.quotaPerUnit == common.QuotaPerUnit && now.Before(cached.expiresAt) {
			return cached.progresses, cached.hasUsage, cached.lastUpdated, nil
		}
	}
	progresses, hasUsage, lastUpdated, err := replayRankProgresses(userId)
	if err != nil {
		return nil, nil, 0, err
	}
	rankReplayCache.entries[userId] = rankReplayCacheEntry{
		database: model.DB, quotaPerUnit: common.QuotaPerUnit, expiresAt: now.Add(rankReplayCacheTTL),
		progresses: progresses, hasUsage: hasUsage, lastUpdated: lastUpdated,
	}
	return progresses, hasUsage, lastUpdated, nil
}

func replayRankProgresses(userId int) (map[int]rankengine.Progress, map[int]bool, int64, error) {
	location, err := time.LoadLocation(leaderboardTimeZone)
	if err != nil {
		return nil, nil, 0, err
	}
	quotaRows, err := model.GetRankQuotaRows(userId)
	if err != nil {
		return nil, nil, 0, err
	}
	sponsors, err := model.ListCompletedSponsorOrders(userId)
	if err != nil {
		return nil, nil, 0, err
	}
	renameOrders, err := model.ListCompletedRenameCardOrders(userId)
	if err != nil {
		return nil, nil, 0, err
	}

	byUser := make(map[int]map[string]*rankSource)
	hasUsage := make(map[int]bool)
	lastUpdatedAt := int64(0)
	ensureDay := func(currentUserId int, timestamp int64) *rankSource {
		day := time.Unix(timestamp, 0).In(location).Format("2006-01-02")
		if byUser[currentUserId] == nil {
			byUser[currentUserId] = make(map[string]*rankSource)
		}
		if byUser[currentUserId][day] == nil {
			byUser[currentUserId][day] = &rankSource{}
		}
		return byUser[currentUserId][day]
	}
	for _, row := range quotaRows {
		ensureDay(row.UserId, row.CreatedAt).quota += row.Quota
		if row.Quota != 0 || row.TokenUsed > 0 || row.RequestCount > 0 {
			hasUsage[row.UserId] = true
		}
		lastUpdatedAt = max(lastUpdatedAt, row.CreatedAt)
	}
	for _, order := range sponsors {
		if order.CompletedAt <= 0 || order.AmountCny <= 0 {
			continue
		}
		ensureDay(order.UserId, order.CompletedAt).sponsorScore += int64(order.AmountCny) * 5
		lastUpdatedAt = max(lastUpdatedAt, order.CompletedAt)
	}
	for _, order := range renameOrders {
		if order.CompletedAt <= 0 || order.AmountCny <= 0 {
			continue
		}
		ensureDay(order.UserId, order.CompletedAt).renameScore += int64(order.AmountCny) * 2
		lastUpdatedAt = max(lastUpdatedAt, order.CompletedAt)
	}

	quotaPerUnit := int64(common.QuotaPerUnit)
	if quotaPerUnit <= 0 {
		return nil, nil, 0, errors.New("quota per unit must be positive")
	}
	today := time.Now().In(location).Format("2006-01-02")
	progresses := make(map[int]rankengine.Progress, len(byUser))
	for currentUserId, days := range byUser {
		scores := make([]rankengine.DailyScore, 0, len(days))
		for day, source := range days {
			scores = append(scores, rankengine.DailyScore{
				Day:          day,
				TokenScore:   max(source.quota, 0) / quotaPerUnit,
				RenameScore:  source.renameScore,
				SponsorScore: source.sponsorScore,
			})
		}
		progresses[currentUserId] = rankengine.Calculate(scores, today)
	}
	return progresses, hasUsage, lastUpdatedAt, nil
}

func invalidateRankReplayCache() {
	rankReplayCache.Lock()
	rankReplayCache.entries = make(map[int]rankReplayCacheEntry)
	rankReplayCache.Unlock()
}

func GetUsageBoard(period string) (*UsageBoardPayload, error) {
	startAt, endAt, periodKey, err := leaderboardPeriodRange(period, time.Now())
	if err != nil {
		return nil, err
	}
	usage, err := model.GetLeaderboardUsageTotals(startAt, endAt)
	if err != nil {
		return nil, err
	}
	usageUserIds := make([]int, 0, len(usage))
	for _, row := range usage {
		usageUserIds = append(usageUserIds, row.UserId)
	}
	entries, err := leaderboardProfilesForUsers(usageUserIds)
	if err != nil {
		return nil, err
	}
	progresses, _, rankUpdatedAt, err := getRankProgresses(0)
	if err != nil {
		return nil, err
	}
	excludedIds, err := model.GetExcludedLeaderboardUserIds()
	if err != nil {
		return nil, err
	}
	excluded := make(map[int]bool, len(excludedIds))
	for _, id := range excludedIds {
		excluded[id] = true
	}
	sponsorAmounts, err := sponsorAmountsByUser()
	if err != nil {
		return nil, err
	}
	usageByUser := make(map[int]model.LeaderboardUsageTotal, len(usage))
	for _, row := range usage {
		usageByUser[row.UserId] = row
	}

	payload := &UsageBoardPayload{Period: period, PeriodKey: periodKey, TimeZone: leaderboardTimeZone, Entries: make([]LeaderboardRow, 0)}
	payload.LastSyncAt = rankUpdatedAt
	for _, entry := range entries {
		total, ok := usageByUser[entry.UserId]
		if !ok || (total.TokenUsed == 0 && total.Quota == 0 && total.RequestCount == 0) {
			continue
		}
		if excluded[entry.UserId] || !participatesInPeriod(entry, period) {
			continue
		}
		progress := progresses[entry.UserId]
		var badge *SponsorBadge
		if entry.IsNamePublic {
			badge = sponsorBadgeForAmount(sponsorAmounts[entry.UserId])
		}
		payload.Entries = append(payload.Entries, LeaderboardRow{
			Id: entry.Id, DisplayName: leaderboardDisplayName(entry), RankLabel: progress.Label,
			ShowRankBadge: entry.ShowRankBadge, UpdatedAt: total.UpdatedAt,
			TokenUsed: total.TokenUsed, RequestCount: total.RequestCount,
			SponsorBadge: badge, IsSponsor: badge != nil,
		})
		payload.LastSyncAt = max(payload.LastSyncAt, total.UpdatedAt)
	}
	sort.Slice(payload.Entries, func(left int, right int) bool {
		if payload.Entries[left].TokenUsed != payload.Entries[right].TokenUsed {
			return payload.Entries[left].TokenUsed > payload.Entries[right].TokenUsed
		}
		if payload.Entries[left].RequestCount != payload.Entries[right].RequestCount {
			return payload.Entries[left].RequestCount > payload.Entries[right].RequestCount
		}
		return payload.Entries[left].Id < payload.Entries[right].Id
	})
	for index := range payload.Entries {
		payload.Entries[index].Rank = index + 1
		payload.Totals.TokenUsed += payload.Entries[index].TokenUsed
		payload.Totals.RequestCount += payload.Entries[index].RequestCount
	}
	payload.MemberCount = len(payload.Entries)
	return payload, nil
}

func GetTierBoard() (*TierBoardPayload, error) {
	progresses, hasUsage, lastUpdatedAt, err := getRankProgresses(0)
	if err != nil {
		return nil, err
	}
	userIds := make([]int, 0, len(progresses))
	for userId := range progresses {
		userIds = append(userIds, userId)
	}
	entries, err := leaderboardProfilesForUsers(userIds)
	if err != nil {
		return nil, err
	}
	excludedIds, err := model.GetExcludedLeaderboardUserIds()
	if err != nil {
		return nil, err
	}
	excluded := make(map[int]bool, len(excludedIds))
	for _, id := range excludedIds {
		excluded[id] = true
	}
	sponsorAmounts, err := sponsorAmountsByUser()
	if err != nil {
		return nil, err
	}

	type rankedRow struct {
		row       LeaderboardRow
		rankValue int64
		total     int64
	}
	ranked := make([]rankedRow, 0, len(entries))
	for _, entry := range entries {
		if excluded[entry.UserId] || !entry.ParticipateRank {
			continue
		}
		progress, ok := progresses[entry.UserId]
		if !ok || (!hasUsage[entry.UserId] && progress.TotalScore <= 0) {
			continue
		}
		var badge *SponsorBadge
		if entry.IsNamePublic {
			badge = sponsorBadgeForAmount(sponsorAmounts[entry.UserId])
		}
		ranked = append(ranked, rankedRow{
			row: LeaderboardRow{
				Id: entry.Id, DisplayName: leaderboardDisplayName(entry), RankLabel: progress.Label,
				ShowRankBadge: entry.ShowRankBadge, SponsorBadge: badge,
			},
			rankValue: progress.RankValue,
			total:     progress.TotalScore,
		})
	}
	sort.Slice(ranked, func(left int, right int) bool {
		if ranked[left].rankValue != ranked[right].rankValue {
			return ranked[left].rankValue > ranked[right].rankValue
		}
		if ranked[left].total != ranked[right].total {
			return ranked[left].total > ranked[right].total
		}
		return ranked[left].row.Id < ranked[right].row.Id
	})
	payload := &TierBoardPayload{TimeZone: leaderboardTimeZone, Entries: make([]LeaderboardRow, 0, len(ranked)), LastSyncAt: lastUpdatedAt}
	for index := range ranked {
		ranked[index].row.Rank = index + 1
		ranked[index].row.IsSponsor = ranked[index].row.SponsorBadge != nil
		payload.Entries = append(payload.Entries, ranked[index].row)
	}
	payload.Totals.MemberCount = len(payload.Entries)
	return payload, nil
}

func leaderboardDisplayName(entry model.LeaderboardEntry) string {
	if entry.IsNamePublic {
		return entry.DisplayName
	}
	if entry.AnonymousName != "" {
		return entry.AnonymousName
	}
	if entry.SourceName != "" {
		return entry.SourceName
	}
	if entry.Username != "" {
		return entry.Username
	}
	return fmt.Sprintf("用户 #%d", entry.UserId)
}

func participatesInPeriod(entry model.LeaderboardEntry, period string) bool {
	switch period {
	case "day":
		return entry.ParticipateDay
	case "week":
		return entry.ParticipateWeek
	case "month":
		return entry.ParticipateMonth
	case "all":
		return entry.ParticipateAll
	default:
		return false
	}
}

func sponsorAmountsByUser() (map[int]int64, error) {
	orders, err := model.ListCompletedSponsorOrders(0)
	if err != nil {
		return nil, err
	}
	amounts := make(map[int]int64)
	for _, order := range orders {
		amounts[order.UserId] += int64(max(order.AmountCny, 0))
	}
	return amounts, nil
}

func sponsorBadgeForAmount(amount int64) *SponsorBadge {
	points := max(amount, 0) * 10
	switch {
	case points >= 1_000:
		return &SponsorBadge{Key: "diamond", Name: "钻石"}
	case points >= 500:
		return &SponsorBadge{Key: "black-gold", Name: "黑金"}
	case points >= 250:
		return &SponsorBadge{Key: "platinum", Name: "白金"}
	case points >= 100:
		return &SponsorBadge{Key: "gold", Name: "金卡"}
	case points >= 10:
		return &SponsorBadge{Key: "silver", Name: "银卡"}
	default:
		return nil
	}
}

func leaderboardDayKey(timestamp int64) (string, error) {
	location, err := time.LoadLocation(leaderboardTimeZone)
	if err != nil {
		return "", err
	}
	return time.Unix(timestamp, 0).In(location).Format("2006-01-02"), nil
}

func leaderboardPeriodRange(period string, now time.Time) (int64, int64, string, error) {
	location, err := time.LoadLocation(leaderboardTimeZone)
	if err != nil {
		return 0, 0, "", err
	}
	localNow := now.In(location)
	year, month, day := localNow.Date()
	dayStart := time.Date(year, month, day, 0, 0, 0, 0, location)
	end := now.Unix() + 1
	switch strings.ToLower(period) {
	case "day":
		return dayStart.Unix(), end, dayStart.Format("2006-01-02"), nil
	case "week":
		weekdayOffset := (int(dayStart.Weekday()) + 6) % 7
		start := dayStart.AddDate(0, 0, -weekdayOffset)
		return start.Unix(), end, start.Format("2006-01-02"), nil
	case "month":
		start := time.Date(year, month, 1, 0, 0, 0, 0, location)
		return start.Unix(), end, start.Format("2006-01"), nil
	case "all":
		return 1, end, "all", nil
	default:
		return 0, 0, "", errors.New("unsupported leaderboard period")
	}
}

func EnsureLeaderboardProfile(userId int) (*model.LeaderboardEntry, error) {
	entry, err := model.GetLeaderboardEntryByUserId(userId)
	if err == nil {
		return entry, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		return nil, err
	}
	displayName := strings.TrimSpace(user.DisplayName)
	if displayName == "" {
		displayName = user.Username
	}
	anonymousName := "匿名用户 " + strings.ToUpper(strings.ReplaceAll(common.GetUUID(), "-", ""))[:10]
	return model.EnsureLeaderboardEntry(userId, user.Username, displayName, anonymousName)
}

func leaderboardProfilesForUsers(userIds []int) ([]model.LeaderboardEntry, error) {
	entries, err := model.ListLeaderboardEntries()
	if err != nil {
		return nil, err
	}
	known := make(map[int]bool, len(entries))
	for _, entry := range entries {
		known[entry.UserId] = true
	}
	for _, userId := range userIds {
		if userId <= 0 || known[userId] {
			continue
		}
		entry, ensureErr := EnsureLeaderboardProfile(userId)
		if errors.Is(ensureErr, gorm.ErrRecordNotFound) {
			continue
		}
		if ensureErr != nil {
			return nil, ensureErr
		}
		entries = append(entries, *entry)
		known[userId] = true
	}
	sort.Slice(entries, func(left int, right int) bool {
		return entries[left].Id < entries[right].Id
	})
	return entries, nil
}
