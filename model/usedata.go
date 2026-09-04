package model

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const quotaDataTotalTokensExpr = "CASE WHEN input_tokens > 0 OR output_tokens > 0 OR cache_read_tokens > 0 THEN input_tokens + output_tokens ELSE token_used END"
const quotaDataLastSyncExpr = "CASE WHEN synced_at > 0 THEN synced_at ELSE created_at END"

// QuotaData 柱状图数据
type QuotaData struct {
	Id              int    `json:"id"`
	UserID          int    `json:"user_id" gorm:"index"`
	Username        string `json:"username" gorm:"index:idx_qdt_model_user_name,priority:2;size:64;default:''"`
	ModelName       string `json:"model_name" gorm:"index:idx_qdt_model_user_name,priority:1;size:64;default:''"`
	CreatedAt       int64  `json:"created_at" gorm:"bigint;index:idx_qdt_created_at,priority:2"`
	SyncedAt        int64  `json:"-" gorm:"bigint"`
	UseGroup        string `json:"use_group" gorm:"index;size:64;default:''"`
	TokenID         int    `json:"token_id" gorm:"index;default:0"`
	ChannelID       int    `json:"channel_id" gorm:"index;default:0"`
	NodeName        string `json:"node_name" gorm:"index;size:64;default:''"`
	TokenUsed       int    `json:"token_used" gorm:"default:0"`
	InputTokens     int    `json:"input_tokens" gorm:"default:0"`
	OutputTokens    int    `json:"output_tokens" gorm:"default:0"`
	CacheReadTokens int    `json:"cache_read_tokens" gorm:"default:0"`
	Count           int    `json:"count" gorm:"default:0"`
	Quota           int    `json:"quota" gorm:"default:0"`
}

type QuotaDataLogParams struct {
	UserID          int
	Username        string
	ModelName       string
	Quota           int
	CreatedAt       int64
	TokenUsed       int
	InputTokens     int
	OutputTokens    int
	CacheReadTokens int
	UseGroup        string
	TokenID         int
	ChannelID       int
	NodeName        string
}

func UpdateQuotaData() {
	for {
		if common.DataExportEnabled {
			common.SysLog("正在更新数据看板数据...")
			SaveQuotaDataCache()
		}
		time.Sleep(time.Duration(common.DataExportInterval) * time.Minute)
	}
}

var CacheQuotaData = make(map[string]*QuotaData)
var CacheQuotaDataLock = sync.Mutex{}
var quotaDataSyncState = struct {
	sync.RWMutex
	database *gorm.DB
	syncedAt int64
}{}

func GetQuotaDataLastSyncAt() int64 {
	quotaDataSyncState.RLock()
	defer quotaDataSyncState.RUnlock()
	if quotaDataSyncState.database != DB {
		return 0
	}
	return quotaDataSyncState.syncedAt
}

func logQuotaDataCache(quotaData *QuotaData) {
	key := fmt.Sprintf("%d\x00%s\x00%s\x00%d\x00%s\x00%d\x00%d\x00%s",
		quotaData.UserID,
		quotaData.Username,
		quotaData.ModelName,
		quotaData.CreatedAt,
		quotaData.UseGroup,
		quotaData.TokenID,
		quotaData.ChannelID,
		quotaData.NodeName,
	)
	count := quotaData.Count
	quota := quotaData.Quota
	tokenUsed := quotaData.TokenUsed
	cachedQuotaData, ok := CacheQuotaData[key]
	if ok {
		cachedQuotaData.Count += count
		cachedQuotaData.Quota += quota
		cachedQuotaData.TokenUsed += tokenUsed
		cachedQuotaData.InputTokens += quotaData.InputTokens
		cachedQuotaData.OutputTokens += quotaData.OutputTokens
		cachedQuotaData.CacheReadTokens += quotaData.CacheReadTokens
		quotaData = cachedQuotaData
	}
	CacheQuotaData[key] = quotaData
}

func LogQuotaData(params QuotaDataLogParams) {
	// 只精确到小时
	createdAt := params.CreatedAt - (params.CreatedAt % 3600)
	quotaData := &QuotaData{
		UserID:          params.UserID,
		Username:        params.Username,
		ModelName:       params.ModelName,
		CreatedAt:       createdAt,
		UseGroup:        params.UseGroup,
		TokenID:         params.TokenID,
		ChannelID:       params.ChannelID,
		NodeName:        params.NodeName,
		Count:           1,
		Quota:           params.Quota,
		TokenUsed:       params.TokenUsed,
		InputTokens:     params.InputTokens,
		OutputTokens:    params.OutputTokens,
		CacheReadTokens: params.CacheReadTokens,
	}

	CacheQuotaDataLock.Lock()
	defer CacheQuotaDataLock.Unlock()
	logQuotaDataCache(quotaData)
}

