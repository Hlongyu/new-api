package service

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	rechargeLotteryRequestKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,80}$`)
	rechargeLotteryMaintenanceOnce   sync.Once
)

type RechargeLotteryServiceError struct {
	Status  int
	Message string
}

func (e *RechargeLotteryServiceError) Error() string { return e.Message }

func RechargeLotteryErrorStatus(err error) int {
	var serviceError *RechargeLotteryServiceError
	if errors.As(err, &serviceError) {
		return serviceError.Status
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return http.StatusNotFound
	}
	if errors.Is(err, model.ErrRechargeLotteryRequestConflict) {
		return http.StatusConflict
	}
	if errors.Is(err, model.ErrRechargeLotteryInsufficientBalance) ||
		errors.Is(err, model.ErrRechargeLotteryCampaignUnavailable) ||
		errors.Is(err, model.ErrRechargeLotteryFulfillmentState) {
		return http.StatusConflict
	}
	if errors.Is(err, model.ErrCompanionMigrationRequired) {
		return http.StatusServiceUnavailable
	}
	return http.StatusInternalServerError
}

type RechargeLotteryPrizePayload struct {
	Id          int     `json:"id"`
	AmountUsd   int     `json:"amountUsd"`
	Weight      int     `json:"weight"`
	Rarity      string  `json:"rarity"`
	Probability float64 `json:"probability"`
}

type RechargeLotteryCampaignPayload struct {
	Id               string                        `json:"id"`
	Name             string                        `json:"name"`
	Phase            string                        `json:"phase"`
	StartsAt         int64                         `json:"startsAt"`
	EndsAt           int64                         `json:"endsAt"`
	RulesVersion     int                           `json:"rulesVersion"`
	IsPermanent      bool                          `json:"isPermanent"`
	IsDefault        bool                          `json:"isDefault"`
	SubscriptionDays int                           `json:"subscriptionDays"`
	ExpectedValue    float64                       `json:"expectedValue"`
	Prizes           []RechargeLotteryPrizePayload `json:"prizes"`
}

type RechargeLotteryRedemptionProgressPayload struct {
	ThresholdUsd    int     `json:"thresholdUsd"`
	ObservedUsd     float64 `json:"observedUsd"`
	RemainderUsd    float64 `json:"remainderUsd"`
	RemainingUsd    float64 `json:"remainingUsd"`
	ProgressRatio   float64 `json:"progressRatio"`
	GrantedDraws    int64   `json:"grantedDraws"`
	RedemptionCount int64   `json:"redemptionCount"`
	UserCount       int64   `json:"userCount"`
	UpdatedAt       int64   `json:"updatedAt"`
}

type RechargeLotteryDrawItemPayload struct {
	Ordinal   int    `json:"ordinal"`
	AmountUsd int    `json:"amountUsd"`
	Rarity    string `json:"rarity"`
}

type RechargeLotteryDrawPayload struct {
	Id             string                           `json:"id"`
	CampaignId     string                           `json:"campaignId"`
	UserId         int                              `json:"userId"`
	DrawCount      int                              `json:"drawCount"`
	TotalAmountUsd int                              `json:"totalAmountUsd"`
	TotalQuota     int64                            `json:"totalQuota"`
	Status         string                           `json:"status"`
	ErrorMessage   string                           `json:"errorMessage"`
	CreatedAt      int64                            `json:"createdAt"`
	CompletedAt    int64                            `json:"completedAt"`
	ExpiresAt      int64                            `json:"expiresAt"`
	HighestRarity  string                           `json:"highestRarity"`
	Items          []RechargeLotteryDrawItemPayload `json:"items"`
}

type RechargeLotteryStatusPayload struct {
	User struct {
		Id          int    `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		IsRoot      bool   `json:"isRoot"`
	} `json:"user"`
	Campaigns          []RechargeLotteryCampaignPayload          `json:"campaigns"`
	Campaign           *RechargeLotteryCampaignPayload           `json:"campaign"`
	Balance            int64                                     `json:"balance"`
	History            []RechargeLotteryDrawPayload              `json:"history"`
	RedemptionProgress *RechargeLotteryRedemptionProgressPayload `json:"redemptionProgress"`
	MainSiteUrl        string                                    `json:"mainSiteUrl"`
	TimeZone           string                                    `json:"timeZone"`
}

