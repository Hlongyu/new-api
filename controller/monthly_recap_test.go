package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMonthlyRecapMergesGroupsAndEnforcesSelfScope(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.QuotaData{}, &model.MonthlyRecapSnapshot{}))
	start, end, err := model.BeijingConsumptionWindow("2025-01")
	require.NoError(t, err)
	logs := []model.Log{
		{UserId: 1, Group: "gpt-pro", ModelName: "a", CreatedAt: start.Unix(), Type: model.LogTypeConsume, PromptTokens: 100, CompletionTokens: 20, Quota: 25, Other: `{"cache_tokens":40,"group_ratio":0.25}`},
		{UserId: 1, Group: "gpt优惠", ModelName: "a", CreatedAt: start.Unix() + 86400, Type: model.LogTypeConsume, PromptTokens: 200, CompletionTokens: 30, Quota: 40, Other: `{"cache_tokens":100,"group_ratio":0.1}`},
		{UserId: 1, Group: "gpt-pro", ModelName: "b", CreatedAt: start.Unix() + 172800, Type: model.LogTypeConsume, PromptTokens: 10, CompletionTokens: 5, Quota: 10, Other: `{"claude":true,"cache_tokens":20,"cache_creation_tokens":5,"group_ratio":0.5}`},
		{UserId: 1, Group: "gpt-pro", CreatedAt: start.Unix() + 172800, Type: model.LogTypeError},
		{UserId: 2, Group: "gpt-pro", ModelName: "private-model", CreatedAt: start.Unix(), Type: model.LogTypeConsume, Quota: 999999},
		{UserId: 1, Group: "other", ModelName: "excluded-model", CreatedAt: start.Unix(), Type: model.LogTypeConsume, Quota: 999999},
		{UserId: 1, Group: "gpt-pro", CreatedAt: start.Unix() - 1, Type: model.LogTypeConsume, Quota: 999999},
		{UserId: 1, Group: "gpt-pro", CreatedAt: end.Unix(), Type: model.LogTypeConsume, Quota: 999999},
	}
	require.NoError(t, db.Create(&logs).Error)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-recap/self?month=2025-01&user_id=2&groups=other", nil)
	GetSelfMonthlyRecap(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool                 `json:"success"`
		Data    service.MonthlyRecap `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	got := response.Data
	assert.EqualValues(t, 3, got.Requests)
	assert.EqualValues(t, 335, got.InputTokens)
	assert.EqualValues(t, 55, got.OutputTokens)
	assert.EqualValues(t, 160, got.CacheReadTokens)
	assert.EqualValues(t, 5, got.CacheWriteTokens)
	assert.EqualValues(t, 75, got.Quota)
	assert.Equal(t, 520.0, got.OriginalQuota)
	assert.EqualValues(t, 3, got.PricedRequests)
	require.Len(t, got.Models, 2)
	assert.Equal(t, "a", got.Models[0].Name)
	assert.EqualValues(t, 2, got.Models[0].Requests)
	assert.Equal(t, 3, got.ActiveDays)
	assert.Equal(t, 3, got.LongestStreak)
	assert.EqualValues(t, 1, got.Errors)
	assert.EqualValues(t, 3, got.Hours[0])
	require.Len(t, got.Days, 31)
	assert.Equal(t, "2025-01-01", got.Days[0].Date)
	assert.EqualValues(t, 1, got.Days[0].Requests)
	assert.False(t, got.InProgress)
	assert.False(t, got.HistoryIncomplete)
	assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
	assert.NotContains(t, recorder.Body.String(), "private-model")
}

func TestMonthlyRecapDisclosesMissingHistoryAndDoesNotPriceZeroDiscounts(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.QuotaData{}, &model.MonthlyRecapSnapshot{}))
	start, _, err := model.BeijingConsumptionWindow("2025-02")
	require.NoError(t, err)
	require.NoError(t, db.Create(&[]model.Log{
		{UserId: 1, Group: "gpt优惠", CreatedAt: start.Unix(), Type: model.LogTypeConsume, Other: `{"group_ratio":0}`},
		{UserId: 1, Group: "gpt-pro", CreatedAt: start.Unix(), Type: model.LogTypeConsume, Quota: 5, Other: `not json`},
	}).Error)
	require.NoError(t, db.Create(&model.QuotaData{UserID: 1, UseGroup: "gpt-pro", CreatedAt: start.Unix(), Count: 3}).Error)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-recap/self?month=2025-02", nil)
	GetSelfMonthlyRecap(c)
	var response struct {
		Success bool                 `json:"success"`
		Data    service.MonthlyRecap `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	assert.True(t, response.Data.HistoryIncomplete)
	assert.Zero(t, response.Data.PricedRequests)
	assert.Zero(t, response.Data.OriginalQuota)
	assert.EqualValues(t, 1, response.Data.UnreadableUsage)
	assert.Len(t, response.Data.Days, 28)
}

