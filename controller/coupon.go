package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

type issueCouponRequest struct {
	UserIds               []int  `json:"user_ids"`
	Scope                 string `json:"scope"`
	Name                  string `json:"name"`
	ApplicableGroup       string `json:"applicable_group"`
	RatioPPM              int    `json:"ratio_ppm"`
	ValidForSeconds       int64  `json:"valid_for_seconds"`
	ActiveDurationSeconds int64  `json:"active_duration_seconds"`
	IdempotencyKey        string `json:"idempotency_key"`
}

type issueCouponsResponse struct {
	Items        []model.Coupon `json:"items"`
	IssuedCount  int            `json:"issued_count"`
	IssueBatchId string         `json:"issue_batch_id"`
}

func writeCouponError(c *gin.Context, err error) {
	code := "coupon_operation_failed"
	message := err.Error()
	switch {
	case errors.Is(err, model.ErrCouponNotFound):
		code = "coupon_not_found"
	case errors.Is(err, model.ErrCouponExpired):
		code = "coupon_expired"
	case errors.Is(err, model.ErrCouponAlreadyActivated):
		code = "coupon_already_activated"
	case errors.Is(err, model.ErrCouponActiveConflict):
		code = "coupon_active_conflict"
	case errors.Is(err, model.ErrCouponRevoked):
		code = "coupon_revoked"
	case errors.Is(err, model.ErrCouponIdempotencyConflict):
		code = "coupon_idempotency_conflict"
	}
	c.JSON(http.StatusOK, gin.H{"success": false, "message": message, "code": code})
}

func GetSelfCoupons(c *gin.Context) {
	coupons, err := model.GetUserCoupons(c.GetInt("id"), model.GetDBTimestamp())
	if err != nil {
		writeCouponError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": coupons})
}

func ActivateSelfCoupon(c *gin.Context) {
	couponId, err := strconv.Atoi(c.Param("id"))
	if err != nil || couponId <= 0 {
		writeCouponError(c, model.ErrCouponNotFound)
		return
	}
	coupon, err := model.ActivateCoupon(couponId, c.GetInt("id"), model.GetDBTimestamp())
	if err != nil {
		writeCouponError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": coupon})
}

func AdminGetUserCoupons(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("id"))
	if err != nil || userId <= 0 {
		writeCouponError(c, errors.New("invalid user id"))
		return
	}
	coupons, err := model.GetUserCoupons(userId, model.GetDBTimestamp())
	if err != nil {
		writeCouponError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": coupons})
}

func AdminListCoupons(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	coupons, total, err := model.GetAdminCoupons(
		c.Query("keyword"),
		pageInfo.GetStartIdx(),
		pageInfo.GetPageSize(),
		model.GetDBTimestamp(),
	)
	if err != nil {
		writeCouponError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(coupons)
	common.ApiSuccess(c, pageInfo)
}

func AdminIssueCoupons(c *gin.Context) {
	var req issueCouponRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeCouponError(c, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Scope = strings.TrimSpace(req.Scope)
	req.ApplicableGroup = strings.TrimSpace(req.ApplicableGroup)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.Scope == "" {
		req.Scope = "selected"
	}
	switch {
	case req.Scope != "selected" && req.Scope != "all":
		writeCouponError(c, errors.New("coupon recipient scope is invalid"))
		return
	case req.Scope == "selected" && (len(req.UserIds) == 0 || len(req.UserIds) > model.MaxCouponUsers):
		writeCouponError(c, errors.New("coupon recipients must contain between 1 and 1000 users"))
		return
	case req.Scope == "all" && len(req.UserIds) > 0:
		writeCouponError(c, errors.New("all-user issuance must not include user ids"))
		return
	case utf8.RuneCountInString(req.Name) == 0 || utf8.RuneCountInString(req.Name) > 64:
		writeCouponError(c, errors.New("coupon name must contain between 1 and 64 characters"))
		return
	case req.ApplicableGroup == "" || !ratio_setting.ContainsGroupRatio(req.ApplicableGroup):
		writeCouponError(c, errors.New("coupon applicable group does not exist"))
		return
	case req.RatioPPM <= 0 || req.RatioPPM > 1_000_000:
		writeCouponError(c, errors.New("coupon ratio must be greater than 0 and no greater than 1"))
		return
	case req.ValidForSeconds <= 0 || req.ValidForSeconds > model.MaxCouponValidForSeconds:
		writeCouponError(c, errors.New("coupon activation period is out of range"))
		return
	case req.ActiveDurationSeconds <= 0 || req.ActiveDurationSeconds > model.MaxCouponActiveDurationSeconds:
		writeCouponError(c, errors.New("coupon active duration is out of range"))
		return
	case len(req.IdempotencyKey) > 64:
		writeCouponError(c, errors.New("coupon idempotency key is too long"))
		return
	}

	batchId := common.GetUUID()
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = batchId
	}
	now := model.GetDBTimestamp()
	coupons, err := model.IssueCoupons(model.IssueCouponParams{
		UserIds:               req.UserIds,
		AllUsers:              req.Scope == "all",
		Name:                  req.Name,
		ApplicableGroup:       req.ApplicableGroup,
		RatioPPM:              req.RatioPPM,
		ValidForSeconds:       req.ValidForSeconds,
		ActiveDurationSeconds: req.ActiveDurationSeconds,
		IssuerId:              c.GetInt("id"),
		IssueBatchId:          batchId,
		IdempotencyKey:        req.IdempotencyKey,
		Now:                   now,
	})
	if err != nil {
		writeCouponError(c, err)
		return
	}
	responseBatchId := batchId
	if len(coupons) > 0 {
		responseBatchId = coupons[0].IssueBatchId
	}
	items := coupons
	if req.Scope == "all" {
		items = []model.Coupon{}
	}
	recordManageAudit(c, "coupon.issue", map[string]interface{}{
		"count":           len(coupons),
		"scope":           req.Scope,
		"group":           req.ApplicableGroup,
		"ratio_ppm":       req.RatioPPM,
		"activate_before": now + req.ValidForSeconds,
		"active_duration": req.ActiveDurationSeconds,
		"issue_batch_id":  responseBatchId,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": issueCouponsResponse{
		Items:        items,
		IssuedCount:  len(coupons),
		IssueBatchId: responseBatchId,
	}})
}

func AdminRevokeCoupon(c *gin.Context) {
	couponId, err := strconv.Atoi(c.Param("id"))
	if err != nil || couponId <= 0 {
		writeCouponError(c, model.ErrCouponNotFound)
		return
	}
	coupon, err := model.RevokeCoupon(couponId, c.GetInt("id"), model.GetDBTimestamp())
	if err != nil {
		writeCouponError(c, err)
		return
	}
	recordManageAudit(c, "coupon.revoke", map[string]interface{}{
		"coupon_id": coupon.Id,
		"user_id":   coupon.UserId,
		"group":     coupon.ApplicableGroup,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": coupon})
}
