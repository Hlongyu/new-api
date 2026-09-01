package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	RechargeLotteryPermanentCampaignId = "permanent-red-moon"
	RechargeLotterySubscriptionDays    = 7
	RechargeLotteryQuotaThresholdUsd   = 100

	RechargeLotteryCampaignDraft     = "draft"
	RechargeLotteryCampaignPublished = "published"
	RechargeLotteryCampaignEnded     = "ended"
	RechargeLotteryCampaignCancelled = "cancelled"

	RechargeLotteryBatchQueued     = "queued"
	RechargeLotteryBatchProcessing = "processing"
	RechargeLotteryBatchCompleted  = "completed"
	RechargeLotteryBatchFailed     = "failed"
	RechargeLotteryBatchCancelled  = "cancelled"

	RechargeLotteryDrawPending    = "pending"
	RechargeLotteryDrawProcessing = "processing"
	RechargeLotteryDrawUnknown    = "unknown"
	RechargeLotteryDrawCompleted  = "completed"
	RechargeLotteryDrawFailed     = "failed"

	RechargeLotterySubscriptionSource = "lottery_reward"
)

var (
	ErrCompanionMigrationRequired         = errors.New("Companion 数据迁移尚未完成")
	ErrRechargeLotteryRequestConflict     = errors.New("抽奖请求号已被其他用户或活动池使用")
	ErrRechargeLotteryInsufficientBalance = errors.New("剩余抽奖次数不足")
	ErrRechargeLotteryCampaignUnavailable = errors.New("活动当前不可抽奖")
	ErrRechargeLotteryFulfillmentState    = errors.New("该记录当前不可重试")
)

type RechargeLotteryCampaign struct {
	Id              string `json:"id" gorm:"type:varchar(80);primaryKey"`
	Name            string `json:"name" gorm:"type:varchar(128);not null"`
	Status          string `json:"status" gorm:"type:varchar(16);index;not null"`
	StartsAt        int64  `json:"starts_at" gorm:"type:bigint;not null"`
	EndsAt          int64  `json:"ends_at" gorm:"type:bigint;not null"`
	RulesVersion    int    `json:"rules_version" gorm:"not null"`
	SimulationCount int    `json:"simulation_count" gorm:"not null"`
	OperatorUserId  int    `json:"operator_user_id" gorm:"not null"`
	CreatedAt       int64  `json:"created_at" gorm:"type:bigint;not null"`
	PublishedAt     int64  `json:"published_at" gorm:"type:bigint;not null"`
	EndedAt         int64  `json:"ended_at" gorm:"type:bigint;not null"`
	IsPermanent     bool   `json:"is_permanent" gorm:"index;not null"`
	IsDefault       bool   `json:"is_default" gorm:"index;not null"`
}

func (RechargeLotteryCampaign) TableName() string { return "lottery_campaigns" }

type RechargeLotteryPrize struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	CampaignId string `json:"campaign_id" gorm:"type:varchar(80);uniqueIndex:idx_recharge_lottery_prize_amount,priority:1;index;not null"`
	AmountUsd  int    `json:"amount_usd" gorm:"uniqueIndex:idx_recharge_lottery_prize_amount,priority:2;not null"`
	Weight     int    `json:"weight" gorm:"not null"`
	Rarity     string `json:"rarity" gorm:"type:varchar(16);not null"`
	SortOrder  int    `json:"sort_order" gorm:"not null"`
}

func (RechargeLotteryPrize) TableName() string { return "lottery_prizes" }

type RechargeLotteryGrantBatch struct {
	Id                    string `json:"id" gorm:"type:varchar(64);primaryKey"`
	RequestKey            string `json:"request_key" gorm:"type:varchar(80);uniqueIndex;not null"`
	CampaignId            string `json:"campaign_id" gorm:"type:varchar(80);index;not null"`
	Kind                  string `json:"kind" gorm:"type:varchar(16);not null"`
	QuantityPerUser       int    `json:"quantity_per_user" gorm:"not null"`
	RecipientsJson        string `json:"recipients_json" gorm:"type:text;not null"`
	SkipPreviouslyGranted bool   `json:"skip_previously_granted" gorm:"not null"`
	Status                string `json:"status" gorm:"type:varchar(16);index;not null"`
	RecipientCount        int    `json:"recipient_count" gorm:"not null"`
	ProcessedCount        int    `json:"processed_count" gorm:"not null"`
	Note                  string `json:"note" gorm:"type:varchar(255);not null"`
	ErrorMessage          string `json:"error_message" gorm:"type:text;not null"`
	OperatorUserId        int    `json:"operator_user_id" gorm:"not null"`
	CreatedAt             int64  `json:"created_at" gorm:"type:bigint;not null"`
	CompletedAt           int64  `json:"completed_at" gorm:"type:bigint;not null"`
}

func (RechargeLotteryGrantBatch) TableName() string { return "lottery_grant_batches" }

