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

func setupAnnouncementControllerTest(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.AnnouncementRead{}, &model.AutomaticAnnouncement{}))
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
}

func TestAnnouncementDismissalUsesAuthenticatedAccount(t *testing.T) {
	setupAnnouncementControllerTest(t)
	settings := console_setting.GetConsoleSetting()
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

func TestGetStatusIncludesAutomaticAnnouncementsWithoutPrivateEventFields(t *testing.T) {
	setupAnnouncementControllerTest(t)
	require.NoError(t, model.PublishAutomaticAnnouncement(&model.AutomaticAnnouncement{
		EventKey: "leaderboard-first-challenger", UserId: 123,
		AchievedOn: "2026-01-22", PublishedAt: 1769040000, Content: "恭喜匿名王者！",
	}))
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	GetStatus(context)
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Announcements []map[string]interface{} `json:"announcements"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.True(t, payload.Success)
	require.Len(t, payload.Data.Announcements, 2)
	assert.Equal(t, "system:leaderboard-first-challenger", payload.Data.Announcements[0]["id"])
	assert.Equal(t, true, payload.Data.Announcements[0]["requireRead"])
	assert.NotContains(t, payload.Data.Announcements[0], "user_id")
	assert.NotContains(t, payload.Data.Announcements[0], "UserId")
}

func TestGetOptionsIncludesAutomaticAnnouncementInExistingEditorList(t *testing.T) {
	setupAnnouncementControllerTest(t)
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{"console_setting.announcements": "[]"}
	t.Cleanup(func() { common.OptionMap = previousOptions })
	require.NoError(t, model.PublishAutomaticAnnouncement(&model.AutomaticAnnouncement{
		EventKey: "leaderboard-first-challenger", UserId: 123,
		AchievedOn: "2026-01-22", PublishedAt: 1769040000, Content: "Champion announcement",
	}))
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	GetOptions(context)
	var payload struct {
		Success bool           `json:"success"`
		Data    []model.Option `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	var values []string
	for _, option := range payload.Data {
		if option.Key == "console_setting.announcements" {
			values = append(values, option.Value)
		}
	}
	require.Len(t, values, 1)
	var announcements []map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(values[0], &announcements))
	require.Len(t, announcements, 2)
	assert.Equal(t, "system:leaderboard-first-challenger", announcements[0]["id"])
	assert.Equal(t, "Champion announcement", announcements[0]["content"])
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
