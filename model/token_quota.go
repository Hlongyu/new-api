package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	TokenQuotaPeriodFiveHour = "five_hour"
	TokenQuotaPeriodDaily    = "daily"
	TokenQuotaPeriodWeekly   = "weekly"

	BillingAllocationSubscription = "subscription"
	BillingAllocationWallet       = "wallet"
)

type TokenQuotaUsage struct {
	Id          int64  `json:"id" gorm:"primaryKey"`
	TokenId     int    `json:"token_id" gorm:"uniqueIndex:idx_token_quota_window,priority:1;index"`
	Period      string `json:"period" gorm:"type:varchar(16);uniqueIndex:idx_token_quota_window,priority:2"`
	WindowStart int64  `json:"window_start" gorm:"type:bigint;uniqueIndex:idx_token_quota_window,priority:3;index"`
	UsedQuota   int64  `json:"used_quota" gorm:"type:bigint;not null;default:0"`
}

type TokenQuotaUsageState struct {
	FiveHourUsed    int64 `json:"five_hour_used"`
	FiveHourResetAt int64 `json:"five_hour_reset_at"`
	DailyUsed       int64 `json:"daily_used"`
	DailyResetAt    int64 `json:"daily_reset_at"`
	WeeklyUsed      int64 `json:"weekly_used"`
	WeeklyResetAt   int64 `json:"weekly_reset_at"`
}

type TokenQuotaExceededError struct {
	Period  string
	Limit   int64
	Used    int64
	ResetAt int64
}

func (e *TokenQuotaExceededError) Error() string {
	return fmt.Sprintf("token %s quota exceeded: used=%d limit=%d reset_at=%d", e.Period, e.Used, e.Limit, e.ResetAt)
}

func (e *TokenQuotaExceededError) Unwrap() error {
	switch e.Period {
	case TokenQuotaPeriodFiveHour:
		return ErrTokenFiveHourQuotaExceeded
	case TokenQuotaPeriodWeekly:
		return ErrTokenWeeklyQuotaExceeded
	default:
		return ErrTokenDailyQuotaExceeded
	}
}

func tokenQuotaPeriodDuration(period string) int64 {
	switch period {
	case TokenQuotaPeriodFiveHour:
		return int64(5 * time.Hour / time.Second)
	case TokenQuotaPeriodWeekly:
		return int64(7 * 24 * time.Hour / time.Second)
	default:
		return int64(24 * time.Hour / time.Second)
	}
}

func tokenQuotaPeriods() [3]string {
	return [3]string{TokenQuotaPeriodFiveHour, TokenQuotaPeriodDaily, TokenQuotaPeriodWeekly}
}

func tokenQuotaLimit(token *Token, period string) int {
	switch period {
	case TokenQuotaPeriodFiveHour:
		return token.FiveHourQuota
	case TokenQuotaPeriodWeekly:
		return token.WeeklyQuota
	default:
		return token.DailyQuota
	}
}

func applyTokenQuotaUsageState(state TokenQuotaUsageState, usage TokenQuotaUsage) TokenQuotaUsageState {
	resetAt := usage.WindowStart + tokenQuotaPeriodDuration(usage.Period)
	switch usage.Period {
	case TokenQuotaPeriodFiveHour:
		state.FiveHourUsed = usage.UsedQuota
		state.FiveHourResetAt = resetAt
	case TokenQuotaPeriodWeekly:
		state.WeeklyUsed = usage.UsedQuota
		state.WeeklyResetAt = resetAt
	default:
		state.DailyUsed = usage.UsedQuota
		state.DailyResetAt = resetAt
	}
	return state
}

func GetTokenQuotaUsageState(tokenId int, at int64) (TokenQuotaUsageState, error) {
	states, err := GetTokenQuotaUsageStates([]int{tokenId}, at)
	if err != nil {
		return TokenQuotaUsageState{}, err
	}
	return states[tokenId], nil
}