type RechargeLotteryLedger struct {
	Id             string  `json:"id" gorm:"type:varchar(128);primaryKey"`
	CampaignId     string  `json:"campaign_id" gorm:"type:varchar(80);index:idx_recharge_lottery_balance,priority:1;not null"`
	BatchId        *string `json:"batch_id" gorm:"type:varchar(64);index"`
	UserId         int     `json:"user_id" gorm:"index:idx_recharge_lottery_balance,priority:2;index;not null"`
	Kind           string  `json:"kind" gorm:"type:varchar(16);not null"`
	Delta          int     `json:"delta" gorm:"not null"`
	ReferenceId    string  `json:"reference_id" gorm:"type:varchar(128);index;not null"`
	Note           string  `json:"note" gorm:"type:varchar(255);not null"`
	OperatorUserId int     `json:"operator_user_id" gorm:"not null"`
	CreatedAt      int64   `json:"created_at" gorm:"type:bigint;index;not null"`
}

func (RechargeLotteryLedger) TableName() string { return "lottery_ledger" }

type RechargeLotteryDrawBatch struct {
	Id                       string                    `json:"id" gorm:"type:varchar(64);primaryKey"`
	RequestKey               string                    `json:"request_key" gorm:"type:varchar(80);uniqueIndex;not null"`
	CampaignId               string                    `json:"campaign_id" gorm:"type:varchar(80);index;not null"`
	UserId                   int                       `json:"user_id" gorm:"index:idx_recharge_lottery_user_draws,priority:1;not null"`
	DrawCount                int                       `json:"draw_count" gorm:"not null"`
	TotalAmountUsd           int                       `json:"total_amount_usd" gorm:"not null"`
	TotalQuota               int64                     `json:"total_quota" gorm:"not null"`
	Status                   string                    `json:"status" gorm:"type:varchar(16);index:idx_recharge_lottery_fulfillment,priority:1;not null"`
	PlanId                   int                       `json:"plan_id" gorm:"not null"`
	ExternalSubscriptionId   int                       `json:"external_subscription_id" gorm:"index;not null"`
	PreflightSubscriptionIds string                    `json:"preflight_subscription_ids" gorm:"type:text;not null"`
	AttemptCount             int                       `json:"attempt_count" gorm:"not null"`
	ErrorMessage             string                    `json:"error_message" gorm:"type:text;not null"`
	NextAttemptAt            int64                     `json:"next_attempt_at" gorm:"type:bigint;index:idx_recharge_lottery_fulfillment,priority:2;not null"`
	CreatedAt                int64                     `json:"created_at" gorm:"type:bigint;index:idx_recharge_lottery_user_draws,priority:2;not null"`
	UpdatedAt                int64                     `json:"updated_at" gorm:"type:bigint;not null"`
	CompletedAt              int64                     `json:"completed_at" gorm:"type:bigint;not null"`
	Items                    []RechargeLotteryDrawItem `json:"items" gorm:"-"`
}

func (RechargeLotteryDrawBatch) TableName() string { return "lottery_draw_batches" }

type RechargeLotteryDrawItem struct {
	Id          string `json:"id" gorm:"type:varchar(64);primaryKey"`
	DrawBatchId string `json:"draw_batch_id" gorm:"type:varchar(64);uniqueIndex:idx_recharge_lottery_draw_ordinal,priority:1;index;not null"`
	Ordinal     int    `json:"ordinal" gorm:"uniqueIndex:idx_recharge_lottery_draw_ordinal,priority:2;not null"`
	PrizeId     int    `json:"prize_id" gorm:"index;not null"`
	AmountUsd   int    `json:"amount_usd" gorm:"not null"`
	QuotaAmount int64  `json:"quota_amount" gorm:"not null"`
	Rarity      string `json:"rarity" gorm:"type:varchar(16);not null"`
	RandomValue string `json:"random_value" gorm:"type:varchar(64);not null"`
}

func (RechargeLotteryDrawItem) TableName() string { return "lottery_draw_items" }

type RechargeLotteryPlanMapping struct {
	QuotaAmount  int64  `json:"quota_amount" gorm:"primaryKey"`
	DurationDays int    `json:"duration_days" gorm:"primaryKey"`
	AmountUsd    int    `json:"amount_usd" gorm:"not null"`
	PlanId       int    `json:"plan_id" gorm:"index;not null"`
	PlanTitle    string `json:"plan_title" gorm:"type:varchar(128);not null"`
	VerifiedAt   int64  `json:"verified_at" gorm:"type:bigint;not null"`
	CreatedAt    int64  `json:"created_at" gorm:"type:bigint;not null"`
}

func (RechargeLotteryPlanMapping) TableName() string { return "lottery_plan_mappings" }

