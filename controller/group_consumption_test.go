package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGroupConsumptionEnforcesOwnerDespiteQueryParameters(t *testing.T) {
	db := setupManageUserTestDB(t)
	previous := model.LOG_DB
	model.LOG_DB = db
	t.Cleanup(func() { model.LOG_DB = previous })
	require.NoError(t, db.AutoMigrate(&model.PostpaidSettlement{}, &model.Log{}))
	start, _, err := model.BeijingConsumptionWindow("2026-01")
	require.NoError(t, err)
	require.NoError(t, db.Create(&[]model.PostpaidSettlement{
		{RequestId: "owned", UserId: 7, WalletQuota: 100, SubscriptionQuota: 50, StartedAt: start.Unix()},
		{RequestId: "foreign", UserId: 7, WalletQuota: 900, StartedAt: start.Unix()},
	}).Error)
	require.NoError(t, db.Create(&[]model.Log{
		{RequestId: "owned", Group: "custom-owned", GroupOwnerUserID: 1, Type: model.LogTypeConsume},
		{RequestId: "foreign", Group: "custom-foreign", GroupOwnerUserID: 2, Type: model.LogTypeConsume},
	}).Error)
	for _, tc := range []struct {
		name, query    string
		role, expected int
	}{
		{"owner cannot expand scope", "&owner_id=2&user_id=7&role=100", common.RoleCommonUser, 1},
		{"administrator sees all groups", "", common.RoleAdminUser, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("id", 1)
			c.Set("role", tc.role)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/data/group-consumption?month=2026-01"+tc.query, nil)
			GetGroupMonthlyConsumption(c)
			require.Equal(t, http.StatusOK, recorder.Code)
			var response struct {
				Success bool                         `json:"success"`
				Data    model.GroupConsumptionReport `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success)
			assert.Len(t, response.Data.Items, tc.expected)
			if tc.role == common.RoleCommonUser && tc.expected == 1 {
				assert.Equal(t, "custom-owned", response.Data.Items[0].Group)
				assert.EqualValues(t, 150, response.Data.Items[0].TotalQuota)
			}
		})
	}

	t.Run("per-group exclusions leave other owners unchanged and retain zero rows", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", 1)
		c.Set("role", common.RoleAdminUser)
		c.Request = httptest.NewRequest(http.MethodGet, `/api/data/group-consumption?month=2026-01&group_exclusions=%7B%22custom-owned%22:%5B7%5D%7D`, nil)
		GetGroupMonthlyConsumption(c)
		require.Equal(t, http.StatusOK, recorder.Code)
		var response struct {
			Data model.GroupConsumptionReport `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.Len(t, response.Data.Items, 2)
		assert.EqualValues(t, 900, response.Data.Items[0].TotalQuota)
		assert.Equal(t, "custom-owned", response.Data.Items[1].Group)
		assert.Zero(t, response.Data.Items[1].TotalQuota)
	})

	t.Run("user dimension applies group user and funding filters within owner scope", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", 1)
		c.Set("role", common.RoleCommonUser)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/data/group-consumption?month=2026-01&dimension=user&group=custom-owned&user_id=7&source=subscription", nil)
		GetGroupMonthlyConsumption(c)
		require.Equal(t, http.StatusOK, recorder.Code)
		var response struct {
			Data model.GroupConsumptionReport `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.Len(t, response.Data.Items, 1)
		assert.Equal(t, 7, response.Data.Items[0].UserID)
		assert.EqualValues(t, 50, response.Data.Items[0].TotalQuota)
		assert.Zero(t, response.Data.Items[0].WalletQuota)
		require.Len(t, response.Data.Groups, 1)
		assert.Equal(t, "custom-owned", response.Data.Groups[0].Group)
	})
	for _, query := range []string{"month=2026-01&dimension=invalid", "month=2026-01&source=invalid", "month=2026-01&user_id=-1", "month=invalid", "month=2026-13", "month=9999-01", "month=2026-01&group_exclusions=invalid", "month=2026-01&group_exclusions=null", "month=2026-01&group_exclusions=%7B%22custom-owned%22:%5B-1%5D%7D", "month=2026-01&excluded_user_ids=-1", "month=2026-01&excluded_user_ids=2147483648"} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", 1)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/data/group-consumption?"+query, nil)
		GetGroupMonthlyConsumption(c)
		assert.Equal(t, http.StatusBadRequest, recorder.Code)
	}
}
