package model

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrLeaderboardInsufficientQuota = errors.New("leaderboard wallet quota is insufficient")
	ErrLeaderboardRenameCardNeeded  = errors.New("本周免费改名已用完，请购买改名卡")
	ErrQuotaLoanCreditExceeded      = errors.New("quota loan credit limit exceeded")
	ErrQuotaLoanOverdue             = errors.New("overdue quota credit must be repaid before another drawdown")
	ErrQuotaLoanPending             = errors.New("quota loan request is still pending")
	ErrQuotaLoanRequestConflict     = errors.New("quota loan request key conflicts with another user")
)

type LeaderboardProfileUpdate struct {
	DisplayName      *string
	IsNamePublic     *bool
	ParticipateDay   *bool
	ParticipateWeek  *bool
	ParticipateMonth *bool
	ParticipateAll   *bool
	ParticipateRank  *bool
	ShowRankBadge    *bool
	PeriodKey        string
	Now              int64
}

func UpdateLeaderboardProfile(userId int, update LeaderboardProfileUpdate) (*LeaderboardEntry, error) {
	var updated LeaderboardEntry
	err := DB.Transaction(func(tx *gorm.DB) error {
		var entry LeaderboardEntry
		if err := lockForUpdate(tx).Where("user_id = ? AND active = ?", userId, true).First(&entry).Error; err != nil {
			return err
		}
		if update.DisplayName != nil && *update.DisplayName != entry.DisplayName {
			var freeRenameCount int64
			if err := tx.Model(&RenameEvent{}).
				Where("user_id = ? AND period_key = ? AND cost_type = ?", userId, update.PeriodKey, "free").
				Count(&freeRenameCount).Error; err != nil {
				return err
			}
			costType := "free"
			if freeRenameCount > 0 {
				result := tx.Model(&RenameCardBalance{}).
					Where("user_id = ? AND balance > 0", userId).
					Updates(map[string]interface{}{
						"balance":    gorm.Expr("balance - 1"),
						"updated_at": update.Now,
					})
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected == 0 {
					return ErrLeaderboardRenameCardNeeded
				}
				costType = "card"
			}
			if err := tx.Create(&RenameEvent{
				Id: common.GetUUID(), UserId: userId, EntryId: entry.Id,
				OldName: entry.DisplayName, NewName: *update.DisplayName,
				CostType: costType, PeriodKey: update.PeriodKey, CreatedAt: update.Now,
			}).Error; err != nil {
				return err
			}
			entry.DisplayName = *update.DisplayName
		}
		if update.IsNamePublic != nil {
			entry.IsNamePublic = *update.IsNamePublic
		}
		if update.ParticipateDay != nil {
			entry.ParticipateDay = *update.ParticipateDay
		}
		if update.ParticipateWeek != nil {
			entry.ParticipateWeek = *update.ParticipateWeek
		}
		if update.ParticipateMonth != nil {
			entry.ParticipateMonth = *update.ParticipateMonth
		}
		if update.ParticipateAll != nil {
			entry.ParticipateAll = *update.ParticipateAll
		}
		if update.ParticipateRank != nil {
			entry.ParticipateRank = *update.ParticipateRank
		}
		if update.ShowRankBadge != nil {
			entry.ShowRankBadge = *update.ShowRankBadge
		}
		entry.Participating = entry.ParticipateDay || entry.ParticipateWeek || entry.ParticipateMonth || entry.ParticipateAll || entry.ParticipateRank
		if err := tx.Save(&entry).Error; err != nil {
			return err
		}
		updated = entry
		return nil
	})
	return &updated, err
}

func GetRenameCardBalance(userId int) (int, error) {
	var balance RenameCardBalance
	query := DB.Where("user_id = ?", userId).Limit(1).Find(&balance)
	if query.Error != nil {
		return 0, query.Error
	}
	return balance.Balance, nil
}

func HasWeeklyFreeRename(userId int, periodKey string) (bool, error) {
	var count int64
	err := DB.Model(&RenameEvent{}).
		Where("user_id = ? AND period_key = ? AND cost_type = ?", userId, periodKey, "free").
		Count(&count).Error
	return count > 0, err
}

