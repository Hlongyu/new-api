package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	LeaderboardOrderProcessing = "processing"
	LeaderboardOrderCompleted  = "completed"
	LeaderboardOrderFailed     = "failed"
	LeaderboardOrderUnknown    = "unknown"

	QuotaLoanActive  = "active"
	QuotaLoanSettled = "settled"
	QuotaLoanOverdue = "overdue"
)

type LeaderboardEntry struct {
	Id               int    `json:"id" gorm:"primaryKey"`
	UserId           int    `json:"user_id" gorm:"uniqueIndex;not null"`
	Username         string `json:"username" gorm:"type:varchar(64);not null"`
	SourceName       string `json:"source_name" gorm:"type:varchar(128);not null"`
	TokenId          int    `json:"token_id" gorm:"index;not null"`
	TokenName        string `json:"token_name" gorm:"type:varchar(128);not null"`
	MaskedKey        string `json:"masked_key" gorm:"type:varchar(128);not null"`
	DisplayName      string `json:"display_name" gorm:"type:varchar(128);not null"`
	AnonymousName    string `json:"anonymous_name" gorm:"type:varchar(128);not null"`
	IsNamePublic     bool   `json:"is_name_public" gorm:"not null"`
	TokenCreatedAt   int64  `json:"token_created_at" gorm:"type:bigint;not null"`
	ManageSecretHash string `json:"-" gorm:"type:varchar(128);not null"`
	CreatedAt        int64  `json:"created_at" gorm:"type:bigint;not null"`
	Active           bool   `json:"active" gorm:"not null;index"`
	Participating    bool   `json:"participating" gorm:"not null"`
	ParticipateDay   bool   `json:"participate_day" gorm:"not null"`
	ParticipateWeek  bool   `json:"participate_week" gorm:"not null"`
	ParticipateMonth bool   `json:"participate_month" gorm:"not null"`
	ParticipateAll   bool   `json:"participate_all" gorm:"not null"`
	ParticipateRank  bool   `json:"participate_rank" gorm:"not null"`
	ShowRankBadge    bool   `json:"show_rank_badge" gorm:"not null"`
}

func (LeaderboardEntry) TableName() string { return "leaderboard_entries" }

type LeaderboardExcludedUser struct {
	UserId    int   `json:"user_id" gorm:"primaryKey"`
	CreatedAt int64 `json:"created_at" gorm:"type:bigint;not null"`
}

func (LeaderboardExcludedUser) TableName() string { return "leaderboard_excluded_users" }

type SponsorOrder struct {
	Id                 string `json:"id" gorm:"type:varchar(64);primaryKey"`
	RequestKey         string `json:"request_key" gorm:"type:varchar(80);uniqueIndex;not null"`
	UserId             int    `json:"user_id" gorm:"index;not null"`
	EntryId            int    `json:"entry_id" gorm:"index;not null"`
	AmountCny          int    `json:"amount_cny" gorm:"not null"`
	QuotaAmount        int    `json:"quota_amount" gorm:"not null"`
	DisplayAnonymously bool   `json:"display_anonymously" gorm:"not null"`
	Message            string `json:"message" gorm:"type:varchar(80);not null"`
	Status             string `json:"status" gorm:"type:varchar(16);index;not null"`
	ErrorMessage       string `json:"error_message" gorm:"type:text;not null"`
	OperatorUserId     int    `json:"operator_user_id" gorm:"not null"`
	CreatedAt          int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt          int64  `json:"updated_at" gorm:"type:bigint;not null"`
	CompletedAt        int64  `json:"completed_at" gorm:"type:bigint;index;not null"`
}

func (SponsorOrder) TableName() string { return "sponsor_orders" }

type RenameCardBalance struct {
	UserId    int   `json:"user_id" gorm:"primaryKey"`
	Balance   int   `json:"balance" gorm:"not null"`
	UpdatedAt int64 `json:"updated_at" gorm:"type:bigint;not null"`
}

func (RenameCardBalance) TableName() string { return "rename_card_balances" }

