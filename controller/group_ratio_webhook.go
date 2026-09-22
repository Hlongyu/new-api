package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetGroupRatioWebhook(c *gin.Context) {
	config, err := model.GetGroupRatioWebhook()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	groups := []string{}
	if err := common.UnmarshalJsonStr(config.Groups, &groups); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"enabled": config.Enabled, "url": config.URL, "groups": groups, "has_secret": config.Secret != ""}})
}

func SaveGroupRatioWebhook(c *gin.Context) {
	var request struct {
		Enabled bool     `json:"enabled"`
		URL     string   `json:"url"`
		Groups  []string `json:"groups"`
		Secret  string   `json:"secret"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid webhook configuration"})
		return
	}
	config := model.GroupRatioWebhook{Enabled: request.Enabled, URL: request.URL, Secret: request.Secret}
	if request.Groups == nil {
		request.Groups = []string{}
	}
	if err := model.SaveGroupRatioWebhook(config, request.Groups); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "group_ratio_webhook.update", nil)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func ListGroupRatioWebhookDeliveries(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 || page > 100000 {
		page = 1
	}
	deliveries := []model.GroupRatioWebhookDelivery{}
	// Exclude credentials from both the query and JSON serialization.
	err := model.DB.Omit("url", "secret", "lease").Order("created_at DESC, id DESC").Limit(20).Offset((page - 1) * 20).Find(&deliveries).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": deliveries})
}

func RetryGroupRatioWebhook(c *gin.Context) {
	if err := model.RetryGroupRatioWebhook(c.Param("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "group_ratio_webhook.retry", map[string]interface{}{"id": c.Param("id")})
	c.JSON(http.StatusOK, gin.H{"success": true})
}