type RechargeLotteryRedemptionProgress struct {
	UserId          int    `json:"user_id" gorm:"primaryKey"`
	CampaignId      string `json:"campaign_id" gorm:"type:varchar(80);index;not null"`
	ObservedQuota   int64  `json:"observed_quota" gorm:"not null"`
	RedemptionCount int    `json:"redemption_count" gorm:"not null"`
	GrantedDraws    int    `json:"granted_draws" gorm:"not null"`
	UpdatedAt       int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

func (RechargeLotteryRedemptionProgress) TableName() string {
	return "lottery_redemption_progress"
}

type RechargeLotteryCampaignWithPrizes struct {
	RechargeLotteryCampaign
	Prizes []RechargeLotteryPrize
}

type RechargeLotteryCampaignStats struct {
	CoveredUsers      int64 `json:"covered_users"`
	Granted           int64 `json:"granted"`
	Used              int64 `json:"used"`
	Remaining         int64 `json:"remaining"`
	DrawBatches       int64 `json:"draw_batches"`
	DrawItems         int64 `json:"draw_items"`
	ActualAmountUsd   int64 `json:"actual_amount_usd"`
	Fulfilled         int64 `json:"fulfilled"`
	FulfillmentIssues int64 `json:"fulfillment_issues"`
}

type RechargeLotteryRedemptionStats struct {
	UserCount       int64 `json:"user_count"`
	ObservedQuota   int64 `json:"observed_quota"`
	RedemptionCount int64 `json:"redemption_count"`
	GrantedDraws    int64 `json:"granted_draws"`
	UpdatedAt       int64 `json:"updated_at"`
}

type RechargeLotteryRedemptionAggregate struct {
	UserId          int   `gorm:"column:user_id"`
	ObservedQuota   int64 `gorm:"column:observed_quota"`
	RedemptionCount int64 `gorm:"column:redemption_count"`
}

func rechargeLotteryDefaultPrizes() []RechargeLotteryPrize {
	return []RechargeLotteryPrize{
		{AmountUsd: 1, Weight: 60, Rarity: "common", SortOrder: 0},
		{AmountUsd: 2, Weight: 25, Rarity: "rare", SortOrder: 1},
		{AmountUsd: 5, Weight: 10, Rarity: "epic", SortOrder: 2},
		{AmountUsd: 10, Weight: 4, Rarity: "epic", SortOrder: 3},
		{AmountUsd: 20, Weight: 1, Rarity: "legendary", SortOrder: 4},
	}
}

func EnsureRechargeLotteryDefaultCampaign() (*RechargeLotteryCampaignWithPrizes, error) {
	var campaign *RechargeLotteryCampaignWithPrizes
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		campaign, err = ensureRechargeLotteryDefaultCampaignTx(tx, common.GetTimestamp())
		return err
	})
	return campaign, err
}

func ensureRechargeLotteryDefaultCampaignTx(tx *gorm.DB, now int64) (*RechargeLotteryCampaignWithPrizes, error) {
	if tx == nil {
		return nil, errors.New("tx is nil")
	}
	if common.LeaderboardMigrationRequired {
		var count int64
		if err := tx.Model(&CompanionMigration{}).Count(&count).Error; err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, ErrCompanionMigrationRequired
		}
	}

	var existing RechargeLotteryCampaign
	result := tx.Where("is_default = ?", true).Order("created_at desc").First(&existing)
	if result.Error == nil {
		return getRechargeLotteryCampaignTx(tx, existing.Id)
	}
	if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, result.Error
	}

	campaign := RechargeLotteryCampaign{
		Id: RechargeLotteryPermanentCampaignId, Name: "赤月回响",
		Status: RechargeLotteryCampaignPublished, StartsAt: 1, EndsAt: 4_102_444_800,
		RulesVersion: 1, OperatorUserId: 0, CreatedAt: now, PublishedAt: now,
		IsPermanent: true, IsDefault: true,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&campaign).Error; err != nil {
		return nil, err
	}
	var prizeCount int64
	if err := tx.Model(&RechargeLotteryPrize{}).Where("campaign_id = ?", campaign.Id).Count(&prizeCount).Error; err != nil {
		return nil, err
	}
	if prizeCount == 0 {
		prizes := rechargeLotteryDefaultPrizes()
		for index := range prizes {
			prizes[index].CampaignId = campaign.Id
		}
		if err := tx.Create(&prizes).Error; err != nil {
			return nil, err
		}
	}
	return getRechargeLotteryCampaignTx(tx, campaign.Id)
}

func getRechargeLotteryCampaignTx(tx *gorm.DB, id string) (*RechargeLotteryCampaignWithPrizes, error) {
	var campaign RechargeLotteryCampaign
	if err := tx.Where("id = ?", id).First(&campaign).Error; err != nil {
		return nil, err
	}
	var prizes []RechargeLotteryPrize
	if err := tx.Where("campaign_id = ?", id).Order("sort_order asc, id asc").Find(&prizes).Error; err != nil {
		return nil, err
	}
	return &RechargeLotteryCampaignWithPrizes{RechargeLotteryCampaign: campaign, Prizes: prizes}, nil
}

func GetRechargeLotteryCampaign(id string) (*RechargeLotteryCampaignWithPrizes, error) {
	return getRechargeLotteryCampaignTx(DB, id)
}

func GetDefaultRechargeLotteryCampaign() (*RechargeLotteryCampaignWithPrizes, error) {
	var campaign RechargeLotteryCampaign
	if err := DB.Where("is_default = ?", true).Order("created_at desc").First(&campaign).Error; err != nil {
		return nil, err
	}
	return GetRechargeLotteryCampaign(campaign.Id)
}

func ListRechargeLotteryCampaigns(publishedOnly bool) ([]RechargeLotteryCampaignWithPrizes, error) {
	query := DB.Order("is_default desc, created_at desc, id desc")
	if publishedOnly {
		query = query.Where("status = ?", RechargeLotteryCampaignPublished)
	}
	var campaigns []RechargeLotteryCampaign
	if err := query.Find(&campaigns).Error; err != nil {
		return nil, err
	}
	result := make([]RechargeLotteryCampaignWithPrizes, 0, len(campaigns))
	for _, campaign := range campaigns {
		item, err := GetRechargeLotteryCampaign(campaign.Id)
		if err != nil {
			return nil, err
		}
		result = append(result, *item)
	}
	return result, nil
}

