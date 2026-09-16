package controller

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func AdminListMonthlyRebates(c *gin.Context) {
	period := c.Query("period")
	if _, _, err := model.MonthlyRebateWindow(period, time.Now()); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	status := c.Query("status")
	switch status {
	case "", model.MonthlyRebatePending, model.MonthlyRebateIneligible, model.MonthlyRebateIssued, model.MonthlyRebateFailed, model.MonthlyRebateNeedsReview:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid rebate status"})
		return
	}
	userId := 0
	if raw := c.Query("user_id"); raw != "" {
		var err error
		userId, err = strconv.Atoi(raw)
		if err != nil || userId <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user id"})
			return
		}
	}
	page := common.GetPageQuery(c)
	if page.PageSize < 1 {
		page.PageSize = 20
	}
	if page.Page > 1_000_000 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid page"})
		return
	}
	bills, total, summary, err := model.ListMonthlyRebates(period, status, userId, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": bills, "total": total, "summary": summary, "page": page.Page, "page_size": page.PageSize})
}

func AdminRecalculateMonthlyRebates(c *gin.Context) {
	var request struct {
		Period string `json:"period"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid rebate calculation request"})
		return
	}
	if _, _, err := model.MonthlyRebateWindow(request.Period, time.Now()); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	processed, err := model.RecalculateMonthlyRebates(request.Period, time.Now())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"processed": processed})
}

func AdminIssueMonthlyRebate(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid rebate id"})
		return
	}
	var request struct {
		Revision int64 `json:"revision"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Revision <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid rebate approval"})
		return
	}
	bill, err := model.IssueMonthlyRebate(id, request.Revision, c.GetInt("id"), time.Now())
	if errors.Is(err, model.ErrMonthlyRebateChanged) {
		c.JSON(http.StatusConflict, gin.H{"success": false, "code": "REBATE_CHANGED", "message": err.Error()})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, bill.UserId, "user.monthly_rebate_issue", map[string]interface{}{
		"rebate_id": bill.Id, "period": bill.Period, "quota": bill.IssuedQuota,
		"subscription_id": bill.SubscriptionId,
	})
	common.ApiSuccess(c, bill)
}