func PurchaseRenameCards(requestKey string, userId int, entryId int, quantity int, amountCny int, quotaAmount int, now int64) (*RenameCardOrder, error) {
	var saved RenameCardOrder
	var walletDelta int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		var existing RenameCardOrder
		query := tx.Where("request_key = ?", requestKey).Limit(1).Find(&existing)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			if existing.UserId != userId {
				return ErrQuotaLoanRequestConflict
			}
			saved = existing
			return nil
		}
		if user.Quota < quotaAmount {
			return ErrLeaderboardInsufficientQuota
		}
		order := RenameCardOrder{
			Id: common.GetUUID(), RequestKey: requestKey, UserId: userId, EntryId: entryId,
			Quantity: quantity, AmountCny: amountCny, QuotaAmount: quotaAmount,
			Status: LeaderboardOrderCompleted, CreatedAt: now, UpdatedAt: now, CompletedAt: now,
		}
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota - ?", quotaAmount)).Error; err != nil {
			return err
		}
		var balance RenameCardBalance
		balanceQuery := lockForUpdate(tx).Where("user_id = ?", userId).Limit(1).Find(&balance)
		if balanceQuery.Error != nil {
			return balanceQuery.Error
		}
		if balanceQuery.RowsAffected == 0 {
			balance = RenameCardBalance{UserId: userId, Balance: quantity, UpdatedAt: now}
			if err := tx.Create(&balance).Error; err != nil {
				return err
			}
		} else if err := tx.Model(&balance).Updates(map[string]interface{}{
			"balance": gorm.Expr("balance + ?", quantity), "updated_at": now,
		}).Error; err != nil {
			return err
		}
		walletDelta = -quotaAmount
		saved = order
		return nil
	})
	if err != nil {
		return nil, err
	}
	if common.RedisEnabled && walletDelta != 0 {
		if err := cacheIncrUserQuota(userId, int64(walletDelta)); err != nil {
			common.SysLog("failed to update user quota cache after rename-card purchase: " + err.Error())
		}
	}
	return &saved, nil
}

func CreateSponsorOrder(requestKey string, userId int, entryId int, amountCny int, quotaAmount int, displayAnonymously bool, message string, now int64) (*SponsorOrder, error) {
	var saved SponsorOrder
	var walletDelta int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		var existing SponsorOrder
		query := tx.Where("request_key = ?", requestKey).Limit(1).Find(&existing)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			if existing.UserId != userId {
				return ErrQuotaLoanRequestConflict
			}
			saved = existing
			return nil
		}
		if user.Quota < quotaAmount {
			return ErrLeaderboardInsufficientQuota
		}
		order := SponsorOrder{
			Id: common.GetUUID(), RequestKey: requestKey, UserId: userId, EntryId: entryId,
			AmountCny: amountCny, QuotaAmount: quotaAmount, DisplayAnonymously: displayAnonymously,
			Message: message, Status: LeaderboardOrderCompleted,
			CreatedAt: now, UpdatedAt: now, CompletedAt: now,
		}
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota - ?", quotaAmount)).Error; err != nil {
			return err
		}
		walletDelta = -quotaAmount
		saved = order
		return nil
	})
	if err != nil {
		return nil, err
	}
	if common.RedisEnabled && walletDelta != 0 {
		if err := cacheIncrUserQuota(userId, int64(walletDelta)); err != nil {
			common.SysLog("failed to update user quota cache after sponsorship: " + err.Error())
		}
	}
	return &saved, nil
}

func GetQuotaLoanExposure(userId int) (int64, error) {
	var exposure int64
	err := DB.Model(&QuotaLoan{}).
		Where("user_id = ? AND status IN ?", userId, []string{QuotaLoanActive, QuotaLoanOverdue}).
		Select("COALESCE(SUM(outstanding_quota), 0)").Scan(&exposure).Error
	return exposure, err
}

func HasOverdueQuotaLoan(userId int, now int64) (bool, error) {
	var count int64
	err := DB.Model(&QuotaLoan{}).
		Where("user_id = ? AND status IN ? AND outstanding_quota > 0", userId, []string{QuotaLoanActive, QuotaLoanOverdue}).
		Where("(status = ? OR due_at < ?)", QuotaLoanOverdue, now).
		Count(&count).Error
	return count > 0, err
}

