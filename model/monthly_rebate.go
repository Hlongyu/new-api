package model

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	MonthlyRebatePending            = "pending"
	MonthlyRebateIneligible         = "ineligible"
	MonthlyRebateIssued             = "issued"
	MonthlyRebateFailed             = "failed"
	MonthlyRebateNeedsReview        = "needs_review"
	MonthlyRebateSubscriptionSource = "monthly_rebate"
)

var ErrMonthlyRebateChanged = errors.New("rebate calculation changed; refresh and review again")

// MonthlyRebate keeps the latest calculation separate from the immutable issuance
// snapshot. There can be at most one issuance per user and Beijing calendar month.
type MonthlyRebate struct {
	Id                     int64   `json:"id" gorm:"primaryKey"`
	Period                 string  `json:"period" gorm:"type:varchar(7);uniqueIndex:idx_monthly_rebate_user,priority:1"`
	UserId                 int     `json:"user_id" gorm:"uniqueIndex:idx_monthly_rebate_user,priority:2"`
	Username               string  `json:"username" gorm:"type:varchar(64)"`
	QuotaPerUSD            float64 `json:"quota_per_usd"`
	WalletQuota            int64   `json:"wallet_quota" gorm:"type:bigint;not null"`
	RatePercent            int     `json:"rate_percent"`
	RebateQuota            int     `json:"rebate_quota"`
	Revision               int64   `json:"revision" gorm:"type:bigint;not null"`
	Status                 string  `json:"status" gorm:"type:varchar(32);index"`
	LastError              string  `json:"last_error" gorm:"type:text"`
	IssuedWalletQuota      int64   `json:"issued_wallet_quota" gorm:"type:bigint;not null"`
	IssuedRatePercent      int     `json:"issued_rate_percent"`
	IssuedQuota            int     `json:"issued_quota"`
	SubscriptionId         int     `json:"subscription_id"`
	SubscriptionExpiresAt  int64   `json:"subscription_expires_at" gorm:"type:bigint"`
	IssuedBy               int     `json:"issued_by"`
	IssuedAt               int64   `json:"issued_at" gorm:"type:bigint"`
	CheckedAt              int64   `json:"checked_at" gorm:"type:bigint"`
	CreatedAt              int64   `json:"created_at" gorm:"type:bigint"`
	UpdatedAt              int64   `json:"updated_at" gorm:"type:bigint"`
	SubscriptionStatus     string  `json:"subscription_status" gorm:"-"`
	SubscriptionAmountUsed int64   `json:"subscription_amount_used" gorm:"-"`
}

// MonthlyRebateWindow uses [start, end), independently of the host timezone.
func MonthlyRebateWindow(period string, now time.Time) (time.Time, time.Time, error) {
	start, end, err := BeijingConsumptionWindow(period)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	if end.After(now) {
		return time.Time{}, time.Time{}, errors.New("only completed months can be settled")
	}
	return start, end, nil
}

// CalculateMonthlyRebate applies a single rate to the entire month's wallet
// consumption, with strict > thresholds. Overflow must not silently underpay.
func CalculateMonthlyRebate(walletQuota int64, quotaPerUSD float64) (int, int, error) {
	if walletQuota < 0 || quotaPerUSD <= 0 || math.IsNaN(quotaPerUSD) || math.IsInf(quotaPerUSD, 0) {
		return 0, 0, errors.New("invalid rebate quota")
	}
	amount := decimal.NewFromInt(walletQuota)
	unit := decimal.NewFromFloat(quotaPerUSD)
	rate := 0
	if amount.GreaterThan(unit.Mul(decimal.NewFromInt(1500))) {
		rate = 10
	} else if amount.GreaterThan(unit.Mul(decimal.NewFromInt(750))) {
		rate = 5
	}
	quota, clamp := common.QuotaFromDecimalChecked(amount.Mul(decimal.NewFromInt(int64(rate))).Div(decimal.NewFromInt(100)))
	if clamp != nil {
		return rate, 0, errors.New("rebate exceeds the supported quota limit; manual review required")
	}
	return rate, quota, nil
}