type RechargeLotteryAdminCampaignPayload struct {
	RechargeLotteryCampaignPayload
	Status          string                             `json:"status"`
	SimulationCount int                                `json:"simulationCount"`
	CreatedAt       int64                              `json:"createdAt"`
	PublishedAt     int64                              `json:"publishedAt"`
	EndedAt         int64                              `json:"endedAt"`
	Stats           model.RechargeLotteryCampaignStats `json:"stats"`
}

type RechargeLotteryGrantBatchPayload struct {
	Id             string `json:"id"`
	CampaignId     string `json:"campaignId"`
	Kind           string `json:"kind"`
	Quantity       int    `json:"quantity"`
	Status         string `json:"status"`
	RecipientCount int    `json:"recipientCount"`
	ProcessedCount int    `json:"processedCount"`
	Note           string `json:"note"`
	ErrorMessage   string `json:"errorMessage"`
	CreatedAt      int64  `json:"createdAt"`
}

type RechargeLotteryPlanMappingPayload struct {
	AmountUsd    int    `json:"amountUsd"`
	QuotaAmount  int64  `json:"quotaAmount"`
	DurationDays int    `json:"durationDays"`
	PlanId       int    `json:"planId"`
	PlanTitle    string `json:"planTitle"`
	VerifiedAt   int64  `json:"verifiedAt"`
}

type RechargeLotteryRedemptionStatePayload struct {
	Configured      bool    `json:"configured"`
	Running         bool    `json:"running"`
	LastCheckedAt   int64   `json:"lastCheckedAt"`
	LastError       string  `json:"lastError"`
	ThresholdUsd    int     `json:"thresholdUsd"`
	ObservedUsd     float64 `json:"observedUsd"`
	RemainderUsd    float64 `json:"remainderUsd"`
	RemainingUsd    float64 `json:"remainingUsd"`
	GrantedDraws    int64   `json:"grantedDraws"`
	RedemptionCount int64   `json:"redemptionCount"`
	UserCount       int64   `json:"userCount"`
}

type RechargeLotteryAdminDashboardPayload struct {
	Campaigns         []RechargeLotteryAdminCampaignPayload `json:"campaigns"`
	Redemption        RechargeLotteryRedemptionStatePayload `json:"redemption"`
	GrantBatches      []RechargeLotteryGrantBatchPayload    `json:"grantBatches"`
	FulfillmentIssues []RechargeLotteryDrawPayload          `json:"fulfillmentIssues"`
	PlanMappings      []RechargeLotteryPlanMappingPayload   `json:"planMappings"`
}

type RechargeLotteryDrawRequest struct {
	RequestKey string
	CampaignId string
	Count      int
}

type RechargeLotteryPrizeInput struct {
	AmountUsd int    `json:"amountUsd"`
	Weight    int    `json:"weight"`
	Rarity    string `json:"rarity"`
}

type RechargeLotteryCampaignInput struct {
	Name     string
	StartsAt int64
	EndsAt   int64
	Prizes   []RechargeLotteryPrizeInput
}

type RechargeLotteryGrantInput struct {
	RequestKey            string
	CampaignId            string
	Kind                  string
	Quantity              int
	UserIds               []int
	SkipPreviouslyGranted bool
	Note                  string
	OperatorUserId        int
}

func rechargeLotteryError(status int, message string) error {
	return &RechargeLotteryServiceError{Status: status, Message: message}
}

func rechargeLotteryCampaignPhase(campaign *model.RechargeLotteryCampaignWithPrizes, now int64) string {
	if campaign == nil {
		return "none"
	}
	switch campaign.Status {
	case model.RechargeLotteryCampaignDraft:
		return "draft"
	case model.RechargeLotteryCampaignCancelled:
		return "cancelled"
	case model.RechargeLotteryCampaignEnded:
		return "ended"
	}
	if now >= campaign.EndsAt {
		return "ended"
	}
	if now < campaign.StartsAt {
		return "upcoming"
	}
	return "active"
}