func GetTokenQuotaUsageStates(tokenIds []int, at int64) (map[int]TokenQuotaUsageState, error) {
	states := make(map[int]TokenQuotaUsageState, len(tokenIds))
	if len(tokenIds) == 0 {
		return states, nil
	}
	var rows []TokenQuotaUsage
	err := DB.Where("token_id IN ? AND period IN ? AND window_start <= ? AND window_start > ?",
		tokenIds, tokenQuotaPeriods(), at, at-tokenQuotaPeriodDuration(TokenQuotaPeriodWeekly)).
		Order("window_start desc, id desc").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		key := fmt.Sprintf("%d:%s", row.TokenId, row.Period)
		if _, ok := seen[key]; ok {
			continue
		}
		if row.WindowStart+tokenQuotaPeriodDuration(row.Period) <= at {
			continue
		}
		states[row.TokenId] = applyTokenQuotaUsageState(states[row.TokenId], row)
		seen[key] = struct{}{}
	}
	return states, nil
}

func CheckTokenQuotaLimits(token *Token, at int64) error {
	if token == nil || (token.FiveHourQuota <= 0 && token.DailyQuota <= 0 && token.WeeklyQuota <= 0) {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var current Token
		if err := lockForUpdate(tx).Where("id = ?", token.Id).First(&current).Error; err != nil {
			return err
		}
		state := TokenQuotaUsageState{}
		for _, period := range tokenQuotaPeriods() {
			limit := tokenQuotaLimit(&current, period)
			if limit <= 0 {
				continue
			}
			var usage TokenQuotaUsage
			query := lockForUpdate(tx).Where("token_id = ? AND period = ?", current.Id, period).
				Order("window_start desc, id desc").Limit(1).Find(&usage)
			if query.Error != nil {
				return query.Error
			}
			if query.RowsAffected == 0 || usage.WindowStart+tokenQuotaPeriodDuration(period) <= at {
				usage = TokenQuotaUsage{TokenId: current.Id, Period: period, WindowStart: at}
				if err := tx.Create(&usage).Error; err != nil {
					return err
				}
			}
			state = applyTokenQuotaUsageState(state, usage)
		}

		checks := []struct {
			period  string
			limit   int
			used    int64
			resetAt int64
		}{
			{TokenQuotaPeriodFiveHour, current.FiveHourQuota, state.FiveHourUsed, state.FiveHourResetAt},
			{TokenQuotaPeriodDaily, current.DailyQuota, state.DailyUsed, state.DailyResetAt},
			{TokenQuotaPeriodWeekly, current.WeeklyQuota, state.WeeklyUsed, state.WeeklyResetAt},
		}
		for _, check := range checks {
			if check.limit > 0 && check.used >= int64(check.limit) {
				return &TokenQuotaExceededError{
					Period: check.period, Limit: int64(check.limit), Used: check.used, ResetAt: check.resetAt,
				}
			}
		}
		return nil
	})
}

func ResetTokenQuotaUsage(tokenId int, userId int) error {
	if tokenId <= 0 || userId <= 0 {
		return errors.New("invalid token quota reset parameters")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var token Token
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", tokenId, userId).First(&token).Error; err != nil {
			return err
		}
		if err := tx.Where("token_id = ?", tokenId).Delete(&TokenQuotaUsage{}).Error; err != nil {
			return err
		}
		return nil
	})
}