func TestMonthlyRecapRejectsInvalidMonthsAndMissingAuthentication(t *testing.T) {
	for _, tc := range []struct {
		name, month    string
		userID, status int
	}{
		{"missing auth", "2025-01", 0, http.StatusUnauthorized},
		{"invalid month", "2025-13", 1, http.StatusBadRequest},
		{"noncanonical", "2025-1", 1, http.StatusBadRequest},
		{"future", "9999-01", 1, http.StatusBadRequest},
		{"current month", time.Now().In(time.FixedZone("Beijing", 8*3600)).Format("2006-01"), 1, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("id", tc.userID)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-recap/self?month="+tc.month, nil)
			GetSelfMonthlyRecap(c)
			assert.Equal(t, tc.status, recorder.Code)
		})
	}
}

func TestMonthlyRecapDoesNotTreatCurrentHourlySyncAsMissingHistory(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.QuotaData{}, &model.MonthlyRecapSnapshot{}))
	start, end, err := model.BeijingConsumptionWindow("2025-03")
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.Log{UserId: 1, Group: "gpt-pro", CreatedAt: start.Unix(), Type: model.LogTypeConsume, Other: `{ "group_ratio": 0.25 }`}).Error)
	require.NoError(t, db.Create(&model.QuotaData{UserID: 1, UseGroup: "gpt-pro", CreatedAt: start.Unix(), Count: 2}).Error)
	current, err := service.GetMonthlyRecap(context.Background(), 1, []string{"gpt-pro"}, start, end, start.Add(30*time.Minute))
	require.NoError(t, err)
	assert.False(t, current.HistoryIncomplete)
	assert.True(t, current.InProgress)
	closed, err := service.GetMonthlyRecap(context.Background(), 1, []string{"gpt-pro"}, start, end, start.Add(90*time.Minute))
	require.NoError(t, err)
	assert.True(t, closed.HistoryIncomplete)
}