func MarkQuotaLoansOverdue(now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var dueLoans []QuotaLoan
		if err := lockForUpdate(tx).
			Select("id", "user_id").
			Where("status = ? AND outstanding_quota > 0 AND due_at < ?", QuotaLoanActive, now).
			Order("user_id asc, due_at asc, id asc").
			Find(&dueLoans).Error; err != nil {
			return err
		}
		if len(dueLoans) == 0 {
			return nil
		}
		userIds := make([]int, 0, len(dueLoans))
		seen := make(map[int]bool, len(dueLoans))
		for _, loan := range dueLoans {
			if seen[loan.UserId] {
				continue
			}
			seen[loan.UserId] = true
			userIds = append(userIds, loan.UserId)
		}
		return tx.Model(&QuotaLoan{}).
			Where("user_id IN ? AND status = ? AND outstanding_quota > 0", userIds, QuotaLoanActive).
			Updates(map[string]interface{}{"status": QuotaLoanOverdue, "updated_at": now}).Error
	})
}

func CreateQuotaLoan(requestKey string, userId int, entryId int, tierKey string, tierName string, creditAmount int, quotaAmount int, creditLimitQuota int, dueAt int64, now int64) (*QuotaLoan, error) {
	var saved QuotaLoan
	var walletDelta int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		var existing QuotaLoan
		query := tx.Where("request_key = ?", requestKey).Limit(1).Find(&existing)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			if existing.UserId != userId {
				return ErrQuotaLoanRequestConflict
			}
			saved = existing
			return nil
		}
		var pendingCount int64
		if err := tx.Model(&QuotaLoan{}).
			Where("user_id = ? AND status IN ?", userId, []string{LeaderboardOrderProcessing, LeaderboardOrderUnknown}).
			Count(&pendingCount).Error; err != nil {
			return err
		}
		if pendingCount > 0 {
			return ErrQuotaLoanPending
		}
		var openLoans []QuotaLoan
		if err := lockForUpdate(tx).
			Where("user_id = ? AND status IN ? AND outstanding_quota > 0", userId, []string{QuotaLoanActive, QuotaLoanOverdue}).
			Find(&openLoans).Error; err != nil {
			return err
		}
		var exposure int64
		for _, openLoan := range openLoans {
			if openLoan.Status == QuotaLoanOverdue || openLoan.DueAt < now {
				return ErrQuotaLoanOverdue
			}
			exposure += int64(openLoan.OutstandingQuota)
		}
		if exposure+int64(quotaAmount) > int64(creditLimitQuota) {
			return ErrQuotaLoanCreditExceeded
		}
		loan := QuotaLoan{
			Id: common.GetUUID(), RequestKey: requestKey, UserId: userId, EntryId: entryId,
			TierKey: tierKey, TierName: tierName, CreditAmount: creditAmount,
			QuotaAmount: quotaAmount, OutstandingQuota: quotaAmount,
			Status: QuotaLoanActive, CreatedAt: now, UpdatedAt: now, DueAt: dueAt,
		}
		if err := tx.Create(&loan).Error; err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota + ?", quotaAmount)).Error; err != nil {
			return err
		}
		walletDelta = quotaAmount
		saved = loan
		return nil
	})
	if err != nil {
		return nil, err
	}
	if common.RedisEnabled && walletDelta != 0 {
		if err := cacheIncrUserQuota(userId, int64(walletDelta)); err != nil {
			common.SysLog("failed to update user quota cache after quota loan: " + err.Error())
		}
	}
	return &saved, nil
}