func rechargeLotteryCampaignPayload(campaign model.RechargeLotteryCampaignWithPrizes, now int64) RechargeLotteryCampaignPayload {
	payload := RechargeLotteryCampaignPayload{
		Id: campaign.Id, Name: campaign.Name, Phase: rechargeLotteryCampaignPhase(&campaign, now),
		StartsAt: campaign.StartsAt, EndsAt: campaign.EndsAt, RulesVersion: campaign.RulesVersion,
		IsPermanent: campaign.IsPermanent, IsDefault: campaign.IsDefault,
		SubscriptionDays: model.RechargeLotterySubscriptionDays,
		Prizes:           make([]RechargeLotteryPrizePayload, 0, len(campaign.Prizes)),
	}
	totalWeight := 0
	for _, prize := range campaign.Prizes {
		totalWeight += prize.Weight
		payload.ExpectedValue += float64(prize.AmountUsd * prize.Weight)
	}
	if totalWeight > 0 {
		payload.ExpectedValue /= float64(totalWeight)
	}
	for _, prize := range campaign.Prizes {
		probability := 0.0
		if totalWeight > 0 {
			probability = float64(prize.Weight) / float64(totalWeight)
		}
		payload.Prizes = append(payload.Prizes, RechargeLotteryPrizePayload{
			Id: prize.Id, AmountUsd: prize.AmountUsd, Weight: prize.Weight,
			Rarity: prize.Rarity, Probability: probability,
		})
	}
	return payload
}

func rechargeLotteryProgressPayload(progress model.RechargeLotteryRedemptionProgress) (*RechargeLotteryRedemptionProgressPayload, error) {
	if common.QuotaPerUnit <= 0 {
		return nil, errors.New("invalid quota per unit")
	}
	thresholdQuota, err := common.QuotaFromFloatStrict(float64(model.RechargeLotteryQuotaThresholdUsd) * common.QuotaPerUnit)
	if err != nil {
		return nil, err
	}
	remainderQuota := progress.ObservedQuota % int64(thresholdQuota)
	payload := &RechargeLotteryRedemptionProgressPayload{
		ThresholdUsd:  model.RechargeLotteryQuotaThresholdUsd,
		ObservedUsd:   float64(progress.ObservedQuota) / common.QuotaPerUnit,
		RemainderUsd:  float64(remainderQuota) / common.QuotaPerUnit,
		RemainingUsd:  float64(int64(thresholdQuota)-remainderQuota) / common.QuotaPerUnit,
		ProgressRatio: float64(remainderQuota) / float64(thresholdQuota),
		GrantedDraws:  int64(progress.GrantedDraws), RedemptionCount: int64(progress.RedemptionCount),
		UpdatedAt: progress.UpdatedAt,
	}
	return payload, nil
}

func rechargeLotteryDrawPayload(draw model.RechargeLotteryDrawBatch) RechargeLotteryDrawPayload {
	rarityOrder := map[string]int{"common": 0, "rare": 1, "epic": 2, "legendary": 3}
	highest := "common"
	payload := RechargeLotteryDrawPayload{
		Id: draw.Id, CampaignId: draw.CampaignId, UserId: draw.UserId,
		DrawCount: draw.DrawCount, TotalAmountUsd: draw.TotalAmountUsd, TotalQuota: draw.TotalQuota,
		Status: draw.Status, ErrorMessage: draw.ErrorMessage, CreatedAt: draw.CreatedAt,
		CompletedAt: draw.CompletedAt, ExpiresAt: model.RechargeLotterySubscriptionExpiresAt(draw),
		Items: make([]RechargeLotteryDrawItemPayload, 0, len(draw.Items)),
	}
	for _, item := range draw.Items {
		if rarityOrder[item.Rarity] > rarityOrder[highest] {
			highest = item.Rarity
		}
		payload.Items = append(payload.Items, RechargeLotteryDrawItemPayload{
			Ordinal: item.Ordinal, AmountUsd: item.AmountUsd, Rarity: item.Rarity,
		})
	}
	payload.HighestRarity = highest
	return payload
}

func currentRechargeLotteryCampaign(requestedId string, now int64) (*model.RechargeLotteryCampaignWithPrizes, error) {
	if err := model.EndExpiredRechargeLotteryCampaigns(now); err != nil {
		return nil, err
	}
	if strings.TrimSpace(requestedId) != "" {
		campaign, err := model.GetRechargeLotteryCampaign(strings.TrimSpace(requestedId))
		if err != nil {
			return nil, err
		}
		if campaign.Status != model.RechargeLotteryCampaignPublished {
			return nil, gorm.ErrRecordNotFound
		}
		return campaign, nil
	}
	campaign, err := model.GetDefaultRechargeLotteryCampaign()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.EnsureRechargeLotteryDefaultCampaign()
	}
	return campaign, err
}