type RenameEvent struct {
	Id        string `json:"id" gorm:"type:varchar(64);primaryKey"`
	UserId    int    `json:"user_id" gorm:"index;not null"`
	EntryId   int    `json:"entry_id" gorm:"index;not null"`
	OldName   string `json:"old_name" gorm:"type:varchar(128);not null"`
	NewName   string `json:"new_name" gorm:"type:varchar(128);not null"`
	CostType  string `json:"cost_type" gorm:"type:varchar(16);not null"`
	PeriodKey string `json:"period_key" gorm:"type:varchar(16);index;not null"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;not null"`
}

func (RenameEvent) TableName() string { return "rename_events" }

type RenameCardOrder struct {
	Id             string `json:"id" gorm:"type:varchar(64);primaryKey"`
	RequestKey     string `json:"request_key" gorm:"type:varchar(80);uniqueIndex;not null"`
	UserId         int    `json:"user_id" gorm:"index;not null"`
	EntryId        int    `json:"entry_id" gorm:"index;not null"`
	Quantity       int    `json:"quantity" gorm:"not null"`
	AmountCny      int    `json:"amount_cny" gorm:"not null"`
	QuotaAmount    int    `json:"quota_amount" gorm:"not null"`
	Status         string `json:"status" gorm:"type:varchar(16);index;not null"`
	ErrorMessage   string `json:"error_message" gorm:"type:text;not null"`
	OperatorUserId int    `json:"operator_user_id" gorm:"not null"`
	CreatedAt      int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt      int64  `json:"updated_at" gorm:"type:bigint;not null"`
	CompletedAt    int64  `json:"completed_at" gorm:"type:bigint;index;not null"`
}

func (RenameCardOrder) TableName() string { return "rename_card_orders" }

