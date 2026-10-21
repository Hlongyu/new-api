package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAnnouncementTest(t *testing.T) *console_setting.ConsoleSetting {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.AnnouncementRead{}, &model.AutomaticAnnouncement{}, &model.Option{}))
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	previousDB := model.DB
	model.DB = db
	settings := console_setting.GetConsoleSetting()
	previousSettings := *settings
	settings.AnnouncementsEnabled = true
	settings.Announcements = `[
		{"id":1,"content":"Required update","publishDate":"2020-01-01T00:00:00Z","requireRead":true},
		{"id":2,"content":"Ordinary update","publishDate":"2020-01-02T00:00:00Z"},
		{"id":3,"content":"Future update","publishDate":"9999-01-01T00:00:00Z","requireRead":true}
	]`
	t.Cleanup(func() {
		common.OptionMap = previousOptions
		model.DB = previousDB
		*settings = previousSettings
		require.NoError(t, sqlDB.Close())
	})
	return settings
}

func TestAnnouncementDismissalPersistsPerAccountAndIsIdempotent(t *testing.T) {
	setupAnnouncementTest(t)
	pending, err := GetPendingAnnouncements(10)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	assert.Equal(t, "Required update", pending[0].Content)
	revision := pending[0].Revision
	require.NoError(t, DismissAnnouncement(10, revision))
	require.NoError(t, DismissAnnouncement(10, revision))

	pending, err = GetPendingAnnouncements(10)
	require.NoError(t, err)
	assert.Empty(t, pending)
	pending, err = GetPendingAnnouncements(20)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	assert.Equal(t, revision, pending[0].Revision)
	var records []model.AnnouncementRead
	require.NoError(t, model.DB.Find(&records).Error)
	require.Len(t, records, 1)
	assert.Equal(t, 10, records[0].UserId)
	assert.Positive(t, records[0].ReadAt)
}

func TestAnnouncementEditsRequireNewDismissalAndRejectStaleRevision(t *testing.T) {
	settings := setupAnnouncementTest(t)
	pending, err := GetPendingAnnouncements(10)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	previous := pending[0].Revision
	require.NoError(t, DismissAnnouncement(10, previous))
	settings.Announcements = `[{"id":1,"content":"Corrected update","publishDate":"2020-01-01T00:00:00Z","requireRead":true}]`
	pending, err = GetPendingAnnouncements(10)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	assert.NotEqual(t, previous, pending[0].Revision)
	assert.ErrorIs(t, DismissAnnouncement(10, previous), ErrAnnouncementUnavailable)
	require.NoError(t, DismissAnnouncement(10, pending[0].Revision))
}

func TestAnnouncementDisabledOrRemovedStopsReminders(t *testing.T) {
	settings := setupAnnouncementTest(t)
	pending, err := GetPendingAnnouncements(10)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	revision := pending[0].Revision
	settings.AnnouncementsEnabled = false
	pending, err = GetPendingAnnouncements(10)
	require.NoError(t, err)
	assert.Empty(t, pending)
	assert.ErrorIs(t, DismissAnnouncement(10, revision), ErrAnnouncementUnavailable)
	settings.AnnouncementsEnabled = true
	settings.Announcements = `[]`
	pending, err = GetPendingAnnouncements(10)
	require.NoError(t, err)
	assert.Empty(t, pending)
	assert.ErrorIs(t, DismissAnnouncement(10, revision), ErrAnnouncementUnavailable)
}

func TestAnnouncementPendingListIncludesItemsBeyondNotificationPreview(t *testing.T) {
	settings := setupAnnouncementTest(t)
	items := make([]map[string]interface{}, 21)
	for i := range items {
		items[i] = map[string]interface{}{"id": i + 1, "content": "Required update", "publishDate": "2020-01-01T00:00:00Z", "requireRead": true}
	}
	encoded, err := common.Marshal(items)
	require.NoError(t, err)
	settings.Announcements = string(encoded)
	pending, err := GetPendingAnnouncements(10)
	require.NoError(t, err)
	assert.Len(t, pending, 21)
}