func TestAdminMonthlyRecapSelectsUserAndReturnsOnlyThatUsersUsage(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.QuotaData{}, &model.MonthlyRecapSnapshot{}))
	require.NoError(t, db.Create(&[]model.User{{Id: 1, Username: "admin", AffCode: "a"}, {Id: 2, Username: "alice", DisplayName: "Alice", AffCode: "b", Email: "private@example.com", Password: "private-password"}}).Error)
	start, _, err := model.BeijingConsumptionWindow("2025-01")
	require.NoError(t, err)
	require.NoError(t, db.Create(&[]model.Log{
		{UserId: 1, Group: "gpt-pro", CreatedAt: start.Unix(), Type: model.LogTypeConsume, Quota: 9999, Other: `{"group_ratio":0.25}`},
		{UserId: 2, Group: "gpt优惠", ModelName: "alice-model", CreatedAt: start.Unix(), Type: model.LogTypeConsume, Quota: 25, Other: `{"group_ratio":0.25}`},
	}).Error)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Set("role", common.RoleAdminUser)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-recap?month=2025-01&user_id=2", nil)
	AdminGetMonthlyRecap(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool                 `json:"success"`
		Data    service.MonthlyRecap `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.NotNil(t, response.Data.Subject)
	assert.Equal(t, 2, response.Data.Subject.ID)
	assert.Equal(t, "Alice", response.Data.Subject.DisplayName)
	assert.EqualValues(t, 25, response.Data.Quota)
	assert.EqualValues(t, 1, response.Data.Requests)
	assert.NotContains(t, recorder.Body.String(), "private-password")
	assert.NotContains(t, recorder.Body.String(), "private@example.com")
}

func TestAdminMonthlyRecapRejectsNonAdminsAndInvalidTargets(t *testing.T) {
	for _, tc := range []struct {
		name, query  string
		role, status int
	}{
		{"ordinary user", "user_id=2", common.RoleCommonUser, http.StatusForbidden},
		{"missing target", "", common.RoleAdminUser, http.StatusBadRequest},
		{"negative target", "user_id=-2", common.RoleAdminUser, http.StatusBadRequest},
		{"malformed target", "user_id=abc", common.RoleAdminUser, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("id", 1)
			c.Set("role", tc.role)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-recap?month=2025-01&"+tc.query, nil)
			AdminGetMonthlyRecap(c)
			assert.Equal(t, tc.status, recorder.Code)
		})
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Set("role", common.RoleCommonUser)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-recap/users", nil)
	AdminListMonthlyRecapUsers(c)
	assert.Equal(t, http.StatusForbidden, recorder.Code)
}

func TestAdminMonthlyRecapUserDirectorySearchesAndPaginatesWithoutSecrets(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	db := setupModelListControllerTestDB(t)
	for id := 1; id <= 22; id++ {
		name := fmt.Sprintf("person-%02d", id)
		require.NoError(t, db.Create(&model.User{Id: id, Username: name, DisplayName: name, AffCode: name, Password: "secret-password", Email: "secret@example.com"}).Error)
	}
	for _, tc := range []struct {
		query           string
		total           int64
		length, firstID int
	}{
		{"page=1", 22, 20, 1}, {"page=2", 22, 2, 21}, {"keyword=person-22", 1, 1, 22},
	} {
		t.Run(tc.query, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("id", 1)
			c.Set("role", common.RoleAdminUser)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-recap/users?"+tc.query, nil)
			AdminListMonthlyRecapUsers(c)
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					Items []model.MonthlyRecapUser `json:"items"`
					Total int64                    `json:"total"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success, recorder.Body.String())
			require.Len(t, response.Data.Items, tc.length)
			assert.Equal(t, tc.total, response.Data.Total)
			assert.Equal(t, tc.firstID, response.Data.Items[0].ID)
			assert.NotContains(t, recorder.Body.String(), "secret-")
			assert.NotContains(t, recorder.Body.String(), "secret@example.com")
		})
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Set("role", common.RoleAdminUser)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/data/monthly-recap?month=2025-01&user_id=999", nil)
	AdminGetMonthlyRecap(c)
	assert.Equal(t, http.StatusNotFound, recorder.Code)
}