func GetRechargeLotteryStatus(userId int, isRoot bool, campaignId string) (*RechargeLotteryStatusPayload, error) {
	now := common.GetTimestamp()
	if _, err := model.EnsureRechargeLotteryDefaultCampaign(); err != nil {
		return nil, err
	}
	campaigns, err := model.ListRechargeLotteryCampaigns(true)
	if err != nil {
		return nil, err
	}
	campaign, err := currentRechargeLotteryCampaign(campaignId, now)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		return nil, err
	}
	payload := &RechargeLotteryStatusPayload{
		Campaigns: make([]RechargeLotteryCampaignPayload, 0, len(campaigns)),
		History:   make([]RechargeLotteryDrawPayload, 0), MainSiteUrl: system_setting.ServerAddress,
		TimeZone: "Asia/Shanghai",
	}
	payload.User.Id = userId
	payload.User.Username = user.Username
	payload.User.DisplayName = strings.TrimSpace(user.DisplayName)
	if payload.User.DisplayName == "" {
		payload.User.DisplayName = user.Username
	}
	payload.User.IsRoot = isRoot
	for _, item := range campaigns {
		if rechargeLotteryCampaignPhase(&item, now) != "ended" {
			payload.Campaigns = append(payload.Campaigns, rechargeLotteryCampaignPayload(item, now))
		}
	}
	if campaign != nil {
		campaignPayload := rechargeLotteryCampaignPayload(*campaign, now)
		payload.Campaign = &campaignPayload
		payload.Balance, err = model.GetRechargeLotteryBalance(campaign.Id, userId)
		if err != nil {
			return nil, err
		}
		draws, err := model.ListRechargeLotteryUserDraws(userId, campaign.Id, 20, 0)
		if err != nil {
			return nil, err
		}
		for _, draw := range draws {
			payload.History = append(payload.History, rechargeLotteryDrawPayload(draw))
		}
	}
	progress, err := model.GetRechargeLotteryRedemptionProgress(userId)
	if err == nil {
		payload.RedemptionProgress, err = rechargeLotteryProgressPayload(*progress)
		if err != nil {
			return nil, err
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return payload, nil
}

func ListRechargeLotteryHistory(userId int, campaignId string, offset int) ([]RechargeLotteryDrawPayload, error) {
	campaign, err := currentRechargeLotteryCampaign(campaignId, common.GetTimestamp())
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return []RechargeLotteryDrawPayload{}, nil
		}
		return nil, err
	}
	draws, err := model.ListRechargeLotteryUserDraws(userId, campaign.Id, 20, max(offset, 0))
	if err != nil {
		return nil, err
	}
	payload := make([]RechargeLotteryDrawPayload, 0, len(draws))
	for _, draw := range draws {
		payload = append(payload, rechargeLotteryDrawPayload(draw))
	}
	return payload, nil
}