func refreshMonthlyRebateTx(tx *gorm.DB, bill *MonthlyRebate, now time.Time) error {
	start, end, err := MonthlyRebateWindow(bill.Period, now)
	if err != nil {
		return err
	}
	var walletQuota int64
	if err := tx.Model(&PostpaidSettlement{}).
		Scopes(monthlyConsumptionScope(start.Unix(), end.Unix())).
		Where("user_id = ?", bill.UserId).
		Select("COALESCE(SUM(wallet_quota), 0)").Scan(&walletQuota).Error; err != nil {
		return err
	}
	rate, quota, calculationErr := CalculateMonthlyRebate(walletQuota, bill.QuotaPerUSD)
	// The legacy Midjourney refund path credits the wallet without updating a
	// request settlement. Do not approve a potentially overstated monthly base.
	var legacyRefunds int64
	if err := tx.Model(&Midjourney{}).
		Where("user_id = ? AND submit_time >= ? AND submit_time < ? AND quota > 0 AND code IN ? AND (status = ? OR fail_reason <> ?)",
			bill.UserId, start.UnixMilli(), end.UnixMilli(), []int{1, 21, 22}, "FAILURE", "").
		Count(&legacyRefunds).Error; err != nil {
		return err
	}
	if legacyRefunds > 0 {
		calculationErr = errors.New("legacy Midjourney refunds require manual reconciliation before rebate issuance")
	}
	calculationChanged := walletQuota != bill.WalletQuota || rate != bill.RatePercent || quota != bill.RebateQuota || bill.Revision == 0
	if calculationChanged {
		bill.Revision++
	}
	previousStatus, previousError := bill.Status, bill.LastError
	bill.WalletQuota, bill.RatePercent, bill.RebateQuota = walletQuota, rate, quota
	bill.CheckedAt, bill.UpdatedAt = now.Unix(), now.Unix()
	bill.LastError = ""
	switch {
	case calculationErr != nil:
		bill.Status, bill.LastError = MonthlyRebateNeedsReview, calculationErr.Error()
	case bill.IssuedAt > 0 && bill.IssuedQuota != quota:
		bill.Status = MonthlyRebateNeedsReview
	case bill.IssuedAt > 0:
		bill.Status = MonthlyRebateIssued
	case quota == 0:
		bill.Status = MonthlyRebateIneligible
	case previousStatus == MonthlyRebateFailed && !calculationChanged:
		bill.Status, bill.LastError = MonthlyRebateFailed, previousError
	default:
		bill.Status = MonthlyRebatePending
	}
	return nil
}

// RecalculateMonthlyRebates prepares reviewable bills; it never issues rewards.
// Existing bills remain candidates even when all consumption was refunded.
func RecalculateMonthlyRebates(period string, now time.Time) (int, error) {
	start, end, err := MonthlyRebateWindow(period, now)
	if err != nil {
		return 0, err
	}
	var userIds, existingIds []int
	if err := DB.Model(&PostpaidSettlement{}).
		Scopes(monthlyConsumptionScope(start.Unix(), end.Unix())).
		Where("wallet_quota > 0").
		Distinct("user_id").Pluck("user_id", &userIds).Error; err != nil {
		return 0, err
	}
	if err := DB.Model(&MonthlyRebate{}).Where("period = ?", period).Pluck("user_id", &existingIds).Error; err != nil {
		return 0, err
	}
	candidates := make(map[int]bool, len(userIds)+len(existingIds))
	for _, id := range append(userIds, existingIds...) {
		candidates[id] = true
	}
	userIds = userIds[:0]
	for id := range candidates {
		userIds = append(userIds, id)
	}
	sort.Ints(userIds)
	processed := 0
	var firstErr error
	for _, userId := range userIds {
		candidate := MonthlyRebate{Period: period, UserId: userId, QuotaPerUSD: common.QuotaPerUnit, Status: MonthlyRebatePending, CreatedAt: now.Unix(), UpdatedAt: now.Unix()}
		err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate).Error
		if err == nil {
			var bill MonthlyRebate
			err = DB.Transaction(func(tx *gorm.DB) error {
				if err := lockForUpdate(tx).Where("period = ? AND user_id = ?", period, userId).First(&bill).Error; err != nil {
					return err
				}
				var user User
				if err := tx.Unscoped().Select("id", "username").Where("id = ?", userId).First(&user).Error; err != nil {
					return err
				}
				bill.Username = user.Username
				if err := refreshMonthlyRebateTx(tx, &bill, now); err != nil {
					return err
				}
				return tx.Save(&bill).Error
			})
		}
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			// Do not overwrite an issuance that another administrator just committed.
			if saveErr := DB.Model(&MonthlyRebate{}).Where("period = ? AND user_id = ? AND issued_at = 0", period, userId).
				Updates(map[string]interface{}{"status": MonthlyRebateFailed, "last_error": err.Error(), "updated_at": now.Unix()}).Error; saveErr != nil {
				common.SysError(fmt.Sprintf("failed to record monthly rebate calculation failure: %v", saveErr))
			}
			continue
		}
		processed++
	}
	return processed, firstErr
}