func SaveQuotaDataCache() {
	CacheQuotaDataLock.Lock()
	defer CacheQuotaDataLock.Unlock()
	size := len(CacheQuotaData)
	syncedAt := common.GetTimestamp()
	syncSucceeded := true
	// 如果缓存中有数据，就保存到数据库中
	// 1. 先查询数据库中是否有数据
	// 2. 如果有数据，就更新数据
	// 3. 如果没有数据，就插入数据
	for _, quotaData := range CacheQuotaData {
		quotaData.SyncedAt = syncedAt
		quotaDataDB := &QuotaData{}
		lookupErr := DB.Table("quota_data").
			Where("user_id = ? and username = ? and model_name = ? and created_at = ? and use_group = ? and token_id = ? and channel_id = ? and node_name = ?",
				quotaData.UserID, quotaData.Username, quotaData.ModelName, quotaData.CreatedAt, quotaData.UseGroup, quotaData.TokenID, quotaData.ChannelID, quotaData.NodeName).
			First(quotaDataDB).Error
		var saveErr error
		switch {
		case lookupErr == nil:
			saveErr = increaseQuotaData(quotaData)
		case errors.Is(lookupErr, gorm.ErrRecordNotFound):
			saveErr = DB.Table("quota_data").Create(quotaData).Error
		default:
			saveErr = lookupErr
		}
		if saveErr != nil {
			syncSucceeded = false
			common.SysLog(fmt.Sprintf("save quota data error: %s", saveErr))
		}
	}
	CacheQuotaData = make(map[string]*QuotaData)
	if syncSucceeded {
		quotaDataSyncState.Lock()
		quotaDataSyncState.database = DB
		quotaDataSyncState.syncedAt = syncedAt
		quotaDataSyncState.Unlock()
		common.SysLog(fmt.Sprintf("保存数据看板数据成功，共保存%d条数据", size))
	} else {
		common.SysLog(fmt.Sprintf("保存数据看板数据存在失败，共处理%d条数据", size))
	}
}

func increaseQuotaData(quotaData *QuotaData) error {
	return DB.Table("quota_data").
		Where("user_id = ? and username = ? and model_name = ? and created_at = ? and use_group = ? and token_id = ? and channel_id = ? and node_name = ?",
			quotaData.UserID, quotaData.Username, quotaData.ModelName, quotaData.CreatedAt, quotaData.UseGroup, quotaData.TokenID, quotaData.ChannelID, quotaData.NodeName).
		Updates(map[string]interface{}{
			"count":             gorm.Expr("count + ?", quotaData.Count),
			"quota":             gorm.Expr("quota + ?", quotaData.Quota),
			"token_used":        gorm.Expr("token_used + ?", quotaData.TokenUsed),
			"input_tokens":      gorm.Expr("input_tokens + ?", quotaData.InputTokens),
			"output_tokens":     gorm.Expr("output_tokens + ?", quotaData.OutputTokens),
			"cache_read_tokens": gorm.Expr("cache_read_tokens + ?", quotaData.CacheReadTokens),
			"synced_at":         quotaData.SyncedAt,
		}).Error
}

func GetQuotaDataByUsername(username string, startTime int64, endTime int64) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	// 从quota_data表中查询数据
	err = DB.Table("quota_data").
		Select(fmt.Sprintf("user_id, username, model_name, created_at, sum(count) as count, sum(quota) as quota, sum(%s) as token_used", quotaDataTotalTokensExpr)).
		Where("username = ? and created_at >= ? and created_at <= ?", username, startTime, endTime).
		Group("user_id, username, model_name, created_at").
		Find(&quotaDatas).Error
	return quotaDatas, err
}

func GetQuotaDataByUserId(userId int, startTime int64, endTime int64) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	// 从quota_data表中查询数据
	err = DB.Table("quota_data").
		Select(fmt.Sprintf("user_id, username, model_name, created_at, sum(count) as count, sum(quota) as quota, sum(%s) as token_used", quotaDataTotalTokensExpr)).
		Where("user_id = ? and created_at >= ? and created_at <= ?", userId, startTime, endTime).
		Group("user_id, username, model_name, created_at").
		Find(&quotaDatas).Error
	return quotaDatas, err
}

func GetQuotaDataGroupByUser(startTime int64, endTime int64) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	err = DB.Table("quota_data").
		Select(fmt.Sprintf("username, created_at, sum(count) as count, sum(quota) as quota, sum(%s) as token_used", quotaDataTotalTokensExpr)).
		Where("created_at >= ? and created_at <= ?", startTime, endTime).
		Group("username, created_at").
		Find(&quotaDatas).Error
	return quotaDatas, err
}

func GetAllQuotaDates(startTime int64, endTime int64, username string) (quotaData []*QuotaData, err error) {
	if username != "" {
		return GetQuotaDataByUsername(username, startTime, endTime)
	}
	var quotaDatas []*QuotaData
	// 从quota_data表中查询数据
	// only select model_name, sum(count) as count, sum(quota) as quota, model_name, created_at from quota_data group by model_name, created_at;
	//err = DB.Table("quota_data").Where("created_at >= ? and created_at <= ?", startTime, endTime).Find(&quotaDatas).Error
	err = DB.Table("quota_data").Select(fmt.Sprintf("model_name, sum(count) as count, sum(quota) as quota, sum(%s) as token_used, created_at", quotaDataTotalTokensExpr)).Where("created_at >= ? and created_at <= ?", startTime, endTime).Group("model_name, created_at").Find(&quotaDatas).Error
	return quotaDatas, err
}