func DrawRechargeLottery(userId int, request RechargeLotteryDrawRequest) (*RechargeLotteryDrawPayload, bool, error) {
	request.RequestKey = strings.TrimSpace(request.RequestKey)
	if !rechargeLotteryRequestKeyPattern.MatchString(request.RequestKey) {
		return nil, false, rechargeLotteryError(http.StatusBadRequest, "请求号格式无效")
	}
	if request.Count != 1 && request.Count != 10 {
		return nil, false, rechargeLotteryError(http.StatusBadRequest, "仅支持单抽或十连抽")
	}
	if existing, err := model.GetRechargeLotteryDrawByRequestKey(request.RequestKey); err == nil {
		if existing.UserId != userId || (request.CampaignId != "" && existing.CampaignId != request.CampaignId) {
			return nil, false, model.ErrRechargeLotteryRequestConflict
		}
		payload := rechargeLotteryDrawPayload(*existing)
		return &payload, false, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}

	now := common.GetTimestamp()
	campaign, err := currentRechargeLotteryCampaign(request.CampaignId, now)
	if err != nil || rechargeLotteryCampaignPhase(campaign, now) != "active" {
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, err
		}
		return nil, false, rechargeLotteryError(http.StatusConflict, "活动尚未开始或已经结束")
	}
	totalWeight := 0
	for _, prize := range campaign.Prizes {
		totalWeight += prize.Weight
	}
	if totalWeight <= 0 {
		return nil, false, rechargeLotteryError(http.StatusServiceUnavailable, "奖池配置无效")
	}
	items := make([]model.RechargeLotteryDrawItem, 0, request.Count)
	totalAmountUsd := 0
	for index := 0; index < request.Count; index++ {
		value, err := rand.Int(rand.Reader, big.NewInt(int64(totalWeight)))
		if err != nil {
			return nil, false, err
		}
		remaining := int(value.Int64())
		selected := campaign.Prizes[len(campaign.Prizes)-1]
		for _, prize := range campaign.Prizes {
			remaining -= prize.Weight
			if remaining < 0 {
				selected = prize
				break
			}
		}
		quotaAmount, err := common.QuotaFromFloatStrict(float64(selected.AmountUsd) * common.QuotaPerUnit)
		if err != nil {
			return nil, false, rechargeLotteryError(http.StatusBadRequest, "奖励额度超出支持范围")
		}
		totalAmountUsd += selected.AmountUsd
		items = append(items, model.RechargeLotteryDrawItem{
			Id: uuid.NewString(), PrizeId: selected.Id, AmountUsd: selected.AmountUsd,
			QuotaAmount: int64(quotaAmount), Rarity: selected.Rarity, RandomValue: value.String(),
		})
	}
	totalQuota, err := common.QuotaFromFloatStrict(float64(totalAmountUsd) * common.QuotaPerUnit)
	if err != nil {
		return nil, false, rechargeLotteryError(http.StatusBadRequest, "奖励额度超出支持范围")
	}
	draw := model.RechargeLotteryDrawBatch{
		Id: uuid.NewString(), RequestKey: request.RequestKey, CampaignId: campaign.Id,
		UserId: userId, DrawCount: request.Count, TotalAmountUsd: totalAmountUsd,
		TotalQuota: int64(totalQuota), PreflightSubscriptionIds: "[]", CreatedAt: now,
	}
	saved, created, err := model.CreateRechargeLotteryDraw(draw, items)
	if err != nil {
		return nil, false, err
	}
	payload := rechargeLotteryDrawPayload(*saved)
	return &payload, created, nil
}

func SyncRechargeLotteryRedemptions() (RechargeLotteryRedemptionStatePayload, error) {
	state := RechargeLotteryRedemptionStatePayload{Configured: true, Running: true, ThresholdUsd: model.RechargeLotteryQuotaThresholdUsd}
	rows, err := model.ListRedeemedQuotaAggregates()
	if err != nil {
		state.LastError = err.Error()
		return state, err
	}
	now := common.GetTimestamp()
	for _, row := range rows {
		if _, err := model.SyncRechargeLotteryRedemptionProgress(row.UserId, row.ObservedQuota, int(row.RedemptionCount), now); err != nil {
			state.LastError = err.Error()
			return state, err
		}
	}
	stats, err := model.GetRechargeLotteryRedemptionStats()
	if err != nil {
		state.LastError = err.Error()
		return state, err
	}
	return rechargeLotteryRedemptionState(stats)
}

func rechargeLotteryRedemptionState(stats model.RechargeLotteryRedemptionStats) (RechargeLotteryRedemptionStatePayload, error) {
	state := RechargeLotteryRedemptionStatePayload{
		Configured: true, Running: false, LastCheckedAt: stats.UpdatedAt,
		ThresholdUsd:    model.RechargeLotteryQuotaThresholdUsd,
		ObservedUsd:     float64(stats.ObservedQuota) / common.QuotaPerUnit,
		RedemptionCount: stats.RedemptionCount, GrantedDraws: stats.GrantedDraws,
		UserCount: stats.UserCount,
	}
	thresholdQuota, err := common.QuotaFromFloatStrict(float64(model.RechargeLotteryQuotaThresholdUsd) * common.QuotaPerUnit)
	if err != nil {
		return state, err
	}
	remainder := stats.ObservedQuota % int64(thresholdQuota)
	state.RemainderUsd = float64(remainder) / common.QuotaPerUnit
	state.RemainingUsd = float64(int64(thresholdQuota)-remainder) / common.QuotaPerUnit
	return state, nil
}

