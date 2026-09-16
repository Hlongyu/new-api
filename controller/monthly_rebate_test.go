package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMonthlyRebateAdminReviewAndIssuanceAPI(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.MonthlyRebate{}, &model.PostpaidSettlement{}, &model.UserSubscription{}, &model.Midjourney{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "rebate-api-user", Quota: 1234}).Error)
	now := time.Now().In(time.FixedZone("Beijing", 8*3600))
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).AddDate(0, -1, 0)
	period := monthStart.Format("2006-01")
	require.NoError(t, db.Create(&model.PostpaidSettlement{RequestId: "rebate-api", UserId: 1, WalletQuota: 500000000, StartedAt: monthStart.Unix()}).Error)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("id", 99); c.Set("role", common.RoleAdminUser) })
	r.GET("/rebates", AdminListMonthlyRebates)
	r.POST("/rebates/recalculate", AdminRecalculateMonthlyRebates)
	r.POST("/rebates/:id/issue", AdminIssueMonthlyRebate)
	recorder := httptest.NewRecorder()
	r.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/rebates/recalculate", strings.NewReader(fmt.Sprintf(`{"period":%q}`, period))))
	require.Equal(t, http.StatusOK, recorder.Code)
	require.Contains(t, recorder.Body.String(), `"success":true`)
	var bill model.MonthlyRebate
	require.NoError(t, db.First(&bill).Error)
	var grants int64
	require.NoError(t, db.Model(&model.UserSubscription{}).Count(&grants).Error)
	assert.Zero(t, grants)
	recorder = httptest.NewRecorder()
	r.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/rebates?period="+period+"&status=pending&user_id=1", nil))
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"total":1`)
	assert.Contains(t, recorder.Body.String(), `"username":"rebate-api-user"`)
	recorder = httptest.NewRecorder()
	r.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, fmt.Sprintf("/rebates/%d/issue", bill.Id), strings.NewReader(`{"revision":999}`)))
	assert.Equal(t, http.StatusConflict, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"code":"REBATE_CHANGED"`)
	recorder = httptest.NewRecorder()
	r.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, fmt.Sprintf("/rebates/%d/issue", bill.Id), strings.NewReader(fmt.Sprintf(`{"revision":%d}`, bill.Revision))))
	require.Equal(t, http.StatusOK, recorder.Code)
	require.Contains(t, recorder.Body.String(), `"success":true`)
	require.NoError(t, db.First(&bill, bill.Id).Error)
	assert.Equal(t, 99, bill.IssuedBy)
	assert.Equal(t, model.MonthlyRebateIssued, bill.Status)
	var user model.User
	require.NoError(t, db.First(&user, 1).Error)
	assert.Equal(t, 1234, user.Quota)
	for _, path := range []string{"/rebates?period=invalid", "/rebates?period=" + now.Format("2006-01"), "/rebates?period=" + period + "&status=unknown", "/rebates?period=" + period + "&user_id=-1"} {
		recorder = httptest.NewRecorder()
		r.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, http.StatusBadRequest, recorder.Code, path)
	}
}

func TestMonthlyRebateAdminRoutesRejectAnonymousAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	admin := r.Group("/rebates", middleware.AdminAuth())
	admin.GET("", AdminListMonthlyRebates)
	admin.POST("/recalculate", AdminRecalculateMonthlyRebates)
	admin.POST("/:id/issue", AdminIssueMonthlyRebate)
	for _, request := range []struct{ method, path string }{
		{http.MethodGet, "/rebates"}, {http.MethodPost, "/rebates/recalculate"}, {http.MethodPost, "/rebates/1/issue"},
	} {
		recorder := httptest.NewRecorder()
		r.ServeHTTP(recorder, httptest.NewRequest(request.method, request.path, nil))
		assert.Equal(t, http.StatusUnauthorized, recorder.Code)
	}
}
