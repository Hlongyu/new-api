package controller

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func rechargeLotteryError(c *gin.Context, err error) {
	status := service.RechargeLotteryErrorStatus(err)
	if status >= http.StatusInternalServerError && status != http.StatusServiceUnavailable {
		common.ApiError(c, err)
		return
	}
	c.JSON(status, gin.H{"success": false, "message": err.Error()})
}

func GetRechargeLotteryStatus(c *gin.Context) {
	payload, err := service.GetRechargeLotteryStatus(
		c.GetInt("id"), c.GetInt("role") >= common.RoleRootUser, c.Query("campaign_id"),
	)
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

func GetRechargeLotteryHistory(c *gin.Context) {
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	payload, err := service.ListRechargeLotteryHistory(c.GetInt("id"), c.Query("campaign_id"), max(offset, 0))
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

type rechargeLotteryDrawRequest struct {
	RequestKey string `json:"requestKey"`
	CampaignId string `json:"campaignId"`
	Count      int    `json:"count"`
}

func DrawRechargeLottery(c *gin.Context) {
	var request rechargeLotteryDrawRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	payload, created, err := service.DrawRechargeLottery(c.GetInt("id"), service.RechargeLotteryDrawRequest{
		RequestKey: request.RequestKey, CampaignId: request.CampaignId, Count: request.Count,
	})
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	c.JSON(status, gin.H{"success": true, "data": payload})
}

func GetRechargeLotteryAdminDashboard(c *gin.Context) {
	payload, err := service.GetRechargeLotteryAdminDashboard()
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

func GetRechargeLotteryEligibleUsers(c *gin.Context) {
	count, err := service.CountEligibleRechargeLotteryUsers()
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}

func SyncRechargeLotteryRedemptions(c *gin.Context) {
	payload, err := service.SyncRechargeLotteryRedemptions()
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

type rechargeLotteryCampaignRequest struct {
	Name     string                              `json:"name"`
	StartsAt json.RawMessage                     `json:"startsAt"`
	EndsAt   json.RawMessage                     `json:"endsAt"`
	Prizes   []service.RechargeLotteryPrizeInput `json:"prizes"`
}

func parseRechargeLotteryTimestamp(value json.RawMessage) (int64, error) {
	var timestamp int64
	if err := common.Unmarshal(value, &timestamp); err == nil {
		if timestamp > 0 {
			return timestamp, nil
		}
		return 0, &service.RechargeLotteryServiceError{Status: http.StatusBadRequest, Message: "活动时间无效"}
	}
	var text string
	if err := common.Unmarshal(value, &text); err != nil {
		return 0, &service.RechargeLotteryServiceError{Status: http.StatusBadRequest, Message: "活动时间无效"}
	}
	text = strings.TrimSpace(text)
	if parsed, err := time.Parse(time.RFC3339, text); err == nil {
		return parsed.Unix(), nil
	}
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return 0, err
	}
	if parsed, err := time.ParseInLocation("2006-01-02T15:04", text, location); err == nil {
		return parsed.Unix(), nil
	}
	if parsed, err := time.Parse("2006-01-02", text); err == nil {
		return parsed.Unix(), nil
	}
	return 0, &service.RechargeLotteryServiceError{Status: http.StatusBadRequest, Message: "活动时间无效"}
}

func CreateRechargeLotteryCampaign(c *gin.Context) {
	var request rechargeLotteryCampaignRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	startsAt, err := parseRechargeLotteryTimestamp(request.StartsAt)
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	endsAt, err := parseRechargeLotteryTimestamp(request.EndsAt)
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	payload, err := service.CreateRechargeLotteryCampaign(service.RechargeLotteryCampaignInput{
		Name: request.Name, StartsAt: startsAt, EndsAt: endsAt, Prizes: request.Prizes,
	}, c.GetInt("id"))
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": payload})
}

func PublishRechargeLotteryCampaign(c *gin.Context) {
	payload, err := service.PublishRechargeLotteryCampaign(c.Param("id"))
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

func EndRechargeLotteryCampaign(c *gin.Context) {
	if err := service.EndRechargeLotteryCampaign(c.Param("id")); err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func CancelRechargeLotteryCampaign(c *gin.Context) {
	if err := service.CancelRechargeLotteryCampaign(c.Param("id")); err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type rechargeLotteryGrantRequest struct {
	RequestKey            string `json:"requestKey"`
	CampaignId            string `json:"campaignId"`
	Quantity              int    `json:"quantity"`
	UserIds               []int  `json:"userIds"`
	SkipPreviouslyGranted bool   `json:"skipPreviouslyGranted"`
	Note                  string `json:"note"`
}

func createRechargeLotteryGrant(c *gin.Context, kind string) {
	var request rechargeLotteryGrantRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	payload, _, err := service.CreateRechargeLotteryGrantBatch(service.RechargeLotteryGrantInput{
		RequestKey: request.RequestKey, CampaignId: request.CampaignId, Kind: kind,
		Quantity: request.Quantity, UserIds: request.UserIds,
		SkipPreviouslyGranted: request.SkipPreviouslyGranted, Note: request.Note,
		OperatorUserId: c.GetInt("id"),
	})
	if err != nil {
		rechargeLotteryError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"success": true, "data": gin.H{"id": payload.Id, "status": payload.Status}})
}

func CreateRechargeLotteryGrant(c *gin.Context) {
	createRechargeLotteryGrant(c, "manual")
}

func CreateRechargeLotteryGrantAll(c *gin.Context) {
	createRechargeLotteryGrant(c, "all")
}

func RevokeRechargeLotteryGrant(c *gin.Context) {
	createRechargeLotteryGrant(c, "revoke")
}

func RetryRechargeLotteryFulfillment(c *gin.Context) {
	if err := service.RetryRechargeLotteryFulfillment(c.Param("id")); err != nil {
		rechargeLotteryError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
