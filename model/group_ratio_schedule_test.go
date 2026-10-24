package model

import (
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScheduledGroupRatioExecutesOnceAtBeijingMidnight(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, DB.AutoMigrate(&GroupRatioSchedule{}))
	due := time.Date(2026, 10, 25, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*3600)).Unix()
	assert.Equal(t, time.Date(2026, 10, 24, 16, 0, 0, 0, time.UTC).Unix(), due)
	task, err := CreateGroupRatioSchedule("vip", .1, due, 7, due-60)
	require.NoError(t, err)
	changed, err := ApplyNextGroupRatioSchedule(due - 1)
	require.NoError(t, err)
	assert.False(t, changed)
	// Another group may have been edited after the schedule was created.
	require.NoError(t, UpdateOption("GroupRatio", `{"vip":1,"svip":4,"removed":1}`))
	require.NoError(t, DB.Where("1 = 1").Delete(&GroupRatioWebhookDelivery{}).Error)
	changed, err = ApplyNextGroupRatioSchedule(due)
	require.NoError(t, err)
	assert.True(t, changed)
	require.NoError(t, DB.First(task, task.ID).Error)
	assert.Equal(t, GroupRatioScheduleSucceeded, task.Status)
	assert.Equal(t, due, task.FinishedAt)
	require.NotNil(t, task.PreviousRatio)
	assert.Equal(t, 1.0, *task.PreviousRatio)
	assert.Equal(t, .1, ratio_setting.GetGroupRatio("vip"))
	assert.Equal(t, 4.0, ratio_setting.GetGroupRatio("svip"))
	assert.JSONEq(t, `{"vip":0.1,"svip":4,"removed":1}`, requireOptionValue(t, DB, "GroupRatio"))
	assert.Equal(t, requireOptionValue(t, DB, "GroupRatio"), requireOptionValue(t, DB, groupRatioAlias))
	// Simulate another runner or a restart after commit.
	changed, err = ApplyNextGroupRatioSchedule(due + 3600)
	require.NoError(t, err)
	assert.False(t, changed)
	var deliveries []GroupRatioWebhookDelivery
	require.NoError(t, DB.Find(&deliveries).Error)
	require.Len(t, deliveries, 1)
	var event GroupRatioEvent
	require.NoError(t, common.UnmarshalJsonStr(deliveries[0].Payload, &event))
	assert.Equal(t, []GroupRatioChange{{Group: "vip", OldRatio: 1, NewRatio: .1}}, event.Changes)
}

func TestScheduledGroupRatioCancellationAndDeletedGroup(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, DB.AutoMigrate(&GroupRatioSchedule{}))
	cancelled, err := CreateGroupRatioSchedule("vip", .1, 200, 1, 100)
	require.NoError(t, err)
	require.NoError(t, CancelGroupRatioSchedule(cancelled.ID, 150))
	require.ErrorIs(t, CancelGroupRatioSchedule(cancelled.ID, 151), ErrGroupRatioScheduleNotPending)
	missing, err := CreateGroupRatioSchedule("removed", .5, 200, 1, 100)
	require.NoError(t, err)
	require.NoError(t, UpdateOption("GroupRatio", `{"vip":1,"svip":2}`))
	changed, err := ApplyNextGroupRatioSchedule(200)
	require.NoError(t, err)
	assert.True(t, changed)
	require.NoError(t, DB.First(missing, missing.ID).Error)
	assert.Equal(t, GroupRatioScheduleFailed, missing.Status)
	assert.Equal(t, "group no longer exists", missing.Error)
	assert.False(t, ratio_setting.ContainsGroupRatio("removed"))
	assert.Equal(t, 1.0, ratio_setting.GetGroupRatio("vip"))
	require.ErrorIs(t, CancelGroupRatioSchedule(missing.ID, 201), ErrGroupRatioScheduleNotPending)
}

func TestScheduledGroupRatioOverdueChangesApplyInOrder(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, DB.AutoMigrate(&GroupRatioSchedule{}))
	_, err := CreateGroupRatioSchedule("vip", 2, 300, 1, 100)
	require.NoError(t, err)
	_, err = CreateGroupRatioSchedule("vip", 0, 200, 1, 100)
	require.NoError(t, err)
	changed, err := ApplyNextGroupRatioSchedule(400)
	require.NoError(t, err)
	require.True(t, changed)
	assert.Zero(t, ratio_setting.GetGroupRatio("vip"))
	changed, err = ApplyNextGroupRatioSchedule(400)
	require.NoError(t, err)
	require.True(t, changed)
	assert.Equal(t, 2.0, ratio_setting.GetGroupRatio("vip"))
}

func TestScheduledGroupRatioRollsBackAndCanRetryAfterStorageFailure(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, DB.AutoMigrate(&GroupRatioSchedule{}))
	task, err := CreateGroupRatioSchedule("vip", .1, 200, 1, 100)
	require.NoError(t, err)
	before := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, DB.Migrator().DropTable(&GroupRatioWebhookDelivery{}))
	changed, err := ApplyNextGroupRatioSchedule(200)
	require.Error(t, err)
	assert.False(t, changed)
	require.NoError(t, DB.First(task, task.ID).Error)
	assert.Equal(t, GroupRatioSchedulePending, task.Status)
	assert.Zero(t, task.FinishedAt)
	assert.Equal(t, before, ratio_setting.GroupRatio2JSONString())
	assert.JSONEq(t, `{"vip":1,"svip":2,"removed":1}`, requireOptionValue(t, DB, "GroupRatio"))
	require.NoError(t, DB.AutoMigrate(&GroupRatioWebhookDelivery{}))
	changed, err = ApplyNextGroupRatioSchedule(201)
	require.NoError(t, err)
	assert.True(t, changed)
}

func TestScheduledGroupRatioRejectsInvalidOrConflictingPlans(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, DB.AutoMigrate(&GroupRatioSchedule{}))
	for _, tc := range []struct {
		name, group string
		ratio       float64
		at          int64
	}{
		{"missing group", "unknown", 1, 200}, {"negative", "vip", -1, 200},
		{"nonfinite", "vip", math.Inf(1), 200}, {"nan", "vip", math.NaN(), 200},
		{"past", "vip", 1, 99}, {"now", "vip", 1, 100}, {"empty", "", 1, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := CreateGroupRatioSchedule(tc.group, tc.ratio, tc.at, 1, 100)
			require.Error(t, err)
		})
	}
	_, err := CreateGroupRatioSchedule("vip", 0, 200, 1, 100)
	require.NoError(t, err)
	_, err = CreateGroupRatioSchedule("vip", 2, 200, 1, 100)
	require.ErrorContains(t, err, "already exists")
}
