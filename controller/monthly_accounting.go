package controller

import (
	"errors"
	"net/http"
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
	rows, err := model.ListAccountingMonths(now, year)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"start_period": model.AccountingStartPeriod, "year": year, "items": rows})
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
	common.ApiSuccess(c, gin.H{"snapshot": snapshot, "items": rows, "total": snapshot.UserCount})
}
