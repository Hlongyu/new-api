package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func ListPersonalGroups(c *gin.Context) {
	groups := []model.PersonalGroup{}
	if err := model.DB.Where("owner_user_id = ? AND archived_at = 0", c.GetInt("id")).Order("id DESC").Find(&groups).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, groups)
}

func CreatePersonalGroup(c *gin.Context) {
	var request struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Ratio       *float64 `json:"ratio"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.Ratio == nil {
		common.ApiError(c, errors.New("A name and group ratio are required"))
		return
	}
	group, err := model.CreatePersonalGroup(c.GetInt("id"), request.Name, request.Description, *request.Ratio)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, group)
}

func UpdatePersonalGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.Status(http.StatusBadRequest)
		return
	}
	var request struct {
		Description string   `json:"description"`
		Ratio       *float64 `json:"ratio"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.Ratio == nil {
		common.ApiError(c, errors.New("A group ratio is required"))
		return
	}
	if err := model.UpdatePersonalGroup(c.GetInt("id"), id, request.Description, *request.Ratio); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "personal_group.update", map[string]any{"group_id": id, "ratio": *request.Ratio})
	common.ApiSuccess(c, nil)
}

func ListPersonalChannels(c *gin.Context) {
	page := common.GetPageQuery(c)
	views, total, err := model.ListPersonalChannels(c.GetInt("id"), false, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(views)
	common.ApiSuccess(c, page)
}

func ListPersonalChannelReviews(c *gin.Context) {
	page := common.GetPageQuery(c)
	views, total, err := model.ListPersonalChannels(0, true, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(views)
	common.ApiSuccess(c, page)
}

func SavePersonalChannelDraft(c *gin.Context) {
	var request struct {
		ID                 int                         `json:"id"`
		GroupID            int                         `json:"group_id"`
		ExpectedRevisionID int                         `json:"expected_revision_id"`
		Config             model.PersonalChannelConfig `json:"config"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	revision, err := model.SavePersonalChannelDraft(c.GetInt("id"), request.GroupID, request.ID, request.ExpectedRevisionID, request.Config)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, revision)
}

func SubmitPersonalChannel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.Status(http.StatusBadRequest)
		return
	}
	var request struct {
		RevisionID int `json:"revision_id"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.SubmitPersonalChannel(c.GetInt("id"), id, request.RevisionID); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func ReviewPersonalChannel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.Status(http.StatusBadRequest)
		return
	}
	var request struct {
		RevisionID int    `json:"revision_id"`
		Approve    *bool  `json:"approve"`
		Reason     string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.Approve == nil {
		common.ApiError(c, errors.New("A review decision is required"))
		return
	}
	if err := model.ReviewPersonalChannel(c.GetInt("id"), id, request.RevisionID, *request.Approve, request.Reason); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	recordManageAudit(c, "personal_channel.review", map[string]any{"personal_channel_id": id, "revision_id": request.RevisionID, "approved": *request.Approve})
	common.ApiSuccess(c, nil)
}

func FetchPersonalChannelModels(c *gin.Context) {
	var request struct {
		ChannelID int    `json:"channel_id"`
		Type      int    `json:"type"`
		BaseURL   string `json:"base_url"`
		Key       string `json:"key"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, errors.New("Invalid model discovery request"))
		return
	}
	config := model.PersonalChannelConfig{Type: request.Type, BaseURL: request.BaseURL, Key: request.Key}
	if err := model.ResolvePersonalModelCredentials(c.GetInt("id"), request.ChannelID, &config); err != nil {
		common.ApiError(c, err)
		return
	}
	models, err := service.FetchPersonalChannelModels(c.Request.Context(), config)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, models)
}