func applyQuotaLoanRepaymentTx(tx *gorm.DB, userId int, sourceType string, sourceId string, availableQuota int, now int64) (int, error) {
	if availableQuota <= 0 {
		return 0, nil
	}
	var loans []QuotaLoan
	if err := lockForUpdate(tx).
		Where("user_id = ? AND status IN ? AND outstanding_quota > 0", userId, []string{QuotaLoanActive, QuotaLoanOverdue}).
		Order("due_at asc, created_at asc, id asc").Find(&loans).Error; err != nil {
		return 0, err
	}
	accountOverdue := false
	for _, loan := range loans {
		if loan.Status == QuotaLoanOverdue || loan.DueAt < now {
			accountOverdue = true
			break
		}
	}
	if accountOverdue {
		if err := tx.Model(&QuotaLoan{}).
			Where("user_id = ? AND status = ? AND outstanding_quota > 0", userId, QuotaLoanActive).
			Updates(map[string]interface{}{"status": QuotaLoanOverdue, "updated_at": now}).Error; err != nil {
			return 0, err
		}
		for index := range loans {
			if loans[index].Status == QuotaLoanActive {
				loans[index].Status = QuotaLoanOverdue
				loans[index].UpdatedAt = now
			}
		}
	}
	repaid := 0
	for index := range loans {
		if availableQuota <= 0 {
			break
		}
		loan := &loans[index]
		amount := min(availableQuota, loan.OutstandingQuota)
		before := loan.OutstandingQuota
		loan.OutstandingQuota -= amount
		loan.UpdatedAt = now
		if loan.OutstandingQuota == 0 {
			loan.Status = QuotaLoanSettled
			loan.CompletedAt = now
		}
		if err := tx.Save(loan).Error; err != nil {
			return 0, err
		}
		if err := tx.Create(&QuotaLoanEvent{
			Id: common.GetUUID(), LoanId: loan.Id, UserId: userId, EventType: "repayment",
			SourceType: sourceType, SourceId: sourceId, QuotaAmount: amount,
			OutstandingBefore: before, OutstandingAfter: loan.OutstandingQuota,
			RedemptionTime: now, Status: LeaderboardOrderCompleted, CreatedAt: now, UpdatedAt: now,
		}).Error; err != nil {
			return 0, err
		}
		availableQuota -= amount
		repaid += amount
	}
	return repaid, nil
}

func ApplyQuotaLoanRepaymentForRedemptionTx(tx *gorm.DB, userId int, redemptionId int, quota int, now int64) (int, error) {
	return applyQuotaLoanRepaymentTx(tx, userId, "redemption", strconv.Itoa(redemptionId), quota, now)
}

func ListUserQuotaLoans(userId int, limit int) ([]QuotaLoan, error) {
	var loans []QuotaLoan
	query := DB.Where("user_id = ?", userId).Order("created_at desc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&loans).Error
	return loans, err
}

func ListUserQuotaLoanEvents(userId int, limit int) ([]QuotaLoanEvent, error) {
	var events []QuotaLoanEvent
	query := DB.Where("user_id = ?", userId).Order("created_at desc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&events).Error
	return events, err
}

func ListAllQuotaLoans(limit int) ([]QuotaLoan, error) {
	var loans []QuotaLoan
	err := DB.Order("created_at desc").Limit(limit).Find(&loans).Error
	return loans, err
}

func ListAllQuotaLoanEvents(limit int) ([]QuotaLoanEvent, error) {
	var events []QuotaLoanEvent
	err := DB.Order("created_at desc").Limit(limit).Find(&events).Error
	return events, err
}

func IsLotteryPeriodSettled(ruleVersion int, periodKey string) (bool, error) {
	var count int64
	err := DB.Model(&LotteryPeriod{}).
		Where("rule_version = ? AND period_key = ?", ruleVersion, periodKey).
		Count(&count).Error
	return count > 0, err
}

func SettleLotteryPeriod(ruleVersion int, periodKey string, opportunities []LotteryOpportunity, now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var period LotteryPeriod
		query := lockForUpdate(tx).
			Where("rule_version = ? AND period_key = ?", ruleVersion, periodKey).
			Limit(1).Find(&period)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			return nil
		}
		for index := range opportunities {
			opportunity := opportunities[index]
			opportunity.RuleVersion = ruleVersion
			opportunity.PeriodKey = periodKey
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&opportunity).Error; err != nil {
				return err
			}
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&LotteryPeriod{
			RuleVersion: ruleVersion, PeriodKey: periodKey, SettledAt: now,
		}).Error
	})
}

func ListLotteryOpportunities(ruleVersion int) ([]LotteryOpportunity, error) {
	var opportunities []LotteryOpportunity
	err := DB.Where("rule_version = ?", ruleVersion).
		Order("period_key desc, draw_rank asc").Find(&opportunities).Error
	return opportunities, err
}

