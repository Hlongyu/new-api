package controller

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func AdminGetMonthlyAccounting(c *gin.Context) {
	if c.GetInt("role") < common.RoleAdminUser {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	now := time.Now()
	year := now.In(time.FixedZone("Asia/Shanghai", 8*3600)).Year()
	if raw := c.Query("year"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 2026 || parsed > 9998 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid accounting year"})
			return
		}
		year = parsed
	}
	excludedIDs, err := model.GetAccountingExcludedUserIDs()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	rows, err := model.ListAccountingMonths(now, year, excludedIDs...)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"start_period": model.AccountingStartPeriod, "year": year, "items": rows, "excluded_user_ids": excludedIDs})
}

func AdminGetAccountingSnapshotUsers(c *gin.Context) {
	if c.GetInt("role") < common.RoleAdminUser {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	period := c.Query("period")
	if _, _, err := model.BeijingConsumptionWindow(period); err != nil || period < model.AccountingStartPeriod {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid snapshot period"})
		return
	}
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.Page > 1000000 || page.PageSize < 1 || page.PageSize > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid pagination"})
		return
	}
	var snapshot model.AccountingSnapshot
	if err := model.DB.Where("period = ?", period).First(&snapshot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "snapshot not found"})
			return
		}
		common.ApiError(c, err)
		return
	}
	rows, err := model.ListAccountingSnapshotUsers(period, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	snapshot.Status = snapshot.AccountingStatus()
	common.ApiSuccess(c, gin.H{"snapshot": snapshot, "items": rows, "total": snapshot.UserCount})
}

func AdminUpdateAccountingExcludedUsers(c *gin.Context) {
	if c.GetInt("role") < common.RoleAdminUser {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	var request struct {
		UserIDs []int `json:"user_ids"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 16384), &request); err != nil || request.UserIDs == nil || len(request.UserIDs) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid excluded user IDs"})
		return
	}
	seen := map[int]bool{}
	ids := make([]int, 0, len(request.UserIDs))
	for _, id := range request.UserIDs {
		if id <= 0 || id > 2147483647 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid excluded user ID"})
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	if len(ids) > 0 {
		var count int64
		if err := model.DB.Unscoped().Model(&model.User{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if count != int64(len(ids)) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "excluded user not found"})
			return
		}
	}
	if err := model.SetAccountingExcludedUserIDs(ids); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"excluded_user_ids": ids})
}