type LotteryDraw struct {
	Id                  string  `json:"id" gorm:"type:varchar(64);primaryKey"`
	RuleVersion         int     `json:"rule_version" gorm:"uniqueIndex:idx_lottery_period_rank,priority:1;not null"`
	PeriodKey           string  `json:"period_key" gorm:"type:varchar(16);uniqueIndex:idx_lottery_period_rank,priority:2;not null"`
	DrawRank            int     `json:"draw_rank" gorm:"uniqueIndex:idx_lottery_period_rank,priority:3;not null"`
	UserId              int     `json:"user_id" gorm:"index;not null"`
	EntryId             int     `json:"entry_id" gorm:"index;not null"`
	DisplayNameSnapshot string  `json:"display_name_snapshot" gorm:"type:varchar(128);not null"`
	AmountUsd           float64 `json:"amount_usd" gorm:"type:decimal(20,8);not null"`
	QuotaAmount         int     `json:"quota_amount" gorm:"not null"`
	Status              string  `json:"status" gorm:"type:varchar(16);index;not null"`
	ErrorMessage        string  `json:"error_message" gorm:"type:text;not null"`
	OperatorUserId      int     `json:"operator_user_id" gorm:"not null"`
	CreatedAt           int64   `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt           int64   `json:"updated_at" gorm:"type:bigint;not null"`
	CompletedAt         int64   `json:"completed_at" gorm:"type:bigint;not null"`
}

func (LotteryDraw) TableName() string { return "lottery_draws" }

type LotteryPeriod struct {
	RuleVersion int    `json:"rule_version" gorm:"primaryKey"`
	PeriodKey   string `json:"period_key" gorm:"type:varchar(16);primaryKey"`
	SettledAt   int64  `json:"settled_at" gorm:"type:bigint;not null"`
}

func (LotteryPeriod) TableName() string { return "lottery_periods" }

type LotteryOpportunity struct {
	RuleVersion         int    `json:"rule_version" gorm:"primaryKey"`
	PeriodKey           string `json:"period_key" gorm:"type:varchar(16);primaryKey"`
	DrawRank            int    `json:"draw_rank" gorm:"primaryKey"`
	UserId              int    `json:"user_id" gorm:"index;not null"`
	EntryId             int    `json:"entry_id" gorm:"index;not null"`
	DisplayNameSnapshot string `json:"display_name_snapshot" gorm:"type:varchar(128);not null"`
	TokenUsed           int64  `json:"token_used" gorm:"not null"`
	Quota               int64  `json:"quota" gorm:"not null"`
	RequestCount        int64  `json:"request_count" gorm:"not null"`
	PrizePoolJson       string `json:"prize_pool_json" gorm:"type:text;not null"`
	CreatedAt           int64  `json:"created_at" gorm:"type:bigint;not null"`
}

func (LotteryOpportunity) TableName() string { return "lottery_opportunities" }

type QuotaLoan struct {
	Id                string `json:"id" gorm:"type:varchar(64);primaryKey"`
	RequestKey        string `json:"request_key" gorm:"type:varchar(80);uniqueIndex;not null"`
	UserId            int    `json:"user_id" gorm:"index;not null"`
	EntryId           int    `json:"entry_id" gorm:"index;not null"`
	TierKey           string `json:"tier_key" gorm:"type:varchar(32);not null"`
	TierName          string `json:"tier_name" gorm:"type:varchar(32);not null"`
	CreditAmount      int    `json:"credit_amount" gorm:"not null"`
	QuotaAmount       int    `json:"quota_amount" gorm:"not null"`
	OutstandingQuota  int    `json:"outstanding_quota" gorm:"not null"`
	RedemptionStartId int    `json:"redemption_start_id" gorm:"not null"`
	Status            string `json:"status" gorm:"type:varchar(16);index;not null"`
	ErrorMessage      string `json:"error_message" gorm:"type:text;not null"`
	OperatorUserId    int    `json:"operator_user_id" gorm:"not null"`
	CreatedAt         int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt         int64  `json:"updated_at" gorm:"type:bigint;not null"`
	DueAt             int64  `json:"due_at" gorm:"type:bigint;index;not null"`
	CompletedAt       int64  `json:"completed_at" gorm:"type:bigint;not null"`
}

func (QuotaLoan) TableName() string { return "quota_loans" }

type QuotaLoanEvent struct {
	Id                string `json:"id" gorm:"type:varchar(64);primaryKey"`
	LoanId            string `json:"loan_id" gorm:"type:varchar(64);index;uniqueIndex:idx_quota_loan_source,priority:3;not null"`
	UserId            int    `json:"user_id" gorm:"index;not null"`
	EventType         string `json:"event_type" gorm:"type:varchar(24);not null"`
	SourceType        string `json:"source_type" gorm:"type:varchar(24);uniqueIndex:idx_quota_loan_source,priority:1;not null"`
	SourceId          string `json:"source_id" gorm:"type:varchar(80);uniqueIndex:idx_quota_loan_source,priority:2;not null"`
	QuotaAmount       int    `json:"quota_amount" gorm:"not null"`
	OutstandingBefore int    `json:"outstanding_before" gorm:"not null"`
	OutstandingAfter  int    `json:"outstanding_after" gorm:"not null"`
	RedemptionTime    int64  `json:"redemption_time" gorm:"type:bigint;index"`
	Status            string `json:"status" gorm:"type:varchar(24);index"`
	ErrorMessage      string `json:"error_message" gorm:"type:text"`
	CreatedAt         int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt         int64  `json:"updated_at" gorm:"type:bigint"`
}

func (QuotaLoanEvent) TableName() string { return "quota_loan_events" }

type CompanionMigration struct {
	Id           int64  `json:"id" gorm:"primaryKey"`
	MigrationKey string `json:"migration_key" gorm:"type:varchar(128);uniqueIndex;not null"`
	ManifestHash string `json:"manifest_hash" gorm:"type:varchar(128);not null"`
	CutoverAt    int64  `json:"cutover_at" gorm:"type:bigint;not null"`
	CompletedAt  int64  `json:"completed_at" gorm:"type:bigint;not null"`
}

func (CompanionMigration) TableName() string { return "companion_migrations" }

func HasCompletedCompanionMigration() (bool, error) {
	var count int64
	err := DB.Model(&CompanionMigration{}).Count(&count).Error
	return count > 0, err
}

type RankQuotaRow struct {
	UserId       int   `gorm:"column:user_id"`
	CreatedAt    int64 `gorm:"column:created_at"`
	SyncedAt     int64 `gorm:"column:synced_at"`
	Quota        int64 `gorm:"column:quota"`
	TokenUsed    int64 `gorm:"column:token_used"`
	RequestCount int64 `gorm:"column:request_count"`
}

type LeaderboardUsageTotal struct {
	UserId       int   `gorm:"column:user_id"`
	TokenUsed    int64 `gorm:"column:token_used"`
	Quota        int64 `gorm:"column:quota"`
	RequestCount int64 `gorm:"column:request_count"`
	UpdatedAt    int64 `gorm:"column:updated_at"`
}

func GetLeaderboardEntryByUserId(userId int) (*LeaderboardEntry, error) {
	var entry LeaderboardEntry
	err := DB.Where("user_id = ? AND active = ?", userId, true).First(&entry).Error
	return &entry, err
}

func ListLeaderboardEntries() ([]LeaderboardEntry, error) {
	var entries []LeaderboardEntry
	err := DB.Where("active = ?", true).Order("id asc").Find(&entries).Error
	return entries, err
}

func GetRankQuotaRows(userId int) ([]RankQuotaRow, error) {
	rows := make([]RankQuotaRow, 0)
	query := DB.Table("quota_data").
		Select(fmt.Sprintf("user_id, created_at, MAX(%s) AS synced_at, SUM(quota) AS quota, SUM(%s) AS token_used, SUM(count) AS request_count", quotaDataLastSyncExpr, quotaDataTotalTokensExpr)).
		Where("use_group <> ''")
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	err := query.Group("user_id, created_at").Order("user_id asc, created_at asc").Find(&rows).Error
	return rows, err
}

func GetLeaderboardUsageTotals(startAt int64, endAt int64) ([]LeaderboardUsageTotal, error) {
	rows := make([]LeaderboardUsageTotal, 0)
	err := DB.Table("quota_data").
		Select(fmt.Sprintf("user_id, SUM(%s) AS token_used, SUM(quota) AS quota, SUM(count) AS request_count, MAX(%s) AS updated_at", quotaDataTotalTokensExpr, quotaDataLastSyncExpr)).
		Where("use_group <> '' AND created_at >= ? AND created_at < ?", startAt, endAt).
		Group("user_id").Find(&rows).Error
	return rows, err
}

func ListCompletedSponsorOrders(userId int) ([]SponsorOrder, error) {
	var orders []SponsorOrder
	query := DB.Where("status = ?", LeaderboardOrderCompleted)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	err := query.Order("user_id asc, completed_at asc, id asc").Find(&orders).Error
	return orders, err
}

func ListCompletedRenameCardOrders(userId int) ([]RenameCardOrder, error) {
	var orders []RenameCardOrder
	query := DB.Where("status = ?", LeaderboardOrderCompleted)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	err := query.Order("user_id asc, completed_at asc, id asc").Find(&orders).Error
	return orders, err
}

func GetExcludedLeaderboardUserIds() ([]int, error) {
	var rows []LeaderboardExcludedUser
	if err := DB.Order("user_id asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.UserId)
	}
	return ids, nil
}

func ReplaceExcludedLeaderboardUsers(userIds []int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&LeaderboardExcludedUser{}).Error; err != nil {
			return err
		}
		now := GetDBTimestamp()
		for _, userId := range userIds {
			if err := tx.Create(&LeaderboardExcludedUser{UserId: userId, CreatedAt: now}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func EnsureLeaderboardEntry(userId int, username string, displayName string, anonymousName string) (*LeaderboardEntry, error) {
	entry, err := GetLeaderboardEntryByUserId(userId)
	if err == nil {
		return entry, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := common.GetTimestamp()
	entry = &LeaderboardEntry{
		UserId: userId, Username: username, SourceName: displayName,
		DisplayName: displayName, AnonymousName: anonymousName,
		CreatedAt: now, Active: true, Participating: true,
		ParticipateDay: true, ParticipateWeek: true, ParticipateMonth: true,
		ParticipateAll: true, ParticipateRank: true, ShowRankBadge: true,
	}
	if err := DB.Create(entry).Error; err != nil {
		if existing, getErr := GetLeaderboardEntryByUserId(userId); getErr == nil {
			return existing, nil
		}
		return nil, err
	}
	return entry, nil
}
