package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetGroupMonthlyConsumption(c *gin.Context) {
	ownerID := c.GetInt("id")
	if ownerID <= 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	if c.GetInt("role") >= common.RoleAdminUser {
		ownerID = 0
	}
	period := c.DefaultQuery("month", time.Now().In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01"))
	start, end, err := model.BeijingConsumptionWindow(period)
	if err != nil || start.After(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid consumption month"})
		return
	}

	exclusions := map[string][]int{}
	raw := c.Query("group_exclusions")
	if c.Query("excluded_user_ids") != "" || len(raw) > 32768 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "use per-group exclusions"})
		return
	}
	if raw != "" {
		if err := common.UnmarshalJsonStr(raw, &exclusions); err != nil || exclusions == nil || len(exclusions) > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid group exclusions"})
			return
		}
	}
	for group, ids := range exclusions {
		if group == "" || len(group) > 64 || len(ids) > 500 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid group exclusions"})
			return
		}
		for _, id := range ids {
			if id <= 0 || id > 2147483647 {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid excluded user IDs"})
				return
			}
		}
	}
	filters := model.ConsumptionFilters{Group: c.Query("group"), Dimension: c.DefaultQuery("dimension", "group"), Source: c.DefaultQuery("source", "all"), GroupExclusions: exclusions}
	if raw := c.Query("user_id"); raw != "" {
		filters.UserID, err = strconv.Atoi(raw)
		if err != nil || filters.UserID <= 0 || filters.UserID > 2147483647 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user id"})
			return
		}
	}
	if len(filters.Group) > 64 || (filters.Dimension != "group" && filters.Dimension != "user") || (filters.Source != "all" && filters.Source != "wallet" && filters.Source != "subscription") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid consumption filters"})
		return
	}
	report, err := model.QueryPersistedConsumption(start.Unix(), end.Unix(), ownerID, filters)

	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"generated_at": report.GeneratedAt, "period": period, "quota_per_usd": common.QuotaPerUnit, "items": report.Items, "groups": report.Groups, "dimension": filters.Dimension, "source": filters.Source, "unattributed_requests": report.UnattributedRequests})
}