func GetRechargeLotteryAdminDashboard() (*RechargeLotteryAdminDashboardPayload, error) {
	now := common.GetTimestamp()
	if err := model.EndExpiredRechargeLotteryCampaigns(now); err != nil {
		return nil, err
	}
	campaigns, err := model.ListRechargeLotteryCampaigns(false)
	if err != nil {
		return nil, err
	}
	payload := &RechargeLotteryAdminDashboardPayload{
		Campaigns:         make([]RechargeLotteryAdminCampaignPayload, 0, len(campaigns)),
		GrantBatches:      make([]RechargeLotteryGrantBatchPayload, 0),
		FulfillmentIssues: make([]RechargeLotteryDrawPayload, 0),
		PlanMappings:      make([]RechargeLotteryPlanMappingPayload, 0),
	}
	for _, campaign := range campaigns {
		stats, err := model.GetRechargeLotteryCampaignStats(campaign.Id)
		if err != nil {
			return nil, err
		}
		payload.Campaigns = append(payload.Campaigns, RechargeLotteryAdminCampaignPayload{
			RechargeLotteryCampaignPayload: rechargeLotteryCampaignPayload(campaign, now),
			Status:                         campaign.Status, SimulationCount: campaign.SimulationCount,
			CreatedAt: campaign.CreatedAt, PublishedAt: campaign.PublishedAt,
			EndedAt: campaign.EndedAt, Stats: stats,
		})
	}
	redemptionStats, err := model.GetRechargeLotteryRedemptionStats()
	if err != nil {
		return nil, err
	}
	redemption, err := rechargeLotteryRedemptionState(redemptionStats)
	if err != nil {
		return nil, err
	}
	payload.Redemption = redemption
	batches, err := model.ListRechargeLotteryGrantBatches(30)
	if err != nil {
		return nil, err
	}
	for _, batch := range batches {
		payload.GrantBatches = append(payload.GrantBatches, RechargeLotteryGrantBatchPayload{
			Id: batch.Id, CampaignId: batch.CampaignId, Kind: batch.Kind,
			Quantity: batch.QuantityPerUser, Status: batch.Status,
			RecipientCount: batch.RecipientCount, ProcessedCount: batch.ProcessedCount,
			Note: batch.Note, ErrorMessage: batch.ErrorMessage, CreatedAt: batch.CreatedAt,
		})
	}
	issues, err := model.ListRechargeLotteryFulfillmentIssues(30)
	if err != nil {
		return nil, err
	}
	for _, draw := range issues {
		payload.FulfillmentIssues = append(payload.FulfillmentIssues, rechargeLotteryDrawPayload(draw))
	}
	mappings, err := model.ListRechargeLotteryPlanMappings()
	if err != nil {
		return nil, err
	}
	for _, mapping := range mappings {
		payload.PlanMappings = append(payload.PlanMappings, RechargeLotteryPlanMappingPayload{
			AmountUsd: mapping.AmountUsd, QuotaAmount: mapping.QuotaAmount,
			DurationDays: mapping.DurationDays, PlanId: mapping.PlanId,
			PlanTitle: mapping.PlanTitle, VerifiedAt: mapping.VerifiedAt,
		})
	}
	return payload, nil
}

func normalizeRechargeLotteryText(value, label string, minLength, maxLength int) (string, error) {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	length := utf8.RuneCountInString(value)
	if length < minLength || length > maxLength {
		return "", rechargeLotteryError(http.StatusBadRequest, fmt.Sprintf("%s长度应为 %d-%d 个字符", label, minLength, maxLength))
	}
	return value, nil
}

