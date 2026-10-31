package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
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
	// Legacy snapshots must use the same accounting interpretation in the
	// detail response as in the monthly table.
	require.NoError(t, db.Model(&model.AccountingSnapshot{}).Where("period = ?", "2026-10").Update("status", "negative_balance").Error)
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
				Snapshot model.AccountingSnapshot       `json:"snapshot"`
				Items    []model.AccountingSnapshotUser `json:"items"`
				Total    int64                          `json:"total"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.True(t, response.Success)
		assert.Equal(t, "captured", response.Data.Snapshot.Status)
		require.Len(t, response.Data.Items, 1)
		assert.EqualValues(t, 1, response.Data.Total)
		assert.EqualValues(t, 750000, response.Data.Items[0].Quota)
	}
}

func TestAccountingExclusionsAreAdminOnlyValidatedAndPersisted(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	require.NoError(t, db.Create(&[]model.User{
		{Id: 1, Username: "owner", AffCode: "owner"},
		{Id: 2, Username: "deleted-owner", AffCode: "deleted-owner"},
	}).Error)
	require.NoError(t, db.Delete(&model.User{Id: 2}).Error)
	for _, tc := range []struct {
		name   string
		role   int
		body   string
		status int
		want   []int
	}{
		{"anonymous", 0, `{"user_ids":[1]}`, 403, []int{}},
		{"regular-user", common.RoleCommonUser, `{"user_ids":[1]}`, 403, []int{}},
		{"save", common.RoleAdminUser, `{"user_ids":[2,1,1]}`, 200, []int{1, 2}},
		{"invalid", common.RoleAdminUser, `{"user_ids":[0]}`, 400, []int{1, 2}},
		{"unknown", common.RoleAdminUser, `{"user_ids":[999]}`, 400, []int{1, 2}},
		{"missing", common.RoleAdminUser, `{}`, 400, []int{1, 2}},
		{"clear", common.RoleAdminUser, `{"user_ids":[]}`, 200, []int{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("role", tc.role)
			c.Request = httptest.NewRequest(http.MethodPut, "/", strings.NewReader(tc.body))
			AdminUpdateAccountingExcludedUsers(c)
			require.Equal(t, tc.status, recorder.Code)
			ids, err := model.GetAccountingExcludedUserIDs()
			require.NoError(t, err)
			assert.Equal(t, tc.want, ids)
		})
	}
}

func TestAccountingReportUsesSavedExclusions(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.AccountingSnapshot{}, &model.AccountingSnapshotUser{}, &model.AccountingRedemption{}))
	start, end, err := model.BeijingConsumptionWindow("2026-10")
	require.NoError(t, err)
	require.NoError(t, db.Create(&[]model.AccountingSnapshot{
		{Period: "2026-10", ScheduledAt: start.Unix(), CapturedAt: start.Unix(), Status: "captured", QuotaPerCNY: 1, BalanceQuota: 1000},
		{Period: "2026-11", ScheduledAt: end.Unix(), CapturedAt: end.Unix(), Status: "captured", QuotaPerCNY: 1, BalanceQuota: 700},
	}).Error)
	require.NoError(t, db.Create(&[]model.AccountingSnapshotUser{
		{Period: "2026-10", UserId: 1, Quota: 600},
		{Period: "2026-11", UserId: 1, Quota: 400},
	}).Error)
	require.NoError(t, model.SetAccountingExcludedUserIDs([]int{1}))
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("role", common.RoleAdminUser)
	c.Request = httptest.NewRequest(http.MethodGet, "/?year=2026", nil)
	AdminGetMonthlyAccounting(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items           []model.AccountingMonth `json:"items"`
			ExcludedUserIDs []int                   `json:"excluded_user_ids"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	assert.Equal(t, []int{1}, response.Data.ExcludedUserIDs)
	require.NotEmpty(t, response.Data.Items)
	require.NotNil(t, response.Data.Items[0].RevenueQuota)
	assert.EqualValues(t, 100, *response.Data.Items[0].RevenueQuota)
}
