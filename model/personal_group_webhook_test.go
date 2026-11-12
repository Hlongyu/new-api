package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupPersonalGroupWebhook(t *testing.T, enabled bool, watchedGroups []string) *PersonalGroup {
	t.Helper()
	setupPersonalGroupsDB(t)
	require.NoError(t, DB.AutoMigrate(&Option{}, &GroupRatioWebhook{}, &GroupRatioWebhookDelivery{}))
	group, err := CreatePersonalGroup(11, "watched", "Original description", 0.25)
	require.NoError(t, err)
	require.NoError(t, SaveGroupRatioWebhook(GroupRatioWebhook{Enabled: enabled, URL: "https://example.com/hook"}, watchedGroups))
	return group
}

func TestPersonalGroupRatioChangeQueuesWebhookWithoutChangingAdministratorOptions(t *testing.T) {
	group := setupPersonalGroupWebhook(t, true, []string{"custom-watched"})
	before := requireOptionValue(t, DB, "GroupRatio")
	require.NoError(t, UpdatePersonalGroup(11, group.Id, "Updated description", 0.2))
	var delivery GroupRatioWebhookDelivery
	require.NoError(t, DB.First(&delivery).Error)
	assert.Equal(t, "pending", delivery.Status)
	var event GroupRatioEvent
	require.NoError(t, common.UnmarshalJsonStr(delivery.Payload, &event))
	assert.Equal(t, "group.ratio.changed", event.Type)
	assert.Equal(t, delivery.ID, event.ID)
	assert.Equal(t, []GroupRatioChange{{Group: group.Name, OldRatio: 0.25, NewRatio: 0.2}}, event.Changes)
	assert.Equal(t, 0.2, ratio_setting.GetGroupRatio(group.Name))
	assert.Equal(t, before, requireOptionValue(t, DB, "GroupRatio"))
	assert.NotContains(t, ratio_setting.GroupRatio2JSONString(), group.Name)
	// A later change must compare with the latest committed personal ratio.
	require.NoError(t, UpdatePersonalGroup(11, group.Id, "Updated description", 0))
	var deliveries []GroupRatioWebhookDelivery
	require.NoError(t, DB.Find(&deliveries).Error)
	require.Len(t, deliveries, 2)
	for _, next := range deliveries {
		if next.ID == delivery.ID {
			continue
		}
		require.NoError(t, common.UnmarshalJsonStr(next.Payload, &event))
		assert.Equal(t, []GroupRatioChange{{Group: group.Name, OldRatio: 0.2, NewRatio: 0}}, event.Changes)
	}
}

func TestPersonalGroupWebhookIgnoresUnchangedUnwatchedDisabledAndUnauthorizedUpdates(t *testing.T) {
	for _, test := range []struct {
		name      string
		enabled   bool
		watched   []string
		owner     int
		ratio     float64
		wantError bool
	}{
		{"description only", true, []string{"custom-watched"}, 11, 0.25, false},
		{"unwatched", true, []string{"another-group"}, 11, 0.2, false},
		{"disabled webhook", false, []string{"custom-watched"}, 11, 0.2, false},
		{"another owner", true, []string{"custom-watched"}, 22, 0.2, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			group := setupPersonalGroupWebhook(t, test.enabled, test.watched)
			err := UpdatePersonalGroup(test.owner, group.Id, "Description change", test.ratio)
			if test.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			var count int64
			require.NoError(t, DB.Model(&GroupRatioWebhookDelivery{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestPersonalGroupRatioAndCacheRemainUnchangedWhenWebhookCannotBeQueued(t *testing.T) {
	group := setupPersonalGroupWebhook(t, true, []string{"custom-watched"})
	require.NoError(t, DB.Migrator().DropTable(&GroupRatioWebhookDelivery{}))
	require.Error(t, UpdatePersonalGroup(11, group.Id, "Must roll back", 0.2))
	var stored PersonalGroup
	require.NoError(t, DB.First(&stored, group.Id).Error)
	assert.Equal(t, 0.25, stored.Ratio)
	assert.Equal(t, "Original description", stored.Description)
	assert.Equal(t, 0.25, ratio_setting.GetGroupRatio(group.Name))
}
