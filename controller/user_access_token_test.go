package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type accessTokenResponse struct {
	Success bool   `json:"success"`
	Data    string `json:"data"`
}

func performAccessTokenRequest(t *testing.T, userID int, regenerate *bool) accessTokenResponse {
	t.Helper()
	requestURL := "/api/user/token"
	if regenerate != nil {
		requestURL = fmt.Sprintf("%s?regenerate=%t", requestURL, *regenerate)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, requestURL, nil)
	c.Set("id", userID)
	GenerateAccessToken(c)

	assert.Equal(t, http.StatusOK, recorder.Code)
	var response accessTokenResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	return response
}

func TestGenerateAccessTokenReturnsExistingTokenWithoutRotation(t *testing.T) {
	db := setupManageUserTestDB(t)
	existingToken := "existing-management-token"
	user := model.User{
		Username:    "access-token-existing-user",
		Password:    "password",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AccessToken: &existingToken,
	}
	require.NoError(t, db.Create(&user).Error)

	regenerate := false
	response := performAccessTokenRequest(t, user.Id, &regenerate)
	assert.Equal(t, existingToken, response.Data)

	var stored model.User
	require.NoError(t, db.First(&stored, user.Id).Error)
	assert.Equal(t, existingToken, stored.GetAccessToken())
}

func TestGenerateAccessTokenCreatesTokenWhenExistingTokenIsAbsent(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{
		Username: "access-token-empty-user",
		Password: "password",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, db.Create(&user).Error)

	regenerate := false
	response := performAccessTokenRequest(t, user.Id, &regenerate)
	assert.NotEmpty(t, response.Data)

	var stored model.User
	require.NoError(t, db.First(&stored, user.Id).Error)
	assert.Equal(t, response.Data, stored.GetAccessToken())
}

func TestGenerateAccessTokenPreservesDefaultRotationBehavior(t *testing.T) {
	db := setupManageUserTestDB(t)
	existingToken := "management-token-before-rotation"
	user := model.User{
		Username:    "access-token-rotation-user",
		Password:    "password",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AccessToken: &existingToken,
	}
	require.NoError(t, db.Create(&user).Error)

	response := performAccessTokenRequest(t, user.Id, nil)
	assert.NotEmpty(t, response.Data)
	assert.NotEqual(t, existingToken, response.Data)

	var stored model.User
	require.NoError(t, db.First(&stored, user.Id).Error)
	assert.Equal(t, response.Data, stored.GetAccessToken())
}
