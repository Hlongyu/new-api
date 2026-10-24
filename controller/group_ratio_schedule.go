package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func ListGroupRatioSchedules(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 || page > 100000 {
		page = 1
	}
	schedules := []model.GroupRatioSchedule{}
	query := model.DB.Model(&model.GroupRatioSchedule{})
	status := c.DefaultQuery("status", "pending")
	if status != "pending" && status != "history" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid schedule status"})
		return
	}
	if status == "pending" {
		query = query.Where("status = ?", model.GroupRatioSchedulePending).Order("execute_at, id")
	} else {
		query = query.Where("status <> ?", model.GroupRatioSchedulePending).Order("finished_at DESC, id DESC")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if err := query.Limit(20).Offset((page - 1) * 20).Find(&schedules).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": schedules, "total": total}})
}

func CreateGroupRatioSchedule(c *gin.Context) {
	var request struct {
		Group     string   `json:"group"`
		Ratio     *float64 `json:"ratio"`
		ExecuteAt int64    `json:"execute_at"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Ratio == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid group ratio schedule"})
		return
	}
	schedule, err := model.CreateGroupRatioSchedule(request.Group, *request.Ratio, request.ExecuteAt, c.GetInt("id"), time.Now().Unix())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "group_ratio_schedule.create", map[string]interface{}{"id": schedule.ID, "group": schedule.GroupName, "ratio": schedule.Ratio, "execute_at": schedule.ExecuteAt})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": schedule})
}

func CancelGroupRatioSchedule(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid schedule ID"})
		return
	}
	if err := model.CancelGroupRatioSchedule(id, time.Now().Unix()); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "group_ratio_schedule.cancel", map[string]interface{}{"id": id})
	c.JSON(http.StatusOK, gin.H{"success": true})
}
