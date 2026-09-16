package controller

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetSelfMonthlyConsumption(c *gin.Context)  { getMonthlyConsumption(c, false) }
func AdminGetMonthlyConsumption(c *gin.Context) { getMonthlyConsumption(c, true) }

func getMonthlyConsumption(c *gin.Context, admin bool) {
	now := time.Now()
	period := now.In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01")
	start, end, err := model.BeijingConsumptionWindow(period)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userId, offset, limit, keyword := c.GetInt("id"), 0, 1, ""
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "authentication required"})
		return
	}
	if admin {
		userId = 0
		if raw := c.Query("user_id"); raw != "" {
			userId, err = strconv.Atoi(raw)
			if err != nil || userId <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user id"})
				return
			}
		}
		keyword = strings.TrimSpace(c.Query("keyword"))
		if len(keyword) > 128 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "search is too long"})
			return
		}
		page := common.GetPageQuery(c)
		if page.PageSize < 1 || page.Page < 1 || page.Page > 1000000 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid pagination"})
			return
		}
		offset, limit = page.GetStartIdx(), page.GetPageSize()
	}
	rows, total, err := model.ListMonthlyConsumption(start.Unix(), min(end.Unix(), now.Unix()+1), userId, keyword, offset, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"period": period, "as_of": now.Unix(), "quota_per_usd": common.QuotaPerUnit, "items": rows, "total": total})
}