func CreateRechargeLotteryCampaign(campaign RechargeLotteryCampaign, prizes []RechargeLotteryPrize) (*RechargeLotteryCampaignWithPrizes, error) {
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&campaign).Error; err != nil {
			return err
		}
		for index := range prizes {
			prizes[index].CampaignId = campaign.Id
			prizes[index].SortOrder = index
		}
		return tx.Create(&prizes).Error
	})
	if err != nil {
		return nil, err
	}
	return GetRechargeLotteryCampaign(campaign.Id)
}

func EndExpiredRechargeLotteryCampaigns(now int64) error {
	return DB.Model(&RechargeLotteryCampaign{}).
		Where("status = ? AND is_permanent = ? AND ends_at <= ?", RechargeLotteryCampaignPublished, false, now).
		Updates(map[string]interface{}{"status": RechargeLotteryCampaignEnded, "ended_at": now}).Error
}

func PublishRechargeLotteryCampaign(id string, now int64) (bool, error) {
	result := DB.Model(&RechargeLotteryCampaign{}).
		Where("id = ? AND status = ? AND ends_at > ?", id, RechargeLotteryCampaignDraft, now).
		Updates(map[string]interface{}{"status": RechargeLotteryCampaignPublished, "published_at": now})
	return result.RowsAffected > 0, result.Error
}

func EndRechargeLotteryCampaign(id string, now int64) (bool, error) {
	result := DB.Model(&RechargeLotteryCampaign{}).
		Where("id = ? AND status = ? AND is_permanent = ?", id, RechargeLotteryCampaignPublished, false).
		Updates(map[string]interface{}{"status": RechargeLotteryCampaignEnded, "ended_at": now})
	return result.RowsAffected > 0, result.Error
}

func CancelRechargeLotteryCampaign(id string, now int64) (bool, error) {
	result := DB.Model(&RechargeLotteryCampaign{}).
		Where("id = ? AND status = ? AND is_permanent = ?", id, RechargeLotteryCampaignDraft, false).
		Updates(map[string]interface{}{"status": RechargeLotteryCampaignCancelled, "ended_at": now})
	return result.RowsAffected > 0, result.Error
}

func GetRechargeLotteryBalance(campaignId string, userId int) (int64, error) {
	return getRechargeLotteryBalanceTx(DB, campaignId, userId)
}

func getRechargeLotteryBalanceTx(tx *gorm.DB, campaignId string, userId int) (int64, error) {
	var row struct{ Balance int64 }
	err := tx.Model(&RechargeLotteryLedger{}).
		Select("COALESCE(SUM(delta), 0) AS balance").
		Where("campaign_id = ? AND user_id = ?", campaignId, userId).
		Scan(&row).Error
	return row.Balance, err
}

func ListRechargeLotteryUserDraws(userId int, campaignId string, limit, offset int) ([]RechargeLotteryDrawBatch, error) {
	var draws []RechargeLotteryDrawBatch
	err := DB.Where("user_id = ? AND campaign_id = ?", userId, campaignId).
		Order("created_at desc").Limit(limit).Offset(offset).Find(&draws).Error
	if err != nil {
		return nil, err
	}
	return hydrateRechargeLotteryDraws(DB, draws)
}

func GetRechargeLotteryDrawByRequestKey(requestKey string) (*RechargeLotteryDrawBatch, error) {
	var draw RechargeLotteryDrawBatch
	if err := DB.Where("request_key = ?", requestKey).First(&draw).Error; err != nil {
		return nil, err
	}
	items, err := hydrateRechargeLotteryDraws(DB, []RechargeLotteryDrawBatch{draw})
	if err != nil {
		return nil, err
	}
	return &items[0], nil
}

func GetRechargeLotteryDraw(id string) (*RechargeLotteryDrawBatch, error) {
	var draw RechargeLotteryDrawBatch
	if err := DB.Where("id = ?", id).First(&draw).Error; err != nil {
		return nil, err
	}
	items, err := hydrateRechargeLotteryDraws(DB, []RechargeLotteryDrawBatch{draw})
	if err != nil {
		return nil, err
	}
	return &items[0], nil
}

func hydrateRechargeLotteryDraws(tx *gorm.DB, draws []RechargeLotteryDrawBatch) ([]RechargeLotteryDrawBatch, error) {
	for index := range draws {
		if err := tx.Where("draw_batch_id = ?", draws[index].Id).
			Order("ordinal asc").Find(&draws[index].Items).Error; err != nil {
			return nil, err
		}
	}
	return draws, nil
}