// IssueMonthlyRebate verifies the exact calculation approved by the administrator.
// A replay returns the original issuance, including if its subscription was later
// revoked or deleted. Snapshot, grant and approval identity commit atomically.
func IssueMonthlyRebate(id, revision int64, adminId int, now time.Time) (*MonthlyRebate, error) {
	if id <= 0 || revision <= 0 || adminId <= 0 {
		return nil, errors.New("invalid rebate approval")
	}
	var bill MonthlyRebate
	changed := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&bill, id).Error; err != nil {
			return err
		}
		if bill.IssuedAt > 0 {
			return nil
		}
		if bill.Revision != revision {
			changed = true
			return nil
		}
		if err := refreshMonthlyRebateTx(tx, &bill, now); err != nil {
			return err
		}
		if bill.Revision != revision || (bill.Status != MonthlyRebatePending && bill.Status != MonthlyRebateFailed) {
			changed = true
			return tx.Save(&bill).Error
		}
		var user User
		if err := tx.Select("id").First(&user, bill.UserId).Error; err != nil {
			return err
		}
		subscription := UserSubscription{
			UserId: bill.UserId, PlanId: 0, AmountTotal: int64(bill.RebateQuota),
			StartTime: now.Unix(), EndTime: now.UTC().AddDate(1, 0, 0).Unix(),
			Status: "active", Source: MonthlyRebateSubscriptionSource,
			Title: bill.Period + " 月度消费返利", Currency: "USD",
			ResetIntervalUnit: SubscriptionResetNever, AllowWalletOverflow: true,
			GrantedBy: adminId, AdminNote: fmt.Sprintf("monthly_rebate:%d", bill.Id),
		}
		if err := tx.Create(&subscription).Error; err != nil {
			return err
		}
		bill.IssuedWalletQuota, bill.IssuedRatePercent, bill.IssuedQuota = bill.WalletQuota, bill.RatePercent, bill.RebateQuota
		bill.SubscriptionId, bill.SubscriptionExpiresAt = subscription.Id, subscription.EndTime
		bill.IssuedBy, bill.IssuedAt, bill.UpdatedAt = adminId, now.Unix(), now.Unix()
		bill.Status, bill.LastError = MonthlyRebateIssued, ""
		return tx.Save(&bill).Error
	})
	if err != nil {
		if saveErr := DB.Model(&MonthlyRebate{}).Where("id = ? AND issued_at = 0 AND revision = ?", id, revision).
			Updates(map[string]interface{}{"status": MonthlyRebateFailed, "last_error": err.Error(), "updated_at": now.Unix()}).Error; saveErr != nil {
			common.SysError(fmt.Sprintf("failed to record monthly rebate issuance failure: %v", saveErr))
		}
		return nil, err
	}
	if changed {
		return &bill, ErrMonthlyRebateChanged
	}
	return &bill, nil
}

type MonthlyRebateSummary struct {
	Users       int64 `json:"users"`
	Pending     int64 `json:"pending"`
	Issued      int64 `json:"issued"`
	NeedsReview int64 `json:"needs_review"`
	Failed      int64 `json:"failed"`
	IssuedQuota int64 `json:"issued_quota"`
}

func ListMonthlyRebates(period, status string, userId, offset, limit int) ([]MonthlyRebate, int64, MonthlyRebateSummary, error) {
	bills := make([]MonthlyRebate, 0)
	var total int64
	var summary MonthlyRebateSummary
	if offset < 0 || limit < 1 || limit > 100 {
		return bills, 0, summary, errors.New("invalid pagination")
	}
	base := DB.Model(&MonthlyRebate{}).Where("period = ?", period)
	if userId > 0 {
		base = base.Where("user_id = ?", userId)
	}
	if err := base.Session(&gorm.Session{}).Select(`COUNT(*) AS users,
  COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
  COALESCE(SUM(CASE WHEN issued_at > 0 THEN 1 ELSE 0 END), 0) AS issued,
  COALESCE(SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END), 0) AS needs_review,
  COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
  COALESCE(SUM(issued_quota), 0) AS issued_quota`).Scan(&summary).Error; err != nil {
		return bills, 0, summary, err
	}
	if status != "" {
		base = base.Where("status = ?", status)
	}
	if err := base.Count(&total).Error; err != nil {
		return bills, 0, summary, err
	}
	if err := base.Order("id desc").Offset(offset).Limit(limit).Find(&bills).Error; err != nil {
		return bills, 0, summary, err
	}
	var subscriptionIds []int
	for _, bill := range bills {
		if bill.SubscriptionId > 0 {
			subscriptionIds = append(subscriptionIds, bill.SubscriptionId)
		}
	}
	if len(subscriptionIds) > 0 {
		var subscriptions []UserSubscription
		if err := DB.Where("id IN ?", subscriptionIds).Find(&subscriptions).Error; err != nil {
			return bills, 0, summary, err
		}
		byId := make(map[int]UserSubscription, len(subscriptions))
		for _, subscription := range subscriptions {
			byId[subscription.Id] = subscription
		}
		for i := range bills {
			if bills[i].SubscriptionId == 0 {
				continue
			}
			subscription, found := byId[bills[i].SubscriptionId]
			bills[i].SubscriptionStatus = "deleted"
			if found {
				bills[i].SubscriptionStatus = subscription.Status
				bills[i].SubscriptionAmountUsed = subscription.AmountUsed
			}
		}
	}
	return bills, total, summary, nil
}