func CreateRechargeLotteryCampaign(input RechargeLotteryCampaignInput, operatorUserId int) (*RechargeLotteryAdminCampaignPayload, error) {
	name, err := normalizeRechargeLotteryText(input.Name, "活动名称", 1, 48)
	if err != nil {
		return nil, err
	}
	if input.StartsAt <= 0 || input.EndsAt <= input.StartsAt {
		return nil, rechargeLotteryError(http.StatusBadRequest, "结束时间必须晚于开始时间")
	}
	if len(input.Prizes) < 2 || len(input.Prizes) > 12 {
		return nil, rechargeLotteryError(http.StatusBadRequest, "奖池需要 2-12 个奖项")
	}
	allowedRarities := map[string]bool{"common": true, "rare": true, "epic": true, "legendary": true}
	seen := make(map[int]bool, len(input.Prizes))
	prizes := make([]model.RechargeLotteryPrize, 0, len(input.Prizes))
	for _, item := range input.Prizes {
		if item.AmountUsd <= 0 || item.AmountUsd > 9_999 || item.Weight <= 0 || item.Weight > 1_000_000 || !allowedRarities[item.Rarity] {
			return nil, rechargeLotteryError(http.StatusBadRequest, "奖池配置无效")
		}
		if _, err := common.QuotaFromFloatStrict(float64(item.AmountUsd*10) * common.QuotaPerUnit); err != nil {
			return nil, rechargeLotteryError(http.StatusBadRequest, "奖励额度超出支持范围")
		}
		if seen[item.AmountUsd] {
			return nil, rechargeLotteryError(http.StatusBadRequest, "同一活动不能重复配置相同金额")
		}
		seen[item.AmountUsd] = true
		prizes = append(prizes, model.RechargeLotteryPrize{AmountUsd: item.AmountUsd, Weight: item.Weight, Rarity: item.Rarity})
	}
	now := common.GetTimestamp()
	campaign, err := model.CreateRechargeLotteryCampaign(model.RechargeLotteryCampaign{
		Id: uuid.NewString(), Name: name, Status: model.RechargeLotteryCampaignDraft,
		StartsAt: input.StartsAt, EndsAt: input.EndsAt, RulesVersion: 1,
		OperatorUserId: operatorUserId, CreatedAt: now,
	}, prizes)
	if err != nil {
		return nil, err
	}
	stats, err := model.GetRechargeLotteryCampaignStats(campaign.Id)
	if err != nil {
		return nil, err
	}
	payload := &RechargeLotteryAdminCampaignPayload{
		RechargeLotteryCampaignPayload: rechargeLotteryCampaignPayload(*campaign, now),
		Status:                         campaign.Status, SimulationCount: campaign.SimulationCount,
		CreatedAt: campaign.CreatedAt, PublishedAt: campaign.PublishedAt,
		EndedAt: campaign.EndedAt, Stats: stats,
	}
	return payload, nil
}

func PublishRechargeLotteryCampaign(id string) (*RechargeLotteryAdminCampaignPayload, error) {
	now := common.GetTimestamp()
	ok, err := model.PublishRechargeLotteryCampaign(id, now)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, rechargeLotteryError(http.StatusConflict, "活动无法发布")
	}
	campaign, err := model.GetRechargeLotteryCampaign(id)
	if err != nil {
		return nil, err
	}
	stats, err := model.GetRechargeLotteryCampaignStats(id)
	if err != nil {
		return nil, err
	}
	return &RechargeLotteryAdminCampaignPayload{
		RechargeLotteryCampaignPayload: rechargeLotteryCampaignPayload(*campaign, now),
		Status:                         campaign.Status, SimulationCount: campaign.SimulationCount,
		CreatedAt: campaign.CreatedAt, PublishedAt: campaign.PublishedAt,
		EndedAt: campaign.EndedAt, Stats: stats,
	}, nil
}

func EndRechargeLotteryCampaign(id string) error {
	ok, err := model.EndRechargeLotteryCampaign(id, common.GetTimestamp())
	if err != nil {
		return err
	}
	if !ok {
		return rechargeLotteryError(http.StatusConflict, "活动无法结束")
	}
	return nil
}

func CancelRechargeLotteryCampaign(id string) error {
	ok, err := model.CancelRechargeLotteryCampaign(id, common.GetTimestamp())
	if err != nil {
		return err
	}
	if !ok {
		return rechargeLotteryError(http.StatusConflict, "仅草稿活动可以取消")
	}
	return nil
}