func CreateRechargeLotteryDraw(
	draw RechargeLotteryDrawBatch,
	items []RechargeLotteryDrawItem,
) (*RechargeLotteryDrawBatch, bool, error) {
	created := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", draw.UserId).First(&user).Error; err != nil {
			return err
		}
		var existing RechargeLotteryDrawBatch
		result := tx.Where("request_key = ?", draw.RequestKey).First(&existing)
		if result.Error == nil {
			if existing.UserId != draw.UserId || existing.CampaignId != draw.CampaignId {
				return ErrRechargeLotteryRequestConflict
			}
			draw = existing
			return nil
		}
		if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return result.Error
		}

		var campaign RechargeLotteryCampaign
		if err := tx.Where("id = ?", draw.CampaignId).First(&campaign).Error; err != nil {
			return err
		}
		if campaign.Status != RechargeLotteryCampaignPublished || draw.CreatedAt < campaign.StartsAt || draw.CreatedAt >= campaign.EndsAt {
			return ErrRechargeLotteryCampaignUnavailable
		}
		balance, err := getRechargeLotteryBalanceTx(tx, draw.CampaignId, draw.UserId)
		if err != nil {
			return err
		}
		if balance < int64(draw.DrawCount) {
			return ErrRechargeLotteryInsufficientBalance
		}

		draw.Status = RechargeLotteryDrawProcessing
		draw.AttemptCount = 1
		draw.UpdatedAt = draw.CreatedAt
		draw.NextAttemptAt = draw.CreatedAt
		if err := tx.Create(&draw).Error; err != nil {
			message := strings.ToLower(err.Error())
			if strings.Contains(message, "request_key") &&
				(strings.Contains(message, "unique") || strings.Contains(message, "duplicate")) {
				return ErrRechargeLotteryRequestConflict
			}
			return err
		}
		for index := range items {
			items[index].DrawBatchId = draw.Id
			items[index].Ordinal = index + 1
		}
		if err := tx.Create(&items).Error; err != nil {
			return err
		}
		ledger := RechargeLotteryLedger{
			Id: "draw:" + draw.Id, CampaignId: draw.CampaignId, UserId: draw.UserId,
			Kind: "draw", Delta: -draw.DrawCount, ReferenceId: draw.Id,
			Note: fmt.Sprintf("%d 抽", draw.DrawCount), CreatedAt: draw.CreatedAt,
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}

		subscription, err := createRechargeLotterySubscriptionTx(tx, &draw, draw.CreatedAt)
		if err != nil {
			return err
		}
		draw.Status = RechargeLotteryDrawCompleted
		draw.ExternalSubscriptionId = subscription.Id
		draw.ErrorMessage = ""
		draw.NextAttemptAt = 0
		draw.UpdatedAt = subscription.CreatedAt
		draw.CompletedAt = subscription.CreatedAt
		if err := tx.Model(&RechargeLotteryDrawBatch{}).Where("id = ?", draw.Id).Updates(map[string]interface{}{
			"status": draw.Status, "external_subscription_id": draw.ExternalSubscriptionId,
			"error_message": "", "next_attempt_at": int64(0),
			"updated_at": draw.UpdatedAt, "completed_at": draw.CompletedAt,
		}).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	result, err := GetRechargeLotteryDraw(draw.Id)
	return result, created, err
}

func createRechargeLotterySubscriptionTx(tx *gorm.DB, draw *RechargeLotteryDrawBatch, now int64) (*UserSubscription, error) {
	if draw == nil || draw.UserId <= 0 || draw.TotalQuota <= 0 {
		return nil, errors.New("invalid lottery reward")
	}
	var existing UserSubscription
	note := "recharge_lottery_draw:" + draw.Id
	result := tx.Where("source = ? AND admin_note = ?", RechargeLotterySubscriptionSource, note).First(&existing)
	if result.Error == nil {
		return &existing, nil
	}
	if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, result.Error
	}
	subscription := &UserSubscription{
		UserId: draw.UserId, PlanId: 0, AmountTotal: draw.TotalQuota,
		AmountUsed: 0, StartTime: now,
		EndTime: now + RechargeLotterySubscriptionDays*86_400,
		Status:  "active", Source: RechargeLotterySubscriptionSource,
		Title: "深夜宝库 7 天奖励订阅", PriceAmount: 0, Currency: "USD",
		AllowWalletOverflow: true, GrantedBy: 0, AdminNote: note,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := tx.Create(subscription).Error; err != nil {
		return nil, err
	}
	return subscription, nil
}

func ListDueRechargeLotteryFulfillments(now int64, limit int) ([]RechargeLotteryDrawBatch, error) {
	var draws []RechargeLotteryDrawBatch
	err := DB.Where("status IN ? AND next_attempt_at <= ?", []string{RechargeLotteryDrawPending, RechargeLotteryDrawUnknown}, now).
		Order("created_at asc").Limit(limit).Find(&draws).Error
	if err != nil {
		return nil, err
	}
	return hydrateRechargeLotteryDraws(DB, draws)
}

func ListRechargeLotteryFulfillmentIssues(limit int) ([]RechargeLotteryDrawBatch, error) {
	var draws []RechargeLotteryDrawBatch
	err := DB.Where("status IN ?", []string{RechargeLotteryDrawUnknown, RechargeLotteryDrawFailed}).
		Order("updated_at desc").Limit(limit).Find(&draws).Error
	if err != nil {
		return nil, err
	}
	return hydrateRechargeLotteryDraws(DB, draws)
}