func ListLotteryDraws(ruleVersion int) ([]LotteryDraw, error) {
	var draws []LotteryDraw
	err := DB.Where("rule_version = ?", ruleVersion).
		Order("period_key desc, draw_rank asc").Find(&draws).Error
	return draws, err
}

func DrawLotteryPrize(opportunity LotteryOpportunity, amountUsd float64, quotaAmount int, now int64) (*LotteryDraw, error) {
	var saved LotteryDraw
	var walletDelta int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", opportunity.UserId).First(&user).Error; err != nil {
			return err
		}
		var existing LotteryDraw
		query := lockForUpdate(tx).
			Where("rule_version = ? AND period_key = ? AND draw_rank = ?", opportunity.RuleVersion, opportunity.PeriodKey, opportunity.DrawRank).
			Limit(1).Find(&existing)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			if existing.UserId != opportunity.UserId {
				return errors.New("lottery opportunity belongs to another user")
			}
			if existing.Status != LeaderboardOrderFailed {
				saved = existing
				return nil
			}
			existing.AmountUsd = amountUsd
			existing.QuotaAmount = quotaAmount
			existing.Status = LeaderboardOrderCompleted
			existing.ErrorMessage = ""
			existing.UpdatedAt = now
			existing.CompletedAt = now
			if err := tx.Save(&existing).Error; err != nil {
				return err
			}
			saved = existing
		} else {
			draw := LotteryDraw{
				Id: common.GetUUID(), RuleVersion: opportunity.RuleVersion,
				PeriodKey: opportunity.PeriodKey, DrawRank: opportunity.DrawRank,
				UserId: opportunity.UserId, EntryId: opportunity.EntryId,
				DisplayNameSnapshot: opportunity.DisplayNameSnapshot,
				AmountUsd:           amountUsd, QuotaAmount: quotaAmount,
				Status: LeaderboardOrderCompleted, CreatedAt: now, UpdatedAt: now, CompletedAt: now,
			}
			if err := tx.Create(&draw).Error; err != nil {
				return err
			}
			saved = draw
		}
		if err := tx.Model(&User{}).Where("id = ?", opportunity.UserId).
			Update("quota", gorm.Expr("quota + ?", quotaAmount)).Error; err != nil {
			return err
		}
		walletDelta = quotaAmount
		return nil
	})
	if err != nil {
		return nil, err
	}
	if common.RedisEnabled && walletDelta != 0 {
		if err := cacheIncrUserQuota(opportunity.UserId, int64(walletDelta)); err != nil {
			common.SysLog("failed to update user quota cache after lottery draw: " + err.Error())
		}
	}
	return &saved, nil
}

func ResolveUnknownLotteryDraw(id string, resolution string, message string, now int64) (*LotteryDraw, error) {
	var draw LotteryDraw
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ?", id).First(&draw).Error; err != nil {
			return err
		}
		if draw.Status != LeaderboardOrderUnknown {
			return errors.New("lottery draw does not need manual resolution")
		}
		draw.Status = resolution
		draw.ErrorMessage = message
		draw.UpdatedAt = now
		if resolution == LeaderboardOrderCompleted {
			draw.CompletedAt = now
		}
		return tx.Save(&draw).Error
	})
	return &draw, err
}

func ListSponsorOrders(userId int, limit int) ([]SponsorOrder, error) {
	var orders []SponsorOrder
	query := DB
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	err := query.Order("created_at desc").Limit(limit).Find(&orders).Error
	return orders, err
}

func ListRenameCardOrders(limit int) ([]RenameCardOrder, error) {
	var orders []RenameCardOrder
	err := DB.Order("created_at desc").Limit(limit).Find(&orders).Error
	return orders, err
}

func ListRenameEvents(limit int) ([]RenameEvent, error) {
	var events []RenameEvent
	err := DB.Order("created_at desc").Limit(limit).Find(&events).Error
	return events, err
}

func GetRenameCardOutstanding() (int64, error) {
	var outstanding int64
	err := DB.Model(&RenameCardBalance{}).Select("COALESCE(SUM(balance), 0)").Scan(&outstanding).Error
	return outstanding, err
}
