package model

import (
	"database/sql"
	"errors"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const AccountingStartPeriod = "2026-10"

// AccountingRedemption is an immutable receipt, inserted in the same transaction
// as the wallet credit. Editing/deleting a redemption code cannot rewrite cash receipts.
// Historical receipts are not backfilled: the first snapshot establishes the baseline.
type AccountingRedemption struct {
	Id           int64 `json:"id"`
	RedemptionId int   `json:"redemption_id" gorm:"index"`
	UserId       int   `json:"user_id" gorm:"index"`
	Quota        int64 `json:"quota" gorm:"type:bigint;not null"`
	RepaidQuota  int64 `json:"repaid_quota" gorm:"type:bigint;not null"`
	CreatedAt    int64 `json:"created_at" gorm:"index"`
}

type AccountingSnapshot struct {
	Period      string `json:"period" gorm:"primaryKey;type:varchar(7)"`
	ScheduledAt int64  `json:"scheduled_at"`
	CapturedAt  int64  `json:"captured_at"`
	Status      string `json:"status" gorm:"type:varchar(24)"`
	// Frozen at the first capture; one displayed balance unit equals one CNY.
	QuotaPerCNY       float64 `json:"quota_per_cny"`
	BalanceQuota      int64   `json:"balance_quota" gorm:"type:bigint"`
	RedeemedQuota     int64   `json:"redeemed_quota" gorm:"type:bigint"`
	RepaidQuota       int64   `json:"repaid_quota" gorm:"type:bigint"`
	UserCount         int64   `json:"user_count"`
	NegativeUserCount int64   `json:"negative_user_count"`
}

type AccountingSnapshotUser struct {
	Period   string `json:"period" gorm:"primaryKey;type:varchar(7)"`
	UserId   int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Username string `json:"username" gorm:"type:varchar(64)"`
	Quota    int64  `json:"quota" gorm:"type:bigint"`
	Deleted  bool   `json:"deleted"`
}

// CaptureMonthlyAccountingSnapshot records the current database state, never a
// fabricated historical state. A missed deadline remains visible as "late".
// All reads use one repeatable snapshot, including receipts and soft-deleted users.
func CaptureMonthlyAccountingSnapshot(now time.Time, quotaPerCNY float64) error {
	started := time.Now()
	period := now.In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01")
	if period < AccountingStartPeriod {
		return nil
	}
	if quotaPerCNY <= 0 || math.IsNaN(quotaPerCNY) || math.IsInf(quotaPerCNY, 0) {
		return errors.New("invalid accounting conversion rate")
	}
	start, _, err := BeijingConsumptionWindow(period)
	if err != nil {
		return err
	}
	isolation := sql.LevelRepeatableRead
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		isolation = sql.LevelSerializable
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		snapshot := AccountingSnapshot{Period: period, ScheduledAt: start.Unix(), CapturedAt: now.Unix(), QuotaPerCNY: quotaPerCNY, Status: "captured"}
		claim := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&snapshot)
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected == 0 {
			return nil
		}
		// Include transaction/claim wait time in the recorded capture instant.
		snapshot.CapturedAt = now.Add(time.Since(started)).Unix()
		var baseline AccountingSnapshot
		if err := tx.Order("period ASC").First(&baseline).Error; err != nil {
			return err
		}
		snapshot.QuotaPerCNY = baseline.QuotaPerCNY
		// Use ordinary repeatable reads, not INSERT ... SELECT: MySQL treats
		// the latter as a locking/current read even under REPEATABLE READ.
		lastID := 0
		firstPage := true
		for {
			users := make([]AccountingSnapshotUser, 0, 1000)
			query := tx.Model(&User{}).Unscoped().Select("? AS period, id AS user_id, username, quota, (deleted_at IS NOT NULL) AS deleted", period).Order("id ASC").Limit(1000)
			if !firstPage {
				query = query.Where("id > ?", lastID)
			}
			if err := query.Scan(&users).Error; err != nil {
				return err
			}
			if len(users) == 0 {
				break
			}
			if err := tx.Create(&users).Error; err != nil {
				return err
			}
			lastID = users[len(users)-1].UserId
			firstPage = false
		}
		if err := tx.Model(&AccountingSnapshotUser{}).Where("period = ?", period).Select("COALESCE(SUM(quota), 0) AS balance_quota, COUNT(*) AS user_count, COALESCE(SUM(CASE WHEN quota < 0 THEN 1 ELSE 0 END), 0) AS negative_user_count").Scan(&snapshot).Error; err != nil {
			return err
		}
		if err := tx.Model(&AccountingRedemption{}).Select("COALESCE(SUM(quota), 0) AS redeemed_quota, COALESCE(SUM(repaid_quota), 0) AS repaid_quota").Scan(&snapshot).Error; err != nil {
			return err
		}

		if now.Add(time.Since(started)).Sub(start) >= time.Minute {
			snapshot.Status = "late"
		}
		// Pending in-memory updates on any node cannot be reconstructed by this reader.
		if common.BatchUpdateEnabled {
			snapshot.Status = "batch_pending"
		}
		if snapshot.NegativeUserCount > 0 {
			snapshot.Status = "negative_balance"
		}
		return tx.Model(&AccountingSnapshot{}).Where("period = ?", period).Select("*").Updates(&snapshot).Error
	}, &sql.TxOptions{Isolation: isolation})
}