func FulfillRechargeLotteryDraw(id string) (*RechargeLotteryDrawBatch, error) {
	err := DB.Transaction(func(tx *gorm.DB) error {
		var draw RechargeLotteryDrawBatch
		if err := lockForUpdate(tx).Where("id = ?", id).First(&draw).Error; err != nil {
			return err
		}
		if draw.Status == RechargeLotteryDrawCompleted {
			return nil
		}
		if draw.Status != RechargeLotteryDrawPending && draw.Status != RechargeLotteryDrawUnknown && draw.Status != RechargeLotteryDrawProcessing {
			return ErrRechargeLotteryFulfillmentState
		}
		now := GetDBTimestamp()
		var subscription UserSubscription
		if draw.ExternalSubscriptionId > 0 {
			result := tx.Where("id = ? AND user_id = ?", draw.ExternalSubscriptionId, draw.UserId).First(&subscription)
			if result.Error == nil {
				return finishRechargeLotteryFulfillmentTx(tx, &draw, subscription.Id, now)
			}
			if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
				return result.Error
			}
		}
		if draw.PlanId > 0 {
			query := tx.Where("user_id = ? AND plan_id = ? AND start_time >= ?", draw.UserId, draw.PlanId, draw.CreatedAt-5)
			var beforeIds []int
			if strings.TrimSpace(draw.PreflightSubscriptionIds) != "" {
				if err := common.UnmarshalJsonStr(draw.PreflightSubscriptionIds, &beforeIds); err != nil {
					beforeIds = nil
				}
			}
			if len(beforeIds) > 0 {
				query = query.Not(beforeIds)
			}
			result := query.Order("id asc").First(&subscription)
			if result.Error == nil {
				return finishRechargeLotteryFulfillmentTx(tx, &draw, subscription.Id, now)
			}
			if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
				return result.Error
			}
		}
		subscriptionPtr, err := createRechargeLotterySubscriptionTx(tx, &draw, now)
		if err != nil {
			return err
		}
		return finishRechargeLotteryFulfillmentTx(tx, &draw, subscriptionPtr.Id, now)
	})
	if err != nil {
		return nil, err
	}
	return GetRechargeLotteryDraw(id)
}

func finishRechargeLotteryFulfillmentTx(tx *gorm.DB, draw *RechargeLotteryDrawBatch, subscriptionId int, now int64) error {
	return tx.Model(&RechargeLotteryDrawBatch{}).Where("id = ?", draw.Id).Updates(map[string]interface{}{
		"status": RechargeLotteryDrawCompleted, "external_subscription_id": subscriptionId,
		"error_message": "", "next_attempt_at": int64(0), "updated_at": now, "completed_at": now,
	}).Error
}

func RetryRechargeLotteryFulfillment(id string, now int64) error {
	result := DB.Model(&RechargeLotteryDrawBatch{}).
		Where("id = ? AND status IN ?", id, []string{RechargeLotteryDrawUnknown, RechargeLotteryDrawFailed}).
		Updates(map[string]interface{}{
			"status": RechargeLotteryDrawPending, "error_message": "",
			"next_attempt_at": now, "updated_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrRechargeLotteryFulfillmentState
	}
	return nil
}

func GetRechargeLotteryRedemptionProgress(userId int) (*RechargeLotteryRedemptionProgress, error) {
	var progress RechargeLotteryRedemptionProgress
	err := DB.Where("user_id = ?", userId).First(&progress).Error
	return &progress, err
}

func GetRechargeLotteryRedemptionStats() (RechargeLotteryRedemptionStats, error) {
	var stats RechargeLotteryRedemptionStats
	err := DB.Model(&RechargeLotteryRedemptionProgress{}).Select(
		"COUNT(*) AS user_count, COALESCE(SUM(observed_quota), 0) AS observed_quota, " +
			"COALESCE(SUM(redemption_count), 0) AS redemption_count, COALESCE(SUM(granted_draws), 0) AS granted_draws, " +
			"COALESCE(MAX(updated_at), 0) AS updated_at",
	).Scan(&stats).Error
	return stats, err
}

func ListRedeemedQuotaAggregates() ([]RechargeLotteryRedemptionAggregate, error) {
	var rows []RechargeLotteryRedemptionAggregate
	err := DB.Model(&Redemption{}).
		Select("used_user_id AS user_id, COALESCE(SUM(quota), 0) AS observed_quota, COUNT(*) AS redemption_count").
		Where("status = ? AND used_user_id > 0 AND quota > 0", common.RedemptionCodeStatusUsed).
		Group("used_user_id").Order("used_user_id asc").Scan(&rows).Error
	return rows, err
}

func SyncRechargeLotteryRedemptionProgress(userId int, observedQuota int64, redemptionCount int, now int64) (int, error) {
	added := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		campaign, err := ensureRechargeLotteryDefaultCampaignTx(tx, now)
		if err != nil {
			return err
		}
		added, err = syncRechargeLotteryRedemptionProgressTx(tx, campaign.Id, userId, observedQuota, redemptionCount, now)
		return err
	})
	return added, err
}

func ApplyRechargeLotteryRedemptionTx(tx *gorm.DB, userId, quota, redemptionId int, now int64) error {
	if quota <= 0 {
		return nil
	}
	// Narrow model tests and upgrades from older binaries may execute Redeem
	// before the lottery tables exist. Production startup migrates these tables
	// before accepting traffic, so absence means this optional side effect is
	// not available yet rather than that the wallet redemption should fail.
	if !tx.Migrator().HasTable(&RechargeLotteryCampaign{}) {
		return nil
	}
	campaign, err := ensureRechargeLotteryDefaultCampaignTx(tx, now)
	if err != nil {
		return err
	}
	var user User
	if err := lockForUpdate(tx).Select("id").Where("id = ?", userId).First(&user).Error; err != nil {
		return err
	}
	var progress RechargeLotteryRedemptionProgress
	result := lockForUpdate(tx).Where("user_id = ?", userId).First(&progress)
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return result.Error
	}
	observedQuota := int64(quota)
	redemptionCount := 1
	if result.Error == nil {
		observedQuota += progress.ObservedQuota
		redemptionCount += progress.RedemptionCount
	}
	_, err = syncRechargeLotteryRedemptionProgressTx(tx, campaign.Id, userId, observedQuota, redemptionCount, now)
	if err != nil {
		return fmt.Errorf("apply lottery reward for redemption %d: %w", redemptionId, err)
	}
	return nil
}

