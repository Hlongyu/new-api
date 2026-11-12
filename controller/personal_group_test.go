package controller

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPersonalGroupControllerUsesAuthenticatedOwnerAndPublishesSelectableGroup(t *testing.T) {
	initModelListColumnNames(t)
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PersonalGroup{}, &model.PersonalChannel{}, &model.PersonalChannelRevision{}, &model.Channel{}, &model.Ability{}))
	t.Cleanup(func() { ratio_setting.SetPersonalGroupRatios(nil) })
	ctx, response := newAuthenticatedContext(t, http.MethodPost, "/api/personal/groups", map[string]any{"name": "http-example", "owner_user_id": 22, "ratio": 1.5}, 11)
	CreatePersonalGroup(ctx)
	var created struct {
		Success bool                `json:"success"`
		Data    model.PersonalGroup `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &created))
	require.True(t, created.Success)
	assert.Equal(t, 11, created.Data.OwnerUserID)
	assert.NotContains(t, service.GetUserUsableGroups("default"), created.Data.Name)
	ctx, response = newAuthenticatedContext(t, http.MethodPost, "/api/personal/channels", map[string]any{
		"group_id": created.Data.Id,
		"config":   map[string]any{"name": "Example", "type": 1, "base_url": "https://example.com", "key": "private-key", "models": "example-model", "enabled": true, "group": "default", "owner_user_id": 22},
	}, 11)
	SavePersonalChannelDraft(ctx)
	var saved struct {
		Success bool                          `json:"success"`
		Data    model.PersonalChannelRevision `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &saved))
	require.True(t, saved.Success)
	assert.NotContains(t, response.Body.String(), "private-key")
	require.NoError(t, model.SubmitPersonalChannel(11, saved.Data.PersonalChannelID, saved.Data.Id))
	require.NoError(t, model.ReviewPersonalChannel(99, saved.Data.PersonalChannelID, saved.Data.Id, true, ""))
	assert.True(t, service.IsUserSelectableGroup("default", created.Data.Name))
	assert.Equal(t, 1.5, service.GetUserGroupRatio("default", created.Data.Name))
	var live model.Channel
	require.NoError(t, db.First(&live).Error)
	assert.Equal(t, created.Data.Name, live.Group)
	assert.Equal(t, 11, live.OwnerUserID)
	for _, test := range []struct {
		owner   int
		body    map[string]any
		allowed bool
	}{
		{11, map[string]any{}, false},
		{22, map[string]any{"enabled": false, "owner_user_id": 11}, false},
		{11, map[string]any{"enabled": false, "owner_user_id": 22}, true},
		{11, map[string]any{"enabled": true}, true},
	} {
		ctx, response = newAuthenticatedContext(t, http.MethodPut, "/api/personal/channels/status", test.body, test.owner)
		ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(saved.Data.PersonalChannelID)}}
		SetPersonalChannelEnabled(ctx)
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.Equal(t, test.allowed, result.Success)
		if test.allowed {
			assert.Equal(t, test.body["enabled"], service.IsUserSelectableGroup("default", created.Data.Name))
		}
	}
	ctx, response = newAuthenticatedContext(t, http.MethodGet, "/api/personal/channels", nil, 22)
	ListPersonalChannels(ctx)
	var other struct {
		Success bool `json:"success"`
		Data    struct {
			Total int `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &other))
	require.True(t, other.Success)
	assert.Zero(t, other.Data.Total)
}
