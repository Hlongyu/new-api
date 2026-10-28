package model

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPersonalGroupsDB(t *testing.T) {
	t.Helper()
	previousDB, previousLogDB := DB, LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	DB, LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	initCol()
	require.NoError(t, db.AutoMigrate(&PersonalGroup{}, &PersonalChannel{}, &PersonalChannelRevision{}, &Channel{}, &Ability{}, &Log{}))
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.SetMainDatabaseType(previousMain)
		common.SetLogDatabaseType(previousLog)
		initCol()
		ratio_setting.SetPersonalGroupRatios(nil)
		require.NoError(t, sqlDB.Close())
	})
}

func personalChannelFixture() PersonalChannelConfig {
	return PersonalChannelConfig{Name: "Example", Type: constant.ChannelTypeOpenAI, BaseURL: "https://example.com", Key: "secret-a", Models: "gpt-example", Weight: 10, Enabled: true}
}

func TestPersonalGroupOwnershipNamesAndRatios(t *testing.T) {
	setupPersonalGroupsDB(t)
	group, err := CreatePersonalGroup(11, "example", "Example group", 1.5)
	require.NoError(t, err)
	assert.Equal(t, "custom-example", group.Name)
	assert.Equal(t, 1.5, ratio_setting.GetGroupRatio(group.Name))
	_, err = CreatePersonalGroup(22, "custom-example", "", 1)
	require.Error(t, err)
	require.Error(t, UpdatePersonalGroup(22, group.Id, "hijacked", 0))
	assert.Equal(t, 1.5, ratio_setting.GetGroupRatio(group.Name))
	require.NoError(t, UpdatePersonalGroup(11, group.Id, "Updated", 0))
	assert.Equal(t, 0.0, ratio_setting.GetGroupRatio(group.Name))
	assert.NotContains(t, ratio_setting.GroupRatio2JSONString(), "custom-example")
	require.Error(t, ratio_setting.CheckGroupRatio(`{"custom-example":1}`))
	for _, value := range []float64{-1, math.NaN(), math.Inf(1), 1000001} {
		require.Error(t, UpdatePersonalGroup(11, group.Id, "", value))
	}
	_, err = CreatePersonalGroup(11, "a,b", "", 1)
	require.Error(t, err)
}

func TestPersonalChannelApprovalPublishesExactRevision(t *testing.T) {
	setupPersonalGroupsDB(t)
	group, err := CreatePersonalGroup(11, "review", "", 1)
	require.NoError(t, err)
	draft, err := SavePersonalChannelDraft(11, group.Id, 0, 0, personalChannelFixture())
	require.NoError(t, err)
	var count int64
	require.NoError(t, DB.Model(&Channel{}).Count(&count).Error)
	assert.Zero(t, count)
	assert.Empty(t, GetPublishedPersonalGroups())
	require.Error(t, SubmitPersonalChannel(22, draft.PersonalChannelID, draft.Id))
	require.NoError(t, SubmitPersonalChannel(11, draft.PersonalChannelID, draft.Id))
	require.NoError(t, ReviewPersonalChannel(99, draft.PersonalChannelID, draft.Id, true, ""))
	require.Error(t, ReviewPersonalChannel(99, draft.PersonalChannelID, draft.Id, true, ""))
	var live Channel
	require.NoError(t, DB.First(&live).Error)
	assert.Equal(t, "secret-a", live.Key)
	assert.Equal(t, 11, live.OwnerUserID)
	assert.Equal(t, group.Name, live.Group)
	assert.Contains(t, GetPublishedPersonalGroups(), group.Name)
	assert.Equal(t, []string{"gpt-example"}, GetGroupEnabledModels(group.Name))
	updated := personalChannelFixture()
	updated.Key = "secret-b"
	updated.Models = "new-model"
	change, err := SavePersonalChannelDraft(11, group.Id, draft.PersonalChannelID, draft.Id, updated)
	require.NoError(t, err)
	require.NoError(t, SubmitPersonalChannel(11, draft.PersonalChannelID, change.Id))
	require.NoError(t, DB.First(&live, live.Id).Error)
	assert.Equal(t, "secret-a", live.Key)
	require.Error(t, ReviewPersonalChannel(99, draft.PersonalChannelID, draft.Id, true, ""))
	require.NoError(t, ReviewPersonalChannel(99, draft.PersonalChannelID, change.Id, true, ""))
	require.NoError(t, DB.First(&live, live.Id).Error)
	assert.Equal(t, "secret-b", live.Key)
	assert.Equal(t, []string{"new-model"}, GetGroupEnabledModels(group.Name))
	views, total, err := ListPersonalChannels(11, false, 0, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, views, 1)
	assert.Empty(t, views[0].Config.Key)
	data, err := common.Marshal(views)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "secret-")
}

