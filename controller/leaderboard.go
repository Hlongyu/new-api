package controller

import (
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

var leaderboardRequestKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func GetLeaderboardUsage(c *gin.Context) {
	payload, err := service.GetUsageBoard(c.DefaultQuery("period", "day"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, payload)
}

func GetLeaderboardRanks(c *gin.Context) {
	payload, err := service.GetTierBoard()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

func GetLeaderboardMe(c *gin.Context) {
	payload, err := service.GetLeaderboardMe(c.GetInt("id"), c.GetInt("role") >= common.RoleRootUser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

type leaderboardVisibilityRequest struct {
	ParticipateDay   *bool `json:"participateDay"`
	ParticipateWeek  *bool `json:"participateWeek"`
	ParticipateMonth *bool `json:"participateMonth"`
	ParticipateAll   *bool `json:"participateAll"`
	ParticipateRank  *bool `json:"participateRank"`
	ShowRankBadge    *bool `json:"showRankBadge"`
}

type updateLeaderboardMeRequest struct {
	DisplayName  *string                       `json:"displayName"`
	IsNamePublic *bool                         `json:"isNamePublic"`
	Visibility   *leaderboardVisibilityRequest `json:"visibility"`
}

func UpdateLeaderboardMe(c *gin.Context) {
	var request updateLeaderboardMeRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数无效"})
		return
	}
	patch := service.LeaderboardProfilePatch{DisplayName: request.DisplayName, IsNamePublic: request.IsNamePublic}
	if request.DisplayName != nil {
		name := strings.TrimSpace(*request.DisplayName)
		if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 36 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "排行榜名称长度应为 1-36 个字符"})
			return
		}
		patch.DisplayName = &name
	}
	if request.Visibility != nil {
		patch.Visibility.ParticipateDay = request.Visibility.ParticipateDay
		patch.Visibility.ParticipateWeek = request.Visibility.ParticipateWeek
		patch.Visibility.ParticipateMonth = request.Visibility.ParticipateMonth
		patch.Visibility.ParticipateAll = request.Visibility.ParticipateAll
		patch.Visibility.ParticipateRank = request.Visibility.ParticipateRank
		patch.Visibility.ShowRankBadge = request.Visibility.ShowRankBadge
	}
	payload, err := service.UpdateLeaderboardMe(c.GetInt("id"), c.GetInt("role") >= common.RoleRootUser, patch)
	if err != nil {
		if errors.Is(err, model.ErrLeaderboardRenameCardNeeded) {
			c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "message": err.Error()})
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

type leaderboardOrderRequest struct {
	RequestKey string `json:"requestKey"`
	Quantity   int    `json:"quantity"`
}

func BuyLeaderboardRenameCards(c *gin.Context) {
	var request leaderboardOrderRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || !validLeaderboardRequestKey(request.RequestKey, 8) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求编号无效"})
		return
	}
	payload, err := service.BuyRenameCards(request.RequestKey, c.GetInt("id"), request.Quantity)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, model.ErrQuotaLoanRequestConflict) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"success": false, "message": err.Error()})
		return
	}
	if payload.Status != model.LeaderboardOrderCompleted {
		c.JSON(http.StatusAccepted, gin.H{"success": true, "data": payload})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": payload})
}

type sponsorOrderRequest struct {
	RequestKey string `json:"requestKey"`
	AmountCny  int    `json:"amountCny"`
	Message    string `json:"message"`
}

func CreateLeaderboardSponsor(c *gin.Context) {
	var request sponsorOrderRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || !validLeaderboardRequestKey(request.RequestKey, 16) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求编号无效"})
		return
	}
	request.Message = strings.TrimSpace(request.Message)
	if utf8.RuneCountInString(request.Message) > 80 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "留言最多 80 个字符"})
		return
	}
	payload, err := service.CreateSponsorship(request.RequestKey, c.GetInt("id"), request.AmountCny, request.Message)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, model.ErrQuotaLoanRequestConflict) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"success": false, "message": err.Error()})
		return
	}
	if payload.Status != model.LeaderboardOrderCompleted {
		c.JSON(http.StatusAccepted, gin.H{"success": true, "data": payload})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": payload})
}

func GetLeaderboardAppStatus(c *gin.Context) {
	payload, err := service.GetLeaderboardAppStatus(c.GetInt("id"), c.GetInt("role") >= common.RoleRootUser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

type quotaLoanRequest struct {
	RequestKey string `json:"requestKey"`
	Amount     *int   `json:"amount"`
}

func ApplyLeaderboardQuotaLoan(c *gin.Context) {
	var request quotaLoanRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || !validLeaderboardRequestKey(request.RequestKey, 8) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求编号无效"})
		return
	}
	payload, err := service.ApplyQuotaLoan(request.RequestKey, c.GetInt("id"), request.Amount)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, service.ErrQuotaLoanUnavailable) {
			status = http.StatusForbidden
		}
		if errors.Is(err, model.ErrQuotaLoanCreditExceeded) || errors.Is(err, model.ErrQuotaLoanPending) || errors.Is(err, model.ErrQuotaLoanRequestConflict) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"success": false, "message": err.Error()})
		return
	}
	if payload.Status == model.LeaderboardOrderUnknown || payload.Status == model.LeaderboardOrderProcessing {
		c.JSON(http.StatusAccepted, gin.H{"success": true, "data": payload})
		return
	}
	if payload.Status == model.LeaderboardOrderFailed {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": payload.ErrorMessage, "data": payload})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": payload})
}

func GetLeaderboardExcludedUsers(c *gin.Context) {
	ids, err := model.GetExcludedLeaderboardUserIds()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"userIds": ids})
}

type excludedUsersRequest struct {
	UserIds []int `json:"userIds"`
}

func UpdateLeaderboardExcludedUsers(c *gin.Context) {
	var request excludedUsersRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || len(request.UserIds) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "屏蔽名单格式无效"})
		return
	}
	unique := make(map[int]bool, len(request.UserIds))
	ids := make([]int, 0, len(request.UserIds))
	for _, userId := range request.UserIds {
		if userId <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "用户 ID 无效"})
			return
		}
		if !unique[userId] {
			unique[userId] = true
			ids = append(ids, userId)
		}
	}
	sort.Ints(ids)
	if err := model.ReplaceExcludedLeaderboardUsers(ids); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"userIds": ids})
}

func GetLeaderboardSponsorAdmin(c *gin.Context) {
	payload, err := service.GetSponsorAdminView()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

func GetLeaderboardRenameCardAdmin(c *gin.Context) {
	payload, err := service.GetRenameCardAdminView()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

func GetLeaderboardQuotaLoanAdmin(c *gin.Context) {
	payload, err := service.GetQuotaLoanAdminView()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

func GetLeaderboardLottery(c *gin.Context) {
	payload, err := service.GetWeeklyLottery(c.GetInt("id"), c.GetInt("role") >= common.RoleRootUser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

func DrawLeaderboardLottery(c *gin.Context) {
	payload, err := service.DrawWeeklyLottery(c.GetInt("id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": payload})
}

type lotteryResolutionRequest struct {
	Resolution string `json:"resolution"`
}

func ResolveLeaderboardLottery(c *gin.Context) {
	var request lotteryResolutionRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "核查结果无效"})
		return
	}
	payload, err := service.ResolveWeeklyLotteryDraw(c.Param("id"), request.Resolution)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, payload)
}

func validLeaderboardRequestKey(value string, minLength int) bool {
	return len(value) >= minLength && len(value) <= 80 && leaderboardRequestKeyPattern.MatchString(value)
}
