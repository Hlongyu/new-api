package model

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// MonthlyRecapSnapshot keeps the complete aggregate, never raw request metadata.
// A lease coordinates first reads and rebuilds across application instances.
type MonthlyRecapSnapshot struct {
	ID          int    `gorm:"primaryKey"`
	UserID      int    `gorm:"uniqueIndex:idx_recap_user_month_version,priority:1;not null"`
	Period      string `gorm:"type:varchar(7);uniqueIndex:idx_recap_user_month_version,priority:2;not null"`
	RuleVersion int    `gorm:"uniqueIndex:idx_recap_user_month_version,priority:3;not null"`
	Payload     string `gorm:"type:text"`
	LeaseToken  string `gorm:"type:varchar(36)"`
	LeaseUntil  int64
}

// LoadMonthlyRecapSnapshot preserves the previous payload during rebuilding.
// A failed or interrupted build can be retried without losing a saved recap.
func LoadMonthlyRecapSnapshot(ctx context.Context, userID int, period string, version int, rebuild bool, build func() (string, error)) (string, error) {
	row := MonthlyRecapSnapshot{UserID: userID, Period: period, RuleVersion: version, Payload: "", LeaseToken: ""}
	err := DB.WithContext(ctx).Where("user_id = ? AND period = ? AND rule_version = ?", userID, period, version).Take(&row).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	if err == nil && !rebuild && row.Payload != "" {
		return row.Payload, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return "", err
		}
	}
	token := uuid.NewString()
	for {
		if err := DB.WithContext(ctx).Where("user_id = ? AND period = ? AND rule_version = ?", userID, period, version).Take(&row).Error; err != nil {
			return "", err
		}
		if !rebuild && row.Payload != "" {
			return row.Payload, nil
		}
		claim := DB.WithContext(ctx).Model(&MonthlyRecapSnapshot{}).Where("id = ? AND lease_until <= ?", row.ID, time.Now().Unix())
		if !rebuild {
			claim = claim.Where("payload = ?", "")
		}
		claimed := claim.Updates(map[string]interface{}{"lease_token": token, "lease_until": time.Now().Add(time.Minute).Unix()})
		if claimed.Error != nil {
			return "", claimed.Error
		}
		if claimed.RowsAffected == 1 {
			break
		}
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		DB.WithContext(cleanup).Model(&MonthlyRecapSnapshot{}).Where("id = ? AND lease_token = ?", row.ID, token).Updates(map[string]interface{}{"lease_token": "", "lease_until": 0})
	}()
	payload, err := build()
	if err != nil {
		return "", err
	}
	saved := DB.WithContext(ctx).Model(&MonthlyRecapSnapshot{}).Where("id = ? AND lease_token = ?", row.ID, token).Updates(map[string]interface{}{"payload": payload, "lease_token": "", "lease_until": 0})
	if saved.Error != nil {
		return "", saved.Error
	}
	if saved.RowsAffected != 1 {
		return "", errors.New("monthly recap calculation lease expired")
	}
	return payload, nil
}
