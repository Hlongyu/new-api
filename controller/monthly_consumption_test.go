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

func TestSelfMonthlyConsumptionIgnoresOtherUserQuery(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PostpaidSettlement{}))
	require.NoError(t, db.Create(&[]model.User{{Id: 1, Username: "self", AffCode: "self"}, {Id: 2, Username: "other", AffCode: "other"}}).Error)
	require.NoError(t, db.Create(&[]model.PostpaidSettlement{
		{RequestId: "self", UserId: 1, WalletQuota: 100, SubscriptionQuota: 50, StartedAt: time.Now().Unix()},
		{RequestId: "other", UserId: 2, WalletQuota: 99999, StartedAt: time.Now().Unix()},
	}).Error)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-consumption/self?user_id=2", nil)
	GetSelfMonthlyConsumption(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.MonthlyConsumption `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data.Items, 1)
	assert.Equal(t, 1, response.Data.Items[0].UserId)
	assert.EqualValues(t, 100, response.Data.Items[0].WalletQuota)
	assert.EqualValues(t, 150, response.Data.Items[0].TotalQuota)
}
