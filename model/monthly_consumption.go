package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

// BeijingConsumptionWindow is shared by live monthly consumption and closed
// month rebate accounting. Requests are attributed by started_at in [start,end).
func BeijingConsumptionWindow(period string) (time.Time, time.Time, error) {
	location := time.FixedZone("Asia/Shanghai", 8*60*60)
	start, err := time.ParseInLocation("2006-01", period, location)
	if err != nil || start.Format("2006-01") != period || start.Unix() < 0 {
		return time.Time{}, time.Time{}, errors.New("invalid consumption month")
	}
	return start, start.AddDate(0, 1, 0), nil
}

func monthlyConsumptionScope(start, end int64) func(*gorm.DB) *gorm.DB {
	return func(tx *gorm.DB) *gorm.DB {
		return tx.Where("started_at >= ? AND started_at < ? AND request_id NOT LIKE ?", start, end, "%:violation")
	}
}

type MonthlyConsumption struct {
	UserId            int    `json:"user_id"`
	Username          string `json:"username"`
	WalletQuota       int64  `json:"wallet_quota"`
	SubscriptionQuota int64  `json:"subscription_quota"`
	TotalQuota        int64  `json:"total_quota"`
}

// ListMonthlyConsumption includes users with no consumption. Main settlement
// records preserve refunds and funding splits, unlike the aggregate usage logs.
func ListMonthlyConsumption(start, end int64, userId int, keyword string, offset, limit int) ([]MonthlyConsumption, int64, error) {
	rows := make([]MonthlyConsumption, 0)
	var total int64
	if start < 0 || end <= start || userId < 0 || offset < 0 || limit < 1 || limit > 100 {
		return rows, 0, errors.New("invalid monthly consumption query")
	}
	users := DB.Model(&User{}).Where("users.deleted_at IS NULL")
	if userId > 0 {
		users = users.Where("users.id = ?", userId)
	}
	if keyword != "" {
		users = users.Where("users.username LIKE ?", "%"+keyword+"%")
	}
	if err := users.Count(&total).Error; err != nil {
		return rows, 0, err
	}
	usage := DB.Model(&PostpaidSettlement{}).Scopes(monthlyConsumptionScope(start, end)).
		Select("user_id, SUM(wallet_quota) AS wallet_quota, SUM(subscription_quota) AS subscription_quota").Group("user_id")
	if userId > 0 {
		usage = usage.Where("user_id = ?", userId)
	}
	err := users.Select(`users.id AS user_id, users.username,
  COALESCE(usage.wallet_quota, 0) AS wallet_quota,
  COALESCE(usage.subscription_quota, 0) AS subscription_quota,
  COALESCE(usage.wallet_quota, 0) + COALESCE(usage.subscription_quota, 0) AS total_quota`).
		Joins("LEFT JOIN (?) AS usage ON usage.user_id = users.id", usage).
		Order("wallet_quota DESC, users.id ASC").Offset(offset).Limit(limit).Scan(&rows).Error
	return rows, total, err
}