type PostpaidSettlement struct {
	Id                int64  `json:"id" gorm:"primaryKey"`
	RequestId         string `json:"request_id" gorm:"type:varchar(64);uniqueIndex"`
	UserId            int    `json:"user_id" gorm:"index"`
	TokenId           int    `json:"token_id" gorm:"index"`
	ActualQuota       int    `json:"actual_quota" gorm:"not null;default:0"`
	SubscriptionQuota int    `json:"subscription_quota" gorm:"not null;default:0"`
	WalletQuota       int    `json:"wallet_quota" gorm:"not null;default:0"`
	StartedAt         int64  `json:"started_at" gorm:"type:bigint;not null"`
	CreatedAt         int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt         int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

type PostpaidSettlementAllocation struct {
	Id           int64  `json:"id" gorm:"primaryKey"`
	SettlementId int64  `json:"settlement_id" gorm:"uniqueIndex:idx_settlement_source,priority:1;index"`
	Source       string `json:"source" gorm:"type:varchar(16);uniqueIndex:idx_settlement_source,priority:2"`
	SourceId     int    `json:"source_id" gorm:"uniqueIndex:idx_settlement_source,priority:3"`
	Quota        int    `json:"quota" gorm:"not null;default:0"`
}

type PostpaidSettlementParams struct {
	RequestId string
	UserId    int
	TokenId   int
	TokenKey  string
	Quota     int
	StartedAt int64
}

type PostpaidSettlementResult struct {
	SettlementId      int64
	ActualQuota       int
	SubscriptionQuota int
	WalletQuota       int
	AppliedDelta      int
	WalletDelta       int
}

func addPostpaidAllocationTx(tx *gorm.DB, settlementId int64, source string, sourceId int, delta int) error {
	if delta == 0 {
		return nil
	}
	var allocation PostpaidSettlementAllocation
	query := lockForUpdate(tx).Where("settlement_id = ? AND source = ? AND source_id = ?", settlementId, source, sourceId).Limit(1).Find(&allocation)
	if query.Error != nil {
		return query.Error
	}
	if query.RowsAffected == 0 {
		if delta < 0 {
			return errors.New("postpaid allocation refund exceeds charged quota")
		}
		return tx.Create(&PostpaidSettlementAllocation{
			SettlementId: settlementId,
			Source:       source,
			SourceId:     sourceId,
			Quota:        delta,
		}).Error
	}
	if allocation.Quota+delta < 0 {
		return errors.New("postpaid allocation refund exceeds charged quota")
	}
	allocation.Quota += delta
	return tx.Save(&allocation).Error
}

func consumePostpaidFundingTx(tx *gorm.DB, settlement *PostpaidSettlement, quota int, now int64) (subscriptionQuota int, walletQuota int, err error) {
	remaining := quota
	var subscriptions []UserSubscription
	if err = lockForUpdate(tx).
		Where("user_id = ? AND status = ? AND start_time <= ? AND end_time > ?", settlement.UserId, "active", now, now).
		Order("end_time asc, id asc").
		Find(&subscriptions).Error; err != nil {
		return 0, 0, err
	}
	for _, candidate := range subscriptions {
		if remaining <= 0 {
			break
		}
		subscription := candidate
		if resetErr := maybeResetUserSubscriptionTx(tx, &subscription, now); resetErr != nil {
			return 0, 0, resetErr
		}

		take := remaining
		if subscription.AmountTotal > 0 {
			available := subscription.AmountTotal - subscription.AmountUsed
			if available <= 0 {
				continue
			}
			if int64(take) > available {
				take = int(available)
			}
		}
		subscription.AmountUsed += int64(take)
		if err = tx.Save(&subscription).Error; err != nil {
			return 0, 0, err
		}
		if err = addPostpaidAllocationTx(tx, settlement.Id, BillingAllocationSubscription, subscription.Id, take); err != nil {
			return 0, 0, err
		}
		subscriptionQuota += take
		remaining -= take
	}

	if remaining > 0 {
		result := tx.Model(&User{}).Where("id = ?", settlement.UserId).
			Update("quota", gorm.Expr("quota - ?", remaining))
		if result.Error != nil {
			return 0, 0, result.Error
		}
		if result.RowsAffected == 0 {
			return 0, 0, errors.New("postpaid wallet user not found")
		}
		if err = addPostpaidAllocationTx(tx, settlement.Id, BillingAllocationWallet, settlement.UserId, remaining); err != nil {
			return 0, 0, err
		}
		walletQuota = remaining
	}
	return subscriptionQuota, walletQuota, nil
}

func refundPostpaidFundingTx(tx *gorm.DB, settlement *PostpaidSettlement, quota int) (subscriptionRefund int, walletRefund int, err error) {
	remaining := quota
	var walletAllocation PostpaidSettlementAllocation
	query := lockForUpdate(tx).
		Where("settlement_id = ? AND source = ?", settlement.Id, BillingAllocationWallet).
		Limit(1).Find(&walletAllocation)
	if query.Error != nil {
		return 0, 0, query.Error
	}
	if query.RowsAffected > 0 && walletAllocation.Quota > 0 {
		walletRefund = min(remaining, walletAllocation.Quota)
		if err = tx.Model(&User{}).Where("id = ?", settlement.UserId).
			Update("quota", gorm.Expr("quota + ?", walletRefund)).Error; err != nil {
			return 0, 0, err
		}
		if err = addPostpaidAllocationTx(tx, settlement.Id, BillingAllocationWallet, settlement.UserId, -walletRefund); err != nil {
			return 0, 0, err
		}
		remaining -= walletRefund
	}

	if remaining <= 0 {
		return 0, walletRefund, nil
	}
	var subscriptionAllocations []PostpaidSettlementAllocation
	if err = lockForUpdate(tx).
		Where("settlement_id = ? AND source = ? AND quota > 0", settlement.Id, BillingAllocationSubscription).
		Order("id desc").Find(&subscriptionAllocations).Error; err != nil {
		return 0, 0, err
	}
	for _, allocation := range subscriptionAllocations {
		if remaining <= 0 {
			break
		}
		allocationRefund := min(remaining, allocation.Quota)
		var subscription UserSubscription
		if err = lockForUpdate(tx).Where("id = ?", allocation.SourceId).First(&subscription).Error; err != nil {
			return 0, 0, err
		}
		counterRefund := allocationRefund
		if int64(counterRefund) > subscription.AmountUsed {
			counterRefund = int(subscription.AmountUsed)
		}
		subscription.AmountUsed -= int64(counterRefund)
		if err = tx.Save(&subscription).Error; err != nil {
			return 0, 0, err
		}
		if err = addPostpaidAllocationTx(tx, settlement.Id, BillingAllocationSubscription, subscription.Id, -allocationRefund); err != nil {
			return 0, 0, err
		}
		subscriptionRefund += allocationRefund
		remaining -= allocationRefund
	}
	if remaining != 0 {
		return 0, 0, errors.New("postpaid refund exceeds allocated quota")
	}
	return subscriptionRefund, walletRefund, nil
}

func adjustTokenQuotaUsageTx(tx *gorm.DB, tokenId int, delta int, startedAt int64, now int64) error {
	if tokenId <= 0 || delta == 0 {
		return nil
	}
	var token Token
	if err := lockForUpdate(tx).Where("id = ?", tokenId).First(&token).Error; err != nil {
		return err
	}
	newRemain := token.RemainQuota
	newOverage := token.QuotaOverage
	newUsed := token.UsedQuota + delta
	if newUsed < 0 {
		newUsed = 0
	}
	if !token.UnlimitedQuota {
		if delta > 0 {
			available := max(newRemain, 0)
			consumedFromRemain := min(delta, available)
			newRemain = available - consumedFromRemain
			newOverage += delta - consumedFromRemain
		} else {
			refund := -delta
			overageRefund := min(refund, newOverage)
			newOverage -= overageRefund
			newRemain = max(newRemain, 0) + refund - overageRefund
		}
	}
	updates := map[string]interface{}{
		"remain_quota":  newRemain,
		"used_quota":    newUsed,
		"quota_overage": newOverage,
		"accessed_time": now,
	}
	if err := tx.Model(&Token{}).Where("id = ?", tokenId).Updates(updates).Error; err != nil {
		return err
	}
	for _, period := range tokenQuotaPeriods() {
		if tokenQuotaLimit(&token, period) <= 0 {
			continue
		}
		var usage TokenQuotaUsage
		query := lockForUpdate(tx).
			Where("token_id = ? AND period = ? AND window_start <= ?", tokenId, period, startedAt).
			Order("window_start desc, id desc").Limit(1).Find(&usage)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected == 0 || usage.WindowStart+tokenQuotaPeriodDuration(period) <= startedAt {
			if delta < 0 {
				continue
			}
			usage = TokenQuotaUsage{TokenId: tokenId, Period: period, WindowStart: startedAt}
		}
		usage.UsedQuota += int64(delta)
		if usage.UsedQuota < 0 {
			usage.UsedQuota = 0
		}
		if err := tx.Save(&usage).Error; err != nil {
			return err
		}
	}
	return nil
}

func SettlePostpaidRequest(params PostpaidSettlementParams) (*PostpaidSettlementResult, error) {
	if params.UserId <= 0 || params.Quota < 0 {
		return nil, errors.New("invalid postpaid settlement parameters")
	}
	if params.RequestId == "" {
		return nil, errors.New("postpaid settlement request id is empty")
	}
	now := GetDBTimestamp()
	if params.StartedAt <= 0 {
		params.StartedAt = now
	}
	result := &PostpaidSettlementResult{}

	err := DB.Transaction(func(tx *gorm.DB) error {
		candidate := PostpaidSettlement{
			RequestId: params.RequestId,
			UserId:    params.UserId,
			TokenId:   params.TokenId,
			StartedAt: params.StartedAt,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate).Error; err != nil {
			return err
		}
		var settlement PostpaidSettlement
		if err := lockForUpdate(tx).Where("request_id = ?", params.RequestId).First(&settlement).Error; err != nil {
			return err
		}
		if settlement.UserId != params.UserId || settlement.TokenId != params.TokenId || settlement.StartedAt != params.StartedAt {
			return errors.New("postpaid settlement request id conflicts with existing request")
		}

		delta := params.Quota - settlement.ActualQuota
		walletDelta := 0
		if delta > 0 {
			subscriptionQuota, walletQuota, err := consumePostpaidFundingTx(tx, &settlement, delta, now)
			if err != nil {
				return err
			}
			settlement.SubscriptionQuota += subscriptionQuota
			settlement.WalletQuota += walletQuota
			walletDelta = walletQuota
		} else if delta < 0 {
			subscriptionRefund, walletRefund, err := refundPostpaidFundingTx(tx, &settlement, -delta)
			if err != nil {
				return err
			}
			settlement.SubscriptionQuota -= subscriptionRefund
			settlement.WalletQuota -= walletRefund
			walletDelta = -walletRefund
		}
		if err := adjustTokenQuotaUsageTx(tx, params.TokenId, delta, params.StartedAt, now); err != nil {
			return err
		}
		settlement.ActualQuota = params.Quota
		settlement.UpdatedAt = now
		if err := tx.Save(&settlement).Error; err != nil {
			return err
		}
		result.SettlementId = settlement.Id
		result.ActualQuota = settlement.ActualQuota
		result.SubscriptionQuota = settlement.SubscriptionQuota
		result.WalletQuota = settlement.WalletQuota
		result.AppliedDelta = delta
		result.WalletDelta = walletDelta
		return nil
	})
	if err != nil {
		return nil, err
	}

	if common.RedisEnabled {
		if result.WalletDelta != 0 {
			if err := cacheIncrUserQuota(params.UserId, int64(-result.WalletDelta)); err != nil {
				common.SysLog("failed to update user quota cache after postpaid settlement: " + err.Error())
			}
		}
		if params.TokenKey != "" && result.AppliedDelta != 0 {
			if err := cacheDeleteToken(params.TokenKey); err != nil {
				common.SysLog("failed to invalidate token cache after postpaid settlement: " + err.Error())
			}
		}
	}
	return result, nil
}