func TestMonthlyRecapSnapshotPersistsAndAdminRebuildReplacesIt(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.QuotaData{}, &model.MonthlyRecapSnapshot{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "alice", AffCode: "alice"}).Error)
	start, end, err := model.BeijingConsumptionWindow("2025-01")
	require.NoError(t, err)
	now := end.Add(time.Hour)
	_, err = service.GetSavedMonthlyRecap(context.Background(), 1, start, end, end.Add(-time.Second), false)
	require.Error(t, err)
	var unopened int64
	require.NoError(t, db.Model(&model.MonthlyRecapSnapshot{}).Count(&unopened).Error)
	assert.Zero(t, unopened)
	log := model.Log{UserId: 1, Group: "gpt-pro", CreatedAt: start.Unix(), Type: model.LogTypeConsume, Quota: 25, Other: `{"group_ratio":0.25}`}
	require.NoError(t, db.Create(&log).Error)
	first, err := service.GetSavedMonthlyRecap(context.Background(), 1, start, end, now, false)
	require.NoError(t, err)
	assert.EqualValues(t, 1, first.Requests)
	require.NoError(t, db.Where("id = ?", log.Id).Delete(&model.Log{}).Error)
	saved, err := service.GetSavedMonthlyRecap(context.Background(), 1, start, end, now.Add(time.Hour), false)
	require.NoError(t, err)
	assert.Equal(t, first, saved, "deleted logs must not change a persisted recap")

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Set("role", common.RoleCommonUser)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/data/monthly-recap/rebuild?month=2025-01&user_id=1", nil)
	AdminRebuildMonthlyRecap(c)
	assert.Equal(t, http.StatusForbidden, recorder.Code)

	recorder = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Set("role", common.RoleAdminUser)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/data/monthly-recap/rebuild?month=2025-01&user_id=1", nil)
	AdminRebuildMonthlyRecap(c)
	var response struct {
		Success bool                 `json:"success"`
		Data    service.MonthlyRecap `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Zero(t, response.Data.Requests)
	saved, err = service.GetSavedMonthlyRecap(context.Background(), 1, start, end, now, false)
	require.NoError(t, err)
	assert.Zero(t, saved.Requests, "empty results are persisted too")
	require.NoError(t, db.Migrator().DropTable(&model.Log{}))
	_, err = service.GetSavedMonthlyRecap(context.Background(), 1, start, end, now, true)
	require.Error(t, err)
	afterFailure, err := service.GetSavedMonthlyRecap(context.Background(), 1, start, end, now, false)
	require.NoError(t, err)
	assert.Equal(t, saved, afterFailure, "failed rebuild must preserve saved result")
	var count int64
	require.NoError(t, db.Model(&model.MonthlyRecapSnapshot{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestMonthlyRecapSnapshotLeaseRecoveryAndFirstBuildFailure(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.MonthlyRecapSnapshot{}))
	require.NoError(t, db.Create(&model.MonthlyRecapSnapshot{UserID: 1, Period: "2025-01", RuleVersion: 1, LeaseToken: "interrupted", LeaseUntil: time.Now().Add(-time.Minute).Unix()}).Error)
	_, err := model.LoadMonthlyRecapSnapshot(context.Background(), 1, "2025-01", 1, false, func() (string, error) { return "", fmt.Errorf("source unavailable") })
	require.Error(t, err)
	got, err := model.LoadMonthlyRecapSnapshot(context.Background(), 1, "2025-01", 1, false, func() (string, error) { return `{"requests":5}`, nil })
	require.NoError(t, err)
	assert.Equal(t, `{"requests":5}`, got)
	got, err = model.LoadMonthlyRecapSnapshot(context.Background(), 1, "2025-01", 1, false, func() (string, error) { t.Fatal("saved snapshot must not be recomputed"); return "", nil })
	require.NoError(t, err)
	assert.Equal(t, `{"requests":5}`, got)
}

func TestMonthlyRecapSnapshotRejectsStaleLeaseWriter(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.MonthlyRecapSnapshot{}))
	_, err := model.LoadMonthlyRecapSnapshot(context.Background(), 1, "2025-01", 1, false, func() (string, error) {
		require.NoError(t, db.Model(&model.MonthlyRecapSnapshot{}).Where("user_id = ?", 1).Updates(map[string]interface{}{"lease_token": "new-owner", "payload": "new-result"}).Error)
		return "stale-result", nil
	})
	require.Error(t, err)
	got, err := model.LoadMonthlyRecapSnapshot(context.Background(), 1, "2025-01", 1, false, func() (string, error) { t.Fatal("must read the winner's saved result"); return "", nil })
	require.NoError(t, err)
	assert.Equal(t, "new-result", got)
}
