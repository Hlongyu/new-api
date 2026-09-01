package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func LeaderboardMigrationReady() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.LeaderboardMigrationRequired {
			c.Next()
			return
		}
		ready, err := model.HasCompletedCompanionMigration()
		if err != nil {
			common.ApiError(c, err)
			c.Abort()
			return
		}
		if !ready {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"message": "leaderboard migration has not completed",
			})
			return
		}
		c.Next()
	}
}
