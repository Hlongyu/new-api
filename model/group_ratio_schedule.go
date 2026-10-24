package model

import (
	"errors"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	GroupRatioSchedulePending   = "pending"
	GroupRatioScheduleSucceeded = "succeeded"
	GroupRatioScheduleCancelled = "cancelled"
	GroupRatioScheduleFailed    = "failed"
)

var ErrGroupRatioScheduleNotPending = errors.New("schedule not found or no longer pending")

// ExecuteAt is an absolute Unix timestamp. The management UI presents all times
// in Beijing time (UTC+8), independent of the browser and server time zones.
type GroupRatioSchedule struct {
	ID            int64    `json:"id" gorm:"primaryKey"`
	GroupName     string   `json:"group" gorm:"size:255"`
	Ratio         float64  `json:"ratio"`
	ExecuteAt     int64    `json:"execute_at" gorm:"index:idx_group_ratio_schedule_due,priority:2"`
	Status        string   `json:"status" gorm:"size:20;index:idx_group_ratio_schedule_due,priority:1"`
	CreatedBy     int      `json:"created_by"`
	CreatedAt     int64    `json:"created_at"`
	FinishedAt    int64    `json:"finished_at"`
	PreviousRatio *float64 `json:"previous_ratio"`
	Error         string   `json:"error" gorm:"type:text"`
}

func CreateGroupRatioSchedule(group string, ratio float64, executeAt int64, actor int, now int64) (*GroupRatioSchedule, error) {
	if strings.TrimSpace(group) == "" || len(group) > 255 {
		return nil, errors.New("select an existing group")
	}
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 {
		return nil, errors.New("ratio must be a finite non-negative number")
	}
	if executeAt <= now || executeAt > 253402271999 {
		return nil, errors.New("execution time must be in the future")
	}
	schedule := &GroupRatioSchedule{GroupName: group, Ratio: ratio, ExecuteAt: executeAt, Status: GroupRatioSchedulePending, CreatedBy: actor, CreatedAt: now}
	err := DB.Transaction(func(tx *gorm.DB) error {
		option, err := lockGroupRatioOption(tx)
		if err != nil {
			return err
		}
		var ratios map[string]float64
		if err := common.UnmarshalJsonStr(option.Value, &ratios); err != nil {
			return err
		}
		if _, exists := ratios[group]; !exists {
			return errors.New("group does not exist; save the group before scheduling a change")
		}
		var duplicates int64
		if err := tx.Model(&GroupRatioSchedule{}).Where("group_name = ? AND execute_at = ? AND status = ?", group, executeAt, GroupRatioSchedulePending).Count(&duplicates).Error; err != nil {
			return err
		}
		if duplicates > 0 {
			return errors.New("a pending change already exists for this group at this time")
		}
		return tx.Create(schedule).Error
	})
	return schedule, err
}

func CancelGroupRatioSchedule(id int64, now int64) error {
	result := DB.Model(&GroupRatioSchedule{}).Where("id = ? AND status = ?", id, GroupRatioSchedulePending).Updates(map[string]interface{}{"status": GroupRatioScheduleCancelled, "finished_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrGroupRatioScheduleNotPending
	}
	return nil
}

// ApplyNextGroupRatioSchedule serializes with manual ratio edits and other
// runners on the canonical option row. The ratio, its webhook outbox event and
// the terminal schedule state commit together. A failed transaction remains
// pending; a restart can safely retry it. Read the latest map, never a snapshot
// from when the schedule was created, so unrelated group edits are preserved.
func ApplyNextGroupRatioSchedule(now int64) (bool, error) {
	optionWriteMutex.Lock()
	defer optionWriteMutex.Unlock()
	var candidate GroupRatioSchedule
	result := DB.Where("status = ? AND execute_at <= ?", GroupRatioSchedulePending, now).Order("execute_at, id").Limit(1).Find(&candidate)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, nil
	}
	changed := false
	raw := ""
	err := DB.Transaction(func(tx *gorm.DB) error {
		option, err := lockGroupRatioOption(tx)
		if err != nil {
			return err
		}
		// Re-read the earliest row after acquiring the cross-instance lock. Two
		// runners must not apply different overdue changes in reverse order.
		var schedule GroupRatioSchedule
		due := lockForUpdate(tx).Where("status = ? AND execute_at <= ?", GroupRatioSchedulePending, now).Order("execute_at, id").Limit(1).Find(&schedule)
		if due.Error != nil {
			return due.Error
		}
		if due.RowsAffected == 0 {
			return nil
		}
		var ratios map[string]float64
		if err := common.UnmarshalJsonStr(option.Value, &ratios); err != nil {
			return err
		}
		old, exists := ratios[schedule.GroupName]
		values := map[string]interface{}{"status": GroupRatioScheduleSucceeded, "finished_at": now, "previous_ratio": old}
		if !exists {
			values["status"], values["error"], values["previous_ratio"] = GroupRatioScheduleFailed, "group no longer exists", nil
		}
		// Conditional transition also arbitrates cancellation on SQLite, which
		// does not support SELECT FOR UPDATE.
		result := tx.Model(&GroupRatioSchedule{}).Where("id = ? AND status = ?", schedule.ID, GroupRatioSchedulePending).Updates(values)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		changed = true
		if !exists {
			return nil
		}
		ratios[schedule.GroupName] = schedule.Ratio
		encoded, err := common.Marshal(ratios)
		if err != nil {
			return err
		}
		raw = string(encoded)
		if err := persistGroupRatioEvent(tx, raw); err != nil {
			return err
		}
		for _, key := range []string{"GroupRatio", groupRatioAlias} {
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&Option{Key: key, Value: raw}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	if raw != "" {
		for _, key := range []string{"GroupRatio", groupRatioAlias} {
			if err := updateOptionMap(key, raw); err != nil {
				return changed, err
			}
		}
	}
	return changed, nil
}