func CreateRechargeLotteryGrantBatch(input RechargeLotteryGrantInput) (*RechargeLotteryGrantBatchPayload, bool, error) {
	if !rechargeLotteryRequestKeyPattern.MatchString(strings.TrimSpace(input.RequestKey)) {
		return nil, false, rechargeLotteryError(http.StatusBadRequest, "请求号格式无效")
	}
	if input.Quantity <= 0 || input.Quantity > 100_000 {
		return nil, false, rechargeLotteryError(http.StatusBadRequest, "发放次数无效")
	}
	campaign, err := model.GetRechargeLotteryCampaign(strings.TrimSpace(input.CampaignId))
	if err != nil || (campaign.Status != model.RechargeLotteryCampaignDraft && campaign.Status != model.RechargeLotteryCampaignPublished) {
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, err
		}
		return nil, false, rechargeLotteryError(http.StatusConflict, "活动不可发放抽奖次数")
	}
	unique := make(map[int]bool, len(input.UserIds))
	requested := make([]int, 0, len(input.UserIds))
	for _, userId := range input.UserIds {
		if userId > 0 && !unique[userId] {
			unique[userId] = true
			requested = append(requested, userId)
		}
	}
	if input.Kind != "all" && (len(requested) == 0 || len(requested) > 10_000) {
		return nil, false, rechargeLotteryError(http.StatusBadRequest, "用户列表需要包含 1-10000 个有效用户 ID")
	}
	if input.Kind != "manual" && input.Kind != "all" && input.Kind != "revoke" {
		return nil, false, rechargeLotteryError(http.StatusBadRequest, "发放类型无效")
	}
	lookup := requested
	if input.Kind == "all" {
		lookup = nil
	}
	recipients, err := model.ListEligibleRechargeLotteryUserIds(lookup)
	if err != nil {
		return nil, false, err
	}
	if len(recipients) == 0 {
		return nil, false, rechargeLotteryError(http.StatusConflict, "没有符合条件的启用普通用户")
	}
	note, err := normalizeRechargeLotteryText(input.Note, "备注", 1, 120)
	if err != nil {
		return nil, false, err
	}
	recipientsJson, err := common.Marshal(recipients)
	if err != nil {
		return nil, false, err
	}
	batch, created, err := model.CreateRechargeLotteryGrantBatch(model.RechargeLotteryGrantBatch{
		Id: uuid.NewString(), RequestKey: strings.TrimSpace(input.RequestKey),
		CampaignId: campaign.Id, Kind: input.Kind, QuantityPerUser: input.Quantity,
		RecipientsJson: string(recipientsJson), SkipPreviouslyGranted: input.SkipPreviouslyGranted,
		Status: model.RechargeLotteryBatchQueued, Note: note,
		OperatorUserId: input.OperatorUserId, CreatedAt: common.GetTimestamp(),
	})
	if err != nil {
		return nil, false, err
	}
	payload := &RechargeLotteryGrantBatchPayload{
		Id: batch.Id, CampaignId: batch.CampaignId, Kind: batch.Kind,
		Quantity: batch.QuantityPerUser, Status: batch.Status,
		RecipientCount: batch.RecipientCount, ProcessedCount: batch.ProcessedCount,
		Note: batch.Note, ErrorMessage: batch.ErrorMessage, CreatedAt: batch.CreatedAt,
	}
	return payload, created, nil
}

func RetryRechargeLotteryFulfillment(id string) error {
	now := common.GetTimestamp()
	if err := model.RetryRechargeLotteryFulfillment(id, now); err != nil {
		return err
	}
	_, err := model.FulfillRechargeLotteryDraw(id)
	return err
}

func RunRechargeLotteryMaintenance() {
	now := common.GetTimestamp()
	batches, err := model.ListOpenRechargeLotteryGrantBatches(5)
	if err != nil {
		common.SysError("list recharge lottery grant batches: " + err.Error())
	} else {
		for _, batch := range batches {
			if err := model.ProcessRechargeLotteryGrantBatch(batch.Id, now); err != nil {
				_ = model.FailRechargeLotteryGrantBatch(batch.Id, err.Error(), common.GetTimestamp())
				common.SysError(fmt.Sprintf("process recharge lottery grant batch %s: %v", batch.Id, err))
			}
		}
	}
	draws, err := model.ListDueRechargeLotteryFulfillments(now, 5)
	if err != nil {
		common.SysError("list recharge lottery fulfillments: " + err.Error())
		return
	}
	for _, draw := range draws {
		if _, err := model.FulfillRechargeLotteryDraw(draw.Id); err != nil {
			common.SysError(fmt.Sprintf("fulfill recharge lottery draw %s: %v", draw.Id, err))
		}
	}
}

func StartRechargeLotteryMaintenanceTask() {
	rechargeLotteryMaintenanceOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		go func() {
			RunRechargeLotteryMaintenance()
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				RunRechargeLotteryMaintenance()
			}
		}()
	})
}

func CountEligibleRechargeLotteryUsers() (int64, error) {
	return model.CountEligibleRechargeLotteryUsers()
}
