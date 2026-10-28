package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
	"net/http"
)

func registerPersonalGroupRoutes(apiRouter *gin.RouterGroup) {
	self := apiRouter.Group("/personal", middleware.UserAuth())
	self.GET("/groups", controller.ListPersonalGroups)
	self.GET("/channels", controller.ListPersonalChannels)
	writes := self.Group("", middleware.SessionCookieOriginGuard(), middleware.CriticalRateLimit())
	writes.Use(func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		c.Next()
	})
	writes.POST("/groups", controller.CreatePersonalGroup)
	writes.PUT("/groups/:id", controller.UpdatePersonalGroup)
	writes.POST("/channels/models", controller.FetchPersonalChannelModels)
	writes.POST("/channels", controller.SavePersonalChannelDraft)
	writes.POST("/channels/:id/submit", controller.SubmitPersonalChannel)
	reviews := apiRouter.Group("/personal-channel-reviews", middleware.AdminAuth())
	reviews.GET("", middleware.RequirePermission(authz.ChannelRead), controller.ListPersonalChannelReviews)
	reviews.POST("/:id", middleware.SessionCookieOriginGuard(), middleware.CriticalRateLimit(), middleware.RequirePermission(authz.ChannelSensitiveWrite), controller.ReviewPersonalChannel)
}