func TestPersonalChannelSupersededAndRejectedDraftsCannotPublish(t *testing.T) {
	setupPersonalGroupsDB(t)
	group, err := CreatePersonalGroup(11, "isolation", "", 1)
	require.NoError(t, err)
	_, err = SavePersonalChannelDraft(22, group.Id, 0, 0, personalChannelFixture())
	require.Error(t, err)
	draft, err := SavePersonalChannelDraft(11, group.Id, 0, 0, personalChannelFixture())
	require.NoError(t, err)
	require.NoError(t, SubmitPersonalChannel(11, draft.PersonalChannelID, draft.Id))
	updated := personalChannelFixture()
	updated.Key = ""
	updated.Name = "Changed"
	replacement, err := SavePersonalChannelDraft(11, group.Id, draft.PersonalChannelID, draft.Id, updated)
	require.NoError(t, err)
	require.Error(t, ReviewPersonalChannel(99, draft.PersonalChannelID, draft.Id, true, ""))
	_, err = SavePersonalChannelDraft(11, group.Id, draft.PersonalChannelID, draft.Id, updated)
	require.Error(t, err)
	require.NoError(t, SubmitPersonalChannel(11, draft.PersonalChannelID, replacement.Id))
	require.Error(t, ReviewPersonalChannel(99, draft.PersonalChannelID, replacement.Id, false, ""))
	require.NoError(t, ReviewPersonalChannel(99, draft.PersonalChannelID, replacement.Id, false, "Unavailable endpoint"))
	require.Error(t, ReviewPersonalChannel(99, draft.PersonalChannelID, replacement.Id, true, ""))
	var count int64
	require.NoError(t, DB.Model(&Channel{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestPersonalGroupLogsUnionRedactionAndStats(t *testing.T) {
	setupPersonalGroupsDB(t)
	group, err := CreatePersonalGroup(11, "logs", "", 1)
	require.NoError(t, err)
	rows := []Log{
		{UserId: 11, Group: group.Name, Type: LogTypeConsume, Quota: 10, ModelName: "a", TokenName: "own", Other: `{"admin_info":{"secret":"hidden"}}`},
		{UserId: 22, Group: group.Name, Type: LogTypeConsume, Quota: 20, ModelName: "a", TokenId: 7, TokenName: "private", Username: "other", Ip: "192.0.2.1", Content: "private body", Other: `{"private":"secret"}`, UpstreamRequestId: "private-id"},
		{UserId: 11, Group: "default", Type: LogTypeConsume, Quota: 30, ModelName: "a"},
		{UserId: 22, Group: "default", Type: LogTypeConsume, Quota: 40, ModelName: "a"},
	}
	for i := range rows {
		require.NoError(t, createLog(&rows[i]))
	}
	assert.Equal(t, 11, rows[1].GroupOwnerUserID)
	logs, total, err := GetUserLogs(11, 0, 0, 0, "", "", 0, 20, "", "", "")
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, logs, 3)
	for _, log := range logs {
		assert.NotContains(t, log.Other, "admin_info")
		if log.Quota == 20 {
			assert.Zero(t, log.UserId)
			assert.Zero(t, log.TokenId)
			assert.Equal(t, "other", log.Username)
			assert.Empty(t, log.Ip)
			assert.Empty(t, log.TokenName)
			assert.Empty(t, log.Content)
			assert.Empty(t, log.UpstreamRequestId)
			assert.JSONEq(t, `{}`, log.Other)
		}
	}
	_, total, err = GetUserLogs(11, 0, 0, 0, "", "private", 0, 20, "", "", "")
	require.NoError(t, err)
	assert.Zero(t, total)
	_, total, err = GetUserLogs(33, 0, 0, 0, "", "", 0, 20, "", "", "")
	require.NoError(t, err)
	assert.Zero(t, total)
	stat, err := SumUsedQuota(0, 0, 0, "", "", "", 0, "", 11)
	require.NoError(t, err)
	assert.Equal(t, 60, stat.Quota)
	stat, err = SumUsedQuota(0, 0, 0, "", "", "", 0, group.Name, 11)
	require.NoError(t, err)
	assert.Equal(t, 30, stat.Quota)
	_, _, err = GetUserLogs(0, 0, 0, 0, "", "", 0, 20, "", "", "")
	require.Error(t, err)
}

func TestPersonalModelDiscoveryCannotReuseAnotherOwnersKeyOrChangedOrigin(t *testing.T) {
	setupPersonalGroupsDB(t)
	group, err := CreatePersonalGroup(11, "models", "", 1)
	require.NoError(t, err)
	draft, err := SavePersonalChannelDraft(11, group.Id, 0, 0, personalChannelFixture())
	require.NoError(t, err)
	config := PersonalChannelConfig{Type: 1, BaseURL: "https://example.com"}
	require.Error(t, ResolvePersonalModelCredentials(22, draft.PersonalChannelID, &config))
	assert.Empty(t, config.Key)
	config.BaseURL = "https://other.example.com"
	require.Error(t, ResolvePersonalModelCredentials(11, draft.PersonalChannelID, &config))
	assert.Empty(t, config.Key)
	config.BaseURL = "https://example.com"
	require.NoError(t, ResolvePersonalModelCredentials(11, draft.PersonalChannelID, &config))
	assert.Equal(t, "secret-a", config.Key)
	config = personalChannelFixture()
	config.ModelMapping = `{"a":"b"}`
	require.Error(t, config.Validate())
}
