package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAccountingEndpointsRejectNonAdministrators(t *testing.T) {
	for _, handler := range []gin.HandlerFunc{AdminGetMonthlyAccounting, AdminGetAccountingSnapshotUsers} {
		for _, role := range []int{0, common.RoleCommonUser} {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("role", role)
			c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
			handler(c)
			assert.Equal(t, http.StatusForbidden, recorder.Code)
		}
	}
}

func TestAccountingAPIExposesPersistedBalancesAndRejectsInvalidPeriod(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.AccountingSnapshot{}, &model.AccountingSnapshotUser{}, &model.AccountingRedemption{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "alice", Quota: 750000}).Error)
	now := time.Date(2026, 10, 1, 0, 0, 0, 0, time.FixedZone("Beijing", 8*3600))
	require.NoError(t, model.CaptureMonthlyAccountingSnapshot(now, 500000))
	for _, tc := range []struct {
		query  string
		status int
	}{
		{"period=2026-10&p=1&page_size=20", http.StatusOK},
		{"period=2026-9", http.StatusBadRequest},
		{"period=2026-09", http.StatusBadRequest},
		{"period=2026-11", http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("role", common.RoleAdminUser)
		c.Request = httptest.NewRequest(http.MethodGet, "/?"+tc.query, nil)
		AdminGetAccountingSnapshotUsers(c)
		require.Equal(t, tc.status, recorder.Code)
		if tc.status != http.StatusOK {
			continue
		}
		var response struct {
			Success bool `json:"success"`
			Data    struct {
				Items []model.AccountingSnapshotUser `json:"items"`
				Total int64                          `json:"total"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.True(t, response.Success)
		require.Len(t, response.Data.Items, 1)
		assert.EqualValues(t, 1, response.Data.Total)
		assert.EqualValues(t, 750000, response.Data.Items[0].Quota)
	}
}