func syncRechargeLotteryRedemptionProgressTx(
	tx *gorm.DB,
	campaignId string,
	userId int,
	observedQuota int64,
	redemptionCount int,
	now int64,
) (int, error) {
	if common.QuotaPerUnit <= 0 {
		return 0, errors.New("invalid quota per unit")
	}
	threshold, err := common.QuotaFromFloatStrict(float64(RechargeLotteryQuotaThresholdUsd) * common.QuotaPerUnit)
	if err != nil {
		return 0, err
	}
	var previous RechargeLotteryRedemptionProgress
	result := lockForUpdate(tx).Where("user_id = ?", userId).First(&previous)
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return 0, result.Error
	}
	grantedDraws := 0
	if result.Error == nil {
		grantedDraws = previous.GrantedDraws
	}
	eligibleDraws := int(observedQuota / int64(threshold))
	addedDraws := max(0, eligibleDraws-grantedDraws)
	nextGrantedDraws := grantedDraws + addedDraws
	if addedDraws > 0 {
		ledger := RechargeLotteryLedger{
			Id:         fmt.Sprintf("redemption:%d:%d", userId, nextGrantedDraws),
			CampaignId: campaignId, UserId: userId, Kind: "grant", Delta: addedDraws,
			ReferenceId: fmt.Sprintf("redemption:%d:%d", userId, nextGrantedDraws),
			Note:        fmt.Sprintf("兑换额度累计满额自动发放 %d 次", addedDraws), CreatedAt: now,
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return 0, err
		}
	}
	progress := RechargeLotteryRedemptionProgress{
		UserId: userId, CampaignId: campaignId, ObservedQuota: observedQuota,
		RedemptionCount: redemptionCount, GrantedDraws: nextGrantedDraws, UpdatedAt: now,
	}
	if err := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"campaign_id", "observed_quota", "redemption_count", "granted_draws", "updated_at"}),
	}).Create(&progress).Error; err != nil {
		return 0, err
	}
	return addedDraws, nil
}

func ListEligibleRechargeLotteryUserIds(requested []int) ([]int, error) {
	query := DB.Model(&User{}).Select("id").Where("status = ? AND role < ?", common.UserStatusEnabled, common.RoleRootUser)
	if len(requested) > 0 {
		query = query.Where("id IN ?", requested)
	}
	var ids []int
	if err := query.Order("id asc").Scan(&ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func CountEligibleRechargeLotteryUsers() (int64, error) {
	var count int64
	err := DB.Model(&User{}).Where("status = ? AND role < ?", common.UserStatusEnabled, common.RoleRootUser).Count(&count).Error
	return count, err
}

func CreateRechargeLotteryGrantBatch(batch RechargeLotteryGrantBatch) (*RechargeLotteryGrantBatch, bool, error) {
	var existing RechargeLotteryGrantBatch
	result := DB.Where("request_key = ?", batch.RequestKey).First(&existing)
	if result.Error == nil {
		if existing.CampaignId != batch.CampaignId || existing.OperatorUserId != batch.OperatorUserId {
			return nil, false, ErrRechargeLotteryRequestConflict
		}
		return &existing, false, nil
	}
	if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, false, result.Error
	}
	if err := DB.Create(&batch).Error; err != nil {
		return nil, false, err
	}
	return &batch, true, nil
}

func ListRechargeLotteryGrantBatches(limit int) ([]RechargeLotteryGrantBatch, error) {
	var batches []RechargeLotteryGrantBatch
	err := DB.Order("created_at desc").Limit(limit).Find(&batches).Error
	return batches, err
}

func ListOpenRechargeLotteryGrantBatches(limit int) ([]RechargeLotteryGrantBatch, error) {
	var batches []RechargeLotteryGrantBatch
	err := DB.Where("status IN ?", []string{RechargeLotteryBatchQueued, RechargeLotteryBatchProcessing}).
		Order("created_at asc").Limit(limit).Find(&batches).Error
	return batches, err
}

func ProcessRechargeLotteryGrantBatch(id string, now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var batch RechargeLotteryGrantBatch
		if err := lockForUpdate(tx).Where("id = ?", id).First(&batch).Error; err != nil {
			return err
		}
		if batch.Status == RechargeLotteryBatchCompleted || batch.Status == RechargeLotteryBatchCancelled {
			return nil
		}
		if batch.Status != RechargeLotteryBatchQueued && batch.Status != RechargeLotteryBatchProcessing {
			return errors.New("grant batch is not processable")
		}
		var recipients []int
		if err := common.UnmarshalJsonStr(batch.RecipientsJson, &recipients); err != nil {
			return err
		}
		sort.Ints(recipients)
		for _, userId := range recipients {
			var user User
			if err := lockForUpdate(tx).Select("id").Where("id = ?", userId).First(&user).Error; err != nil {
				return err
			}
		}
		if batch.Kind == "revoke" {
			for _, userId := range recipients {
				ledgerId := fmt.Sprintf("%s:%d", batch.Id, userId)
				var count int64
				if err := tx.Model(&RechargeLotteryLedger{}).Where("id = ?", ledgerId).Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					continue
				}
				balance, err := getRechargeLotteryBalanceTx(tx, batch.CampaignId, userId)
				if err != nil {
					return err
				}
				if balance < int64(batch.QuantityPerUser) {
					return fmt.Errorf("用户 %d 的可用次数不足，未执行撤回", userId)
				}
			}
		}
		for _, userId := range recipients {
			ledgerId := fmt.Sprintf("%s:%d", batch.Id, userId)
			var existing int64
			if err := tx.Model(&RechargeLotteryLedger{}).Where("id = ?", ledgerId).Count(&existing).Error; err != nil {
				return err
			}
			if existing > 0 {
				continue
			}
			if batch.SkipPreviouslyGranted && batch.Kind != "revoke" {
				var count int64
				if err := tx.Model(&RechargeLotteryLedger{}).
					Where("campaign_id = ? AND user_id = ? AND kind = ? AND delta > 0", batch.CampaignId, userId, "grant").
					Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					continue
				}
			}
			batchId := batch.Id
			delta := batch.QuantityPerUser
			kind := "grant"
			if batch.Kind == "revoke" {
				delta = -delta
				kind = "revoke"
			}
			ledger := RechargeLotteryLedger{
				Id: ledgerId, CampaignId: batch.CampaignId, BatchId: &batchId,
				UserId: userId, Kind: kind, Delta: delta, ReferenceId: batch.Id,
				Note: batch.Note, OperatorUserId: batch.OperatorUserId, CreatedAt: now,
			}
			if err := tx.Create(&ledger).Error; err != nil {
				return err
			}
		}
		var processed int64
		if err := tx.Model(&RechargeLotteryLedger{}).Where("batch_id = ?", batch.Id).Count(&processed).Error; err != nil {
			return err
		}
		return tx.Model(&RechargeLotteryGrantBatch{}).Where("id = ?", batch.Id).Updates(map[string]interface{}{
			"status": RechargeLotteryBatchCompleted, "recipient_count": len(recipients),
			"processed_count": int(processed), "error_message": "", "completed_at": now,
		}).Error
	})
}

