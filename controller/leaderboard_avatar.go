package controller

import (
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func UploadLeaderboardAvatar(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxLeaderboardAvatarBytes+(64<<10))
	if err := c.Request.ParseMultipartForm(service.MaxLeaderboardAvatarBytes + (64 << 10)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请上传不超过 2 MB 的 PNG 或 JPEG 图片"})
		return
	}
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	file, _, err := c.Request.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请选择头像图片"})
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, service.MaxLeaderboardAvatarBytes+1))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	avatar, err := service.NormalizeLeaderboardAvatar(data)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	payload, err := service.UpdateLeaderboardMe(c.GetInt("id"), c.GetInt("role") >= common.RoleRootUser, service.LeaderboardProfilePatch{AvatarImage: &avatar})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}
