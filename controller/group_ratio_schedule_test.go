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

func TestGroupRatioScheduleRejectsMissingRatioAndInvalidCancellationID(t *testing.T) {
	router := gin.New()
	router.POST("/schedules", CreateGroupRatioSchedule)
	router.POST("/schedules/:id/cancel", CancelGroupRatioSchedule)
	for _, tc := range []struct{ path, body string }{
		{"/schedules", `{"group":"gpt-pro","execute_at":4096022400}`},
		{"/schedules", `{"group":"gpt-pro","ratio":null,"execute_at":4096022400}`},
		{"/schedules", `{"group":"gpt-pro","ratio":"0.1","execute_at":4096022400}`},
		{"/schedules/invalid/cancel", ``},
		{"/schedules/0/cancel", ``},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body)))
		assert.Equal(t, http.StatusBadRequest, recorder.Code)
	}
}

func TestGroupRatioScheduleListsPendingChronologicallyAndHistorySeparately(t *testing.T) {
	previous := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	model.DB = db
	t.Cleanup(func() { model.DB = previous; require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.GroupRatioSchedule{}))
	require.NoError(t, db.Create(&[]model.GroupRatioSchedule{
		{GroupName: "later", Ratio: .1, Status: "pending", ExecuteAt: 300},
		{GroupName: "earlier", Ratio: .2, Status: "pending", ExecuteAt: 200},
		{GroupName: "done", Ratio: .3, Status: "succeeded", ExecuteAt: 100, FinishedAt: 101},
	}).Error)
	router := gin.New()
	router.GET("/schedules", ListGroupRatioSchedules)
	for _, tc := range []struct {
		status string
		groups []string
	}{
		{"pending", []string{"earlier", "later"}}, {"history", []string{"done"}},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/schedules?status="+tc.status, nil))
		require.Equal(t, http.StatusOK, recorder.Code)
		var response struct {
			Success bool
			Data    struct {
				Items []model.GroupRatioSchedule
				Total int
			}
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.True(t, response.Success)
		assert.Equal(t, len(tc.groups), response.Data.Total)
		groups := []string{}
		for _, item := range response.Data.Items {
			groups = append(groups, item.GroupName)
		}
		assert.Equal(t, tc.groups, groups)
	}
}