type AccountingMonth struct {
	Period                    string              `json:"period"`
	Status                    string              `json:"status"`
	Opening                   *AccountingSnapshot `json:"opening"`
	Closing                   *AccountingSnapshot `json:"closing"`
	ReceiptsQuota             *int64              `json:"receipts_quota"`
	RevenueQuota              *int64              `json:"revenue_quota"`
	TransitionAdjustmentQuota *int64              `json:"transition_adjustment_quota"`
	BookkeepingRevenueQuota   *int64              `json:"bookkeeping_revenue_quota"`
}

// ListAccountingMonths includes absent snapshots explicitly. Incomplete or late
// periods never produce a definitive income figure. Amounts exclude expenses.
func ListAccountingMonths(now time.Time, year int) ([]AccountingMonth, error) {
	if year < 2026 || year > 9998 {
		return nil, errors.New("invalid accounting year")
	}
	var snapshots []AccountingSnapshot
	if err := DB.Where("period >= ? AND period <= ?", time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006-01"), time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006-01")).Order("period ASC").Find(&snapshots).Error; err != nil {
		return nil, err
	}
	byPeriod := make(map[string]*AccountingSnapshot, len(snapshots))
	for i := range snapshots {
		byPeriod[snapshots[i].Period] = &snapshots[i]
	}
	rows := make([]AccountingMonth, 0, 12)
	for month := 1; month <= 12; month++ {
		start := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*3600))
		period := start.Format("2006-01")
		if period < AccountingStartPeriod {
			continue
		}
		end := start.AddDate(0, 1, 0)
		row := AccountingMonth{Period: period, Opening: byPeriod[period], Closing: byPeriod[end.Format("2006-01")], Status: "scheduled"}
		if !now.Before(start) {
			row.Status = "in_progress"
		}
		if !now.Before(start) && row.Opening == nil {
			row.Status = "missing"
		}
		if !now.Before(end) && row.Closing == nil {
			row.Status = "missing"
		}
		if row.Opening != nil && row.Closing != nil {
			row.Status = "complete"
			receipts := row.Closing.RedeemedQuota - row.Opening.RedeemedQuota
			revenue := row.Opening.BalanceQuota + receipts - row.Closing.BalanceQuota
			if row.Opening.Status != "captured" || row.Closing.Status != "captured" ||
				row.Opening.QuotaPerCNY != row.Closing.QuotaPerCNY || receipts < 0 || revenue < 0 ||
				row.Opening.RepaidQuota != row.Closing.RepaidQuota {
				row.Status = "review"
			} else {
				row.ReceiptsQuota, row.RevenueQuota = &receipts, &revenue
				adjustment := int64(0)
				bookkeepingRevenue := revenue
				if period == AccountingStartPeriod {
					// Reverse prepaid balances previously recognized as income,
					// exactly once in the cutover month. Preserve the real snapshot.
					adjustment = -row.Opening.BalanceQuota
					bookkeepingRevenue = receipts - row.Closing.BalanceQuota
				}
				// A negative cutover result is valid, unlike negative consumption.
				row.TransitionAdjustmentQuota = &adjustment
				row.BookkeepingRevenueQuota = &bookkeepingRevenue
			}
		} else if row.Opening != nil && row.Opening.Status != "captured" {
			row.Status = "review"
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func ListAccountingSnapshotUsers(period string, offset, limit int) ([]AccountingSnapshotUser, error) {
	if _, _, err := BeijingConsumptionWindow(period); err != nil {
		return nil, err
	}
	if period < AccountingStartPeriod || offset < 0 || limit < 1 || limit > 100 {
		return nil, errors.New("invalid snapshot query")
	}
	rows := make([]AccountingSnapshotUser, 0)
	err := DB.Where("period = ?", period).Order("user_id ASC").Offset(offset).Limit(limit).Find(&rows).Error
	return rows, err
}
