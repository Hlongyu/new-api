package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAnnouncementDismissalUsesAuthenticatedAccount(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.AnnouncementRead{}))
	previousDB := model.DB
	model.DB = db
	settings := console_setting.GetConsoleSetting()
	previousSettings := *settings
	settings.AnnouncementsEnabled = true
	settings.Announcements = `[{"content":"Update","publishDate":"2020-01-01T00:00:00Z","requireRead":true}]`
	t.Cleanup(func() {
		model.DB = previousDB
		*settings = previousSettings
		require.NoError(t, sqlDB.Close())
	})
	pending, err := service.GetPendingAnnouncements(10)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Set("id", 10)
	context.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"user_id":20,"revision":"`+pending[0].Revision+`"}`))
	DismissAnnouncement(context)
	assert.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.True(t, payload.Success)
	pending, err = service.GetPendingAnnouncements(10)
	require.NoError(t, err)
	assert.Empty(t, pending)
	pending, err = service.GetPendingAnnouncements(20)
	require.NoError(t, err)
	assert.Len(t, pending, 1)

	settings.Announcements = `[]`
	response = httptest.NewRecorder()
	context, _ = gin.CreateTestContext(response)
	context.Set("id", 20)
	context.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"revision":"`+pending[0].Revision+`"}`))
	DismissAnnouncement(context)
	assert.Equal(t, http.StatusConflict, response.Code)
}

func TestAnnouncementDismissalRejectsInvalidInput(t *testing.T) {
	for _, body := range []string{`{`, `{}`, `{"revision":"unknown"}`, `{"revision":1}`} {
		t.Run(body, func(t *testing.T) {
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Set("id", 10)
			context.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
			DismissAnnouncement(context)
			assert.Equal(t, http.StatusBadRequest, response.Code)
		})
	}
}
