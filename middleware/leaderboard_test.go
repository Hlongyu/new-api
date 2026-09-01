package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLeaderboardMigrationReadyBlocksUntilMarkerExists(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:leaderboard-migration-ready?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.CompanionMigration{}))
	previousDB := model.DB
	previousRequired := common.LeaderboardMigrationRequired
	model.DB = database
	common.LeaderboardMigrationRequired = true
	t.Cleanup(func() {
		model.DB = previousDB
		common.LeaderboardMigrationRequired = previousRequired
	})

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(LeaderboardMigrationReady())
	router.GET("/leaderboard", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	blocked := httptest.NewRecorder()
	router.ServeHTTP(blocked, httptest.NewRequest(http.MethodGet, "/leaderboard", nil))
	assert.Equal(t, http.StatusServiceUnavailable, blocked.Code)

	require.NoError(t, database.Create(&model.CompanionMigration{
		MigrationKey: "cutover", ManifestHash: "sha256:test", CutoverAt: 1, CompletedAt: 2,
	}).Error)
	ready := httptest.NewRecorder()
	router.ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/leaderboard", nil))
	assert.Equal(t, http.StatusNoContent, ready.Code)
}
