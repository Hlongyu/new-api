package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetPendingAnnouncements(c *gin.Context) {
	announcements, err := service.GetPendingAnnouncements(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": announcements})
}

func DismissAnnouncement(c *gin.Context) {
	var request struct {
		Revision string `json:"revision"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || len(request.Revision) != 64 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid announcement revision"})
		return
	}
	err := service.DismissAnnouncement(c.GetInt("id"), request.Revision)
	if errors.Is(err, service.ErrAnnouncementUnavailable) {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "Announcement changed or was removed"})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
