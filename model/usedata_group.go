package model

import (
	"github.com/QuantumNous/new-api/common"
)

type GroupQuotaData struct {
	UseGroup        string `json:"use_group" gorm:"column:use_group"`
	Count           int    `json:"count" gorm:"column:count"`
	InputTokens     int    `json:"input_tokens" gorm:"column:input_tokens"`
	OutputTokens    int    `json:"output_tokens" gorm:"column:output_tokens"`
	CacheReadTokens int    `json:"cache_read_tokens" gorm:"column:cache_read_tokens"`
	Quota           int    `json:"quota" gorm:"column:quota"`
}

func GetGroupQuotaData(startTime int64, endTime int64, username string, userID int, role int) ([]*GroupQuotaData, error) {
	query := DB.Table("quota_data").
		Where("use_group <> ''").
		Where("created_at >= ? and created_at <= ?", startTime, endTime)

	if role < common.RoleAdminUser {
		query = query.Where("user_id = ?", userID)
	} else if username != "" {
		query = query.Where("username = ?", username)
	}

	rows := make([]*GroupQuotaData, 0)
	err := query.
		Select("use_group, sum(count) as count, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_read_tokens) as cache_read_tokens, sum(quota) as quota").
		Group("use_group").
		Order("quota DESC").
		Find(&rows).Error
	return rows, err
}
