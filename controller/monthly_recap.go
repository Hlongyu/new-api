package controller

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetSelfMonthlyRecap(c *gin.Context) { getMonthlyRecap(c, false, false) }

func AdminGetMonthlyRecap(c *gin.Context) { getMonthlyRecap(c, true, false) }

func AdminRebuildMonthlyRecap(c *gin.Context) { getMonthlyRecap(c, true, true) }

func getMonthlyRecap(c *gin.Context, admin, rebuild bool) {
	userID := c.GetInt("id")
	if userID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "authentication required"})
		return
	}

	if admin {
		if c.GetInt("role") < common.RoleAdminUser {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "admin access required"})
			return
		}
		selectedID, err := strconv.Atoi(c.Query("user_id"))
		if err != nil || selectedID <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user id"})
			return
		}
		userID = selectedID
	}
	now := time.Now()
	beijingNow := now.In(time.FixedZone("Asia/Shanghai", 8*3600))
	latest := time.Date(beijingNow.Year(), beijingNow.Month(), 1, 0, 0, 0, 0, beijingNow.Location()).AddDate(0, -1, 0)
	period := c.DefaultQuery("month", latest.Format("2006-01"))
	start, end, err := model.BeijingConsumptionWindow(period)
	if err != nil || now.Before(end) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid recap month"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	var subject *model.MonthlyRecapUser
	if admin {
		subject, err = model.GetMonthlyRecapUser(ctx, userID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "user not found"})
			return
		}
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}
	result, err := service.GetSavedMonthlyRecap(ctx, userID, start, end, now, rebuild)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	result.Subject = subject
	c.Header("Cache-Control", "private, no-store")
	common.ApiSuccess(c, result)
}

func AdminListMonthlyRecapUsers(c *gin.Context) {
	if c.GetInt("id") <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "authentication required"})
		return
	}
	if c.GetInt("role") < common.RoleAdminUser {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "admin access required"})
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	keyword := strings.TrimSpace(c.Query("keyword"))
	if err != nil || page < 1 || page > 1000000 || len(keyword) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid recap user query"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	users, total, err := model.ListMonthlyRecapUsers(ctx, keyword, page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	common.ApiSuccess(c, gin.H{"items": users, "total": total, "page": page, "page_size": 20})
}
