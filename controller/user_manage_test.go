package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/authz"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupManageUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedisEnabled := common.RedisEnabled
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	common.RedisEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(
		&model.User{}, &model.UserSession{}, &model.Log{}, &model.CasbinRule{}, &model.AuthzRole{},
	))

	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedisEnabled
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func performManageUserRequest(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/manage", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", 9999)
	c.Set("role", common.RoleRootUser)
	c.Set("username", "root-operator")
	ManageUser(c)
	return recorder
}

func TestManageUserDisableAdvancesAuthVersionOnceAndRevokesSession(t *testing.T) {
	db := setupManageUserTestDB(t)
	now := time.Now().Unix()
	user := model.User{
		Username: "managed-disable-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&model.UserSession{
		SID: "managed-disable-session", UserID: user.Id, Version: 1, UserAuthVersion: 1,
		Status: model.UserSessionStatusActive, RefreshHash: "refresh-hash", LoginMethod: "password",
		LastActiveAt: now, ExpiresAt: now + 3600,
	}).Error)

	recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"disable"}`, user.Id))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, updated.Status)
	assert.EqualValues(t, 2, updated.AuthVersion)
	var session model.UserSession
	require.NoError(t, db.First(&session, "sid = ?", "managed-disable-session").Error)
	assert.Equal(t, model.UserSessionStatusRevoked, session.Status)
}

func TestManageUserDemoteAdvancesAuthVersionAndRevokesSessionsOnce(t *testing.T) {
	db := setupManageUserTestDB(t)
	previousMaster := common.IsMasterNode
	common.IsMasterNode = false
	t.Cleanup(func() { common.IsMasterNode = previousMaster })
	require.NoError(t, authz.Init(db))

	now := time.Now().Unix()
	user := model.User{
		Username: "managed-demote-user", Password: "password", Role: common.RoleAdminUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	for _, sid := range []string{"managed-demote-session-one", "managed-demote-session-two"} {
		require.NoError(t, db.Create(&model.UserSession{
			SID: sid, UserID: user.Id, Version: 1, UserAuthVersion: 1,
			Status: model.UserSessionStatusActive, RefreshHash: "refresh-" + sid, LoginMethod: "password",
			LastActiveAt: now, ExpiresAt: now + 3600,
		}).Error)
	}

	sessionUpdateCount := 0
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:count_demote_session_updates", func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "user_sessions" {
			sessionUpdateCount++
		}
	}))

	recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"demote"}`, user.Id))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.RoleCommonUser, updated.Role)
	assert.EqualValues(t, 2, updated.AuthVersion)
	var sessions []model.UserSession
	require.NoError(t, db.Where("user_id = ?", user.Id).Order("sid asc").Find(&sessions).Error)
	require.Len(t, sessions, 2)
	for _, session := range sessions {
		assert.Equal(t, model.UserSessionStatusRevoked, session.Status)
		assert.Equal(t, "admin_demote", session.RevokedReason)
	}
	assert.Equal(t, 1, sessionUpdateCount)
}

func TestManageUserDeleteReturnsImmediatelyAndUnknownActionFails(t *testing.T) {
	db := setupManageUserTestDB(t)
	deleted := model.User{
		Username: "managed-delete-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "delete-aff",
	}
	require.NoError(t, db.Create(&deleted).Error)

	recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"delete"}`, deleted.Id))
	assert.Contains(t, recorder.Body.String(), `"success":true`)
	var deletedCount int64
	require.NoError(t, db.Unscoped().Model(&model.User{}).Where("id = ? AND deleted_at IS NOT NULL", deleted.Id).Count(&deletedCount).Error)
	assert.EqualValues(t, 1, deletedCount)

	unchanged := model.User{
		Username: "managed-unknown-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "unknown-aff",
	}
	require.NoError(t, db.Create(&unchanged).Error)
	recorder = performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"unknown"}`, unchanged.Id))
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	require.NoError(t, db.First(&unchanged, unchanged.Id).Error)
	assert.EqualValues(t, 1, unchanged.AuthVersion)
	assert.Equal(t, common.UserStatusEnabled, unchanged.Status)
}

func TestManageUserQuotaGrantsOneYearSubscriptionWithoutChangingWallet(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.UserSubscription{}))
	user := model.User{Username: "grant-user", Role: common.RoleCommonUser, Quota: 1234, Group: "default"}
	require.NoError(t, db.Create(&user).Error)
	recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":"add","value":500000}`, user.Id))
	require.Contains(t, recorder.Body.String(), `"success":true`)
	var subscription model.UserSubscription
	require.NoError(t, db.Where("user_id = ?", user.Id).First(&subscription).Error)
	assert.EqualValues(t, 500000, subscription.AmountTotal)
	assert.Zero(t, subscription.AmountUsed)
	assert.Equal(t, time.Unix(subscription.StartTime, 0).UTC().AddDate(1, 0, 0).Unix(), subscription.EndTime)
	assert.Equal(t, model.SubscriptionResetNever, subscription.ResetIntervalUnit)
	assert.Zero(t, subscription.NextResetTime)
	assert.Equal(t, "active", subscription.Status)
	assert.Equal(t, 9999, subscription.GrantedBy)
	assert.True(t, subscription.AllowWalletOverflow)
	assert.Empty(t, subscription.UpgradeGroup)
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, 1234, user.Quota)
	assert.Equal(t, "default", user.Group)
}

func TestManageUserQuotaRejectsRemovedModesAndInvalidAmounts(t *testing.T) {
	for _, tc := range []struct {
		name, mode string
		value      int
	}{
		{"subtract", "subtract", 100}, {"override", "override", 100},
		{"missing mode", "", 100}, {"zero", "add", 0}, {"negative", "add", -1},
		{"overflow", "add", 2147483648},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.UserSubscription{}))
			user := model.User{Username: "invalid-grant", Role: common.RoleCommonUser, Quota: 1234}
			require.NoError(t, db.Create(&user).Error)
			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, user.Id, tc.mode, tc.value))
			assert.Contains(t, recorder.Body.String(), `"success":false`)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, 1234, user.Quota)
			var count int64
			require.NoError(t, db.Model(&model.UserSubscription{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}