func FailRechargeLotteryGrantBatch(id, message string, now int64) error {
	return DB.Model(&RechargeLotteryGrantBatch{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status": RechargeLotteryBatchFailed, "error_message": message, "completed_at": now,
	}).Error
}

func GetRechargeLotteryCampaignStats(campaignId string) (RechargeLotteryCampaignStats, error) {
	stats := RechargeLotteryCampaignStats{}
	if err := DB.Model(&RechargeLotteryLedger{}).Where("campaign_id = ? AND kind = ?", campaignId, "grant").Distinct("user_id").Count(&stats.CoveredUsers).Error; err != nil {
		return stats, err
	}
	var ledger struct{ Granted, Used, Remaining int64 }
	if err := DB.Model(&RechargeLotteryLedger{}).Select(
		"COALESCE(SUM(CASE WHEN kind = 'grant' THEN delta ELSE 0 END), 0) AS granted, "+
			"COALESCE(-SUM(CASE WHEN kind = 'draw' THEN delta ELSE 0 END), 0) AS used, COALESCE(SUM(delta), 0) AS remaining",
	).Where("campaign_id = ?", campaignId).Scan(&ledger).Error; err != nil {
		return stats, err
	}
	stats.Granted, stats.Used, stats.Remaining = ledger.Granted, ledger.Used, ledger.Remaining
	if err := DB.Model(&RechargeLotteryDrawBatch{}).Where("campaign_id = ?", campaignId).Count(&stats.DrawBatches).Error; err != nil {
		return stats, err
	}
	var draws struct{ DrawItems, ActualAmountUsd int64 }
	if err := DB.Model(&RechargeLotteryDrawBatch{}).Select("COALESCE(SUM(draw_count), 0) AS draw_items, COALESCE(SUM(total_amount_usd), 0) AS actual_amount_usd").
		Where("campaign_id = ?", campaignId).Scan(&draws).Error; err != nil {
		return stats, err
	}
	stats.DrawItems, stats.ActualAmountUsd = draws.DrawItems, draws.ActualAmountUsd
	if err := DB.Model(&RechargeLotteryDrawBatch{}).Where("campaign_id = ? AND status = ?", campaignId, RechargeLotteryDrawCompleted).Count(&stats.Fulfilled).Error; err != nil {
		return stats, err
	}
	if err := DB.Model(&RechargeLotteryDrawBatch{}).Where("campaign_id = ? AND status IN ?", campaignId, []string{
		RechargeLotteryDrawPending, RechargeLotteryDrawProcessing, RechargeLotteryDrawUnknown, RechargeLotteryDrawFailed,
	}).Count(&stats.FulfillmentIssues).Error; err != nil {
		return stats, err
	}
	return stats, nil
}

func ListRechargeLotteryPlanMappings() ([]RechargeLotteryPlanMapping, error) {
	var mappings []RechargeLotteryPlanMapping
	err := DB.Order("amount_usd asc").Find(&mappings).Error
	return mappings, err
}

func RechargeLotterySubscriptionExpiresAt(draw RechargeLotteryDrawBatch) int64 {
	if draw.CompletedAt <= 0 {
		return 0
	}
	return draw.CompletedAt + int64(RechargeLotterySubscriptionDays)*int64((24*time.Hour)/time.Second)
}
