package model

import (
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupGroupRatioWebhookDB(t *testing.T) {
	t.Helper()
	previousDB, previousType := DB, common.MainDatabaseType()
	previousRatios := ratio_setting.GroupRatio2JSONString()
	previousOverrides := ratio_setting.GroupGroupRatio2JSONString()
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&Option{}, &GroupRatioWebhook{}, &GroupRatioWebhookDelivery{}))
	require.NoError(t, db.Create(&Option{Key: "GroupRatio", Value: `{"vip":1,"svip":2,"removed":1}`}).Error)
	require.NoError(t, SaveGroupRatioWebhook(GroupRatioWebhook{Enabled: true, URL: "https://example.com/hook", Secret: strings.Repeat("s", 32)}, []string{"vip", "svip", "added", "removed", "vip"}))
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(previousOverrides))
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
		require.NoError(t, sqlDB.Close())
	})
}

func TestGroupRatioWebhookChangesAreAtomicAndFiltered(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	raw := `{"vip":0.8,"svip":0,"added":3}`
	require.NoError(t, UpdateOption(groupRatioAlias, raw))
	var deliveries []GroupRatioWebhookDelivery
	require.NoError(t, DB.Find(&deliveries).Error)
	require.Len(t, deliveries, 1)
	var event GroupRatioEvent
	require.NoError(t, common.UnmarshalJsonStr(deliveries[0].Payload, &event))
	assert.Equal(t, "group.ratio.changed", event.Type)
	assert.Equal(t, []GroupRatioChange{{"svip", 2, 0}, {"vip", 1, 0.8}}, event.Changes)
	assert.Equal(t, deliveries[0].ID, event.ID)
	assert.Equal(t, raw, requireOptionValue(t, DB, "GroupRatio"))
	assert.Equal(t, raw, requireOptionValue(t, DB, groupRatioAlias))
	require.NoError(t, UpdateOption("GroupRatio", `{"added":3,"svip":0.0,"vip":0.80}`))
	require.NoError(t, UpdateOption("GroupGroupRatio", `{"vip":{"svip":7}}`))
	var count int64
	require.NoError(t, DB.Model(&GroupRatioWebhookDelivery{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestGroupRatioWebhookRollsBackWhenOutboxWriteFails(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, DB.Migrator().DropTable(&GroupRatioWebhookDelivery{}))
	before := ratio_setting.GroupRatio2JSONString()
	require.Error(t, UpdateOptionsBulk(map[string]string{"GroupRatio": `{"vip":0.5}`, "OtherOption": "value"}))
	assert.Equal(t, `{"vip":1,"svip":2,"removed":1}`, requireOptionValue(t, DB, "GroupRatio"))
	assert.Equal(t, before, ratio_setting.GroupRatio2JSONString())
	requireOptionMissing(t, DB, "OtherOption")
}

func TestGroupRatioWebhookDisabledAndInvalidChangesDoNotNotify(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, SaveGroupRatioWebhook(GroupRatioWebhook{}, nil))
	config, err := GetGroupRatioWebhook()
	require.NoError(t, err)
	assert.Equal(t, strings.Repeat("s", 32), config.Secret)
	require.NoError(t, UpdateOption("GroupRatio", `{"vip":0.7}`))
	for _, raw := range []string{`null`, `[]`, `{"vip":-1}`, `{"vip":1e999}`} {
		require.Error(t, UpdateOption(groupRatioAlias, raw))
	}
	var count int64
	require.NoError(t, DB.Model(&GroupRatioWebhookDelivery{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestGroupRatioWebhookLeaseRetryAndRecovery(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, UpdateOption("GroupRatio", `{"vip":0.5}`))
	now := time.Now().Unix()
	first, err := ClaimGroupRatioWebhook(now)
	require.NoError(t, err)
	require.NotNil(t, first)
	other, err := ClaimGroupRatioWebhook(now)
	require.NoError(t, err)
	assert.Nil(t, other)
	recovered, err := ClaimGroupRatioWebhook(now + 61)
	require.NoError(t, err)
	require.NotNil(t, recovered)
	assert.NotEqual(t, first.Lease, recovered.Lease)
	require.NoError(t, FinishGroupRatioWebhook(first, 200, "", now+62))
	require.NoError(t, FinishGroupRatioWebhook(recovered, 503, "unavailable", now+62))
	var stored GroupRatioWebhookDelivery
	require.NoError(t, DB.First(&stored, "id = ?", first.ID).Error)
	assert.Equal(t, "pending", stored.Status)
	assert.Equal(t, 1, stored.Attempts)
	assert.Equal(t, now+92, stored.NextAttemptAt)
	for attempt := 2; attempt <= 8; attempt++ {
		delivery, err := ClaimGroupRatioWebhook(stored.NextAttemptAt)
		require.NoError(t, err)
		require.NotNil(t, delivery)
		require.NoError(t, FinishGroupRatioWebhook(delivery, 503, "unavailable", stored.NextAttemptAt))
		require.NoError(t, DB.First(&stored, "id = ?", first.ID).Error)
	}
	assert.Equal(t, "failed", stored.Status)
	require.NoError(t, RetryGroupRatioWebhook(stored.ID))
	delivery, err := ClaimGroupRatioWebhook(time.Now().Unix())
	require.NoError(t, err)
	require.NotNil(t, delivery)
	assert.Equal(t, first.ID, delivery.ID)
	assert.Equal(t, first.Payload, delivery.Payload)
	require.NoError(t, FinishGroupRatioWebhook(delivery, 204, "", now+1000))
	require.NoError(t, DB.First(&stored, "id = ?", first.ID).Error)
	assert.Equal(t, "delivered", stored.Status)
	require.Error(t, RetryGroupRatioWebhook(stored.ID))
}

func TestGroupRatioWebhookRejectsUnsafeConfiguration(t *testing.T) {
	for _, address := range []string{"http://example.com", "https://127.0.0.1/hook", "https://[::1]/", "https://10.0.0.1", "https://user:pass@example.com", "https://example.com:8080", "https://example.com/#fragment"} {
		t.Run(address, func(t *testing.T) { assert.Error(t, ValidateGroupRatioWebhook(GroupRatioWebhook{URL: address}, nil)) })
	}
	assert.Error(t, ValidateGroupRatioWebhook(GroupRatioWebhook{Enabled: true, URL: "https://example.com", Secret: "short"}, []string{"vip"}))
}

func TestGroupRatioWebhookRollsBackEventWhenRatioSaveFails(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register("fail_group_ratio_save", func(tx *gorm.DB) {
		if option, ok := tx.Statement.Dest.(*Option); ok && isGroupRatioOption(option.Key) {
			tx.AddError(assert.AnError)
		}
	}))
	require.Error(t, UpdateOption("GroupRatio", `{"vip":0.5}`))
	var count int64
	require.NoError(t, DB.Model(&GroupRatioWebhookDelivery{}).Count(&count).Error)
	assert.Zero(t, count)
	assert.Equal(t, `{"vip":1,"svip":2,"removed":1}`, requireOptionValue(t, DB, "GroupRatio"))
}

func TestGroupRatioWebhookCanBeEnabledWithoutSigningSecret(t *testing.T) {
	setupGroupRatioWebhookDB(t)
	require.NoError(t, DB.Where("id = ?", 1).Delete(&GroupRatioWebhook{}).Error)
	require.NoError(t, SaveGroupRatioWebhook(GroupRatioWebhook{Enabled: true, URL: "https://example.com/hook"}, []string{"vip"}))
	config, err := GetGroupRatioWebhook()
	require.NoError(t, err)
	assert.Empty(t, config.Secret)
	require.NoError(t, UpdateOption("GroupRatio", `{"vip":0.5}`))
	var delivery GroupRatioWebhookDelivery
	require.NoError(t, DB.First(&delivery).Error)
	assert.Empty(t, delivery.Secret)
}
