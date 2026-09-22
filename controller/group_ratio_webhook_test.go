package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGroupRatioWebhookResponsesNeverExposeSigningSecrets(t *testing.T) {
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB; require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.GroupRatioWebhook{}, &model.GroupRatioWebhookDelivery{}))
	secret := strings.Repeat("private-signing-secret", 2)
	require.NoError(t, db.Create(&model.GroupRatioWebhook{ID: 1, Enabled: true, URL: "https://example.com", Secret: secret, Groups: `["vip"]`}).Error)
	require.NoError(t, db.Create(&model.GroupRatioWebhookDelivery{ID: "event", URL: "https://example.com?token=private-url", Secret: secret, Payload: `{}`, Lease: "private-lease", Status: "pending"}).Error)
	router := gin.New()
	router.GET("/config", GetGroupRatioWebhook)
	router.GET("/deliveries", ListGroupRatioWebhookDeliveries)
	for _, path := range []string{"/config", "/deliveries"} {
		t.Run(path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.NotContains(t, recorder.Body.String(), secret)
			assert.NotContains(t, recorder.Body.String(), "private-url")
			assert.NotContains(t, recorder.Body.String(), "private-lease")
			var response struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.True(t, response.Success)
		})
	}
}
