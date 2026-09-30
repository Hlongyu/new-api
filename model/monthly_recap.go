package model

import (
	"context"
	"errors"
)

// VisitMonthlyRecapLogs streams only the authenticated user's selected groups.
// The service receives billing metadata; the API returns only aggregates.
func VisitMonthlyRecapLogs(ctx context.Context, userID int, groups []string, start, end int64, visit func(Log) error) error {
	if userID <= 0 || end <= start || len(groups) == 0 {
		return errors.New("invalid monthly recap scope")
	}
	query := LOG_DB.WithContext(ctx).Model(&Log{}).
		Select("created_at, type, model_name, prompt_tokens, completion_tokens, quota, use_time, "+logGroupCol+", other").
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start, end).
		Where(logGroupCol+" IN ?", groups).Where("type IN ?", []int{LogTypeConsume, LogTypeError})
	rows, err := query.Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var log Log
		if err := LOG_DB.ScanRows(rows, &log); err != nil {
			return err
		}
		if err := visit(log); err != nil {
			return err
		}
	}
	return rows.Err()
}

func MonthlyRecapRecordedRequests(ctx context.Context, userID int, groups []string, start, end int64) (int64, error) {
	var count int64
	err := DB.WithContext(ctx).Model(&QuotaData{}).Where("user_id = ? AND use_group IN ? AND created_at >= ? AND created_at < ?", userID, groups, start, end).
		Select("COALESCE(SUM(count), 0)").Scan(&count).Error
	return count, err
}

// MonthlyRecapUser exposes only the identity needed by the admin recap picker.
type MonthlyRecapUser struct {
	ID          int    `json:"id" gorm:"column:id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

func ListMonthlyRecapUsers(ctx context.Context, keyword string, page int) ([]MonthlyRecapUser, int64, error) {
	users := make([]MonthlyRecapUser, 0)
	if page < 1 || page > 1000000 || len(keyword) > 128 {
		return users, 0, errors.New("invalid recap user query")
	}
	query := DB.WithContext(ctx).Model(&User{})
	if keyword != "" {
		query = query.Where("username LIKE ? OR display_name LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Select("id, username, display_name").Order("id ASC").Offset((page - 1) * 20).Limit(20).Scan(&users).Error
	return users, total, err
}

func GetMonthlyRecapUser(ctx context.Context, id int) (*MonthlyRecapUser, error) {
	var user MonthlyRecapUser
	err := DB.WithContext(ctx).Model(&User{}).Select("id, username, display_name").Where("id = ?", id).Take(&user).Error
	return &user, err
}
