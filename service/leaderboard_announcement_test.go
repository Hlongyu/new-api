package service

import (
	"errors"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupFirstChallengerTest(t *testing.T) {
	t.Helper()
	settings := setupAnnouncementTest(t)
	settings.Announcements = `[{"id":1,"content":"Manual announcement","publishDate":"2020-01-01T00:00:00Z"}]`
	require.NoError(t, model.DB.AutoMigrate(
		&model.QuotaData{}, &model.SponsorOrder{}, &model.RenameCardOrder{},
		&model.LeaderboardEntry{}, &model.LeaderboardExcludedUser{}, &model.CompanionMigration{},
		&model.User{},
	))
	previousQuotaPerUnit := common.QuotaPerUnit
	previousMigrationRequired := common.LeaderboardMigrationRequired
	common.QuotaPerUnit = 1
	common.LeaderboardMigrationRequired = false
	invalidateRankReplayCache()
	t.Cleanup(func() {
		common.QuotaPerUnit = previousQuotaPerUnit
		common.LeaderboardMigrationRequired = previousMigrationRequired
		invalidateRankReplayCache()
	})
}

func seedChallengerHistory(t *testing.T, userId int, startDay int, score int) {
	t.Helper()
	location, err := time.LoadLocation(leaderboardTimeZone)
	require.NoError(t, err)
	start := time.Date(2026, time.January, startDay, 12, 0, 0, 0, location)
	rows := []model.QuotaData{{UserID: userId, CreatedAt: start.Unix(), UseGroup: "default", Quota: score, Count: 1}}
	for day := 1; day <= 21; day++ {
		rows = append(rows, model.QuotaData{UserID: userId, CreatedAt: start.AddDate(0, 0, day).Unix(), UseGroup: "default", Quota: 20, Count: 1})
	}
	require.NoError(t, model.DB.Create(&rows).Error)
	require.NoError(t, model.DB.Create(&model.LeaderboardEntry{
		Id: userId, UserId: userId, Active: true, ParticipateRank: true,
		IsNamePublic: true, DisplayName: "Champion", AnonymousName: "匿名王者",
	}).Error)
}

func TestFirstChallengerBackfillsEarliestDayAndUsesBoardOrderForTies(t *testing.T) {
	for _, test := range []struct {
		name        string
		secondStart int
		firstScore  int
		secondScore int
		winner      int
	}{
		{"earlier achievement beats higher current score", 2, 10_000, 100_000, 10},
		{"same day uses leaderboard total score", 1, 10_000, 100_000, 20},
		{"same day uses leaderboard rank value", 1, 3_100, 100_000, 20},
		{"same rank and score uses entry id", 1, 100_000, 100_000, 10},
	} {
		t.Run(test.name, func(t *testing.T) {
			setupFirstChallengerTest(t)
			seedChallengerHistory(t, 10, 1, test.firstScore)
			seedChallengerHistory(t, 20, test.secondStart, test.secondScore)
			done, err := PublishFirstChallengerAnnouncement()
			require.NoError(t, err)
			assert.True(t, done)
			announcements, err := model.ListAutomaticAnnouncements()
			require.NoError(t, err)
			require.Len(t, announcements, 1)
			assert.Equal(t, test.winner, announcements[0].UserId)
			assert.Equal(t, "2026-01-22", announcements[0].AchievedOn)
			assert.Contains(t, announcements[0].Content, "全站首位最强王者")
			assert.Positive(t, announcements[0].PublishedAt)
		})
	}
}

func TestFirstChallengerSkipsExcludedAndOptedOutProfilesAndKeepsAnonymousName(t *testing.T) {
	setupFirstChallengerTest(t)
	seedChallengerHistory(t, 10, 1, 100_000)
	seedChallengerHistory(t, 20, 2, 100_000)
	seedChallengerHistory(t, 30, 3, 100_000)
	require.NoError(t, model.DB.Create(&model.LeaderboardExcludedUser{UserId: 10}).Error)
	require.NoError(t, model.DB.Model(&model.LeaderboardEntry{}).Where("user_id = ?", 20).Update("participate_rank", false).Error)
	require.NoError(t, model.DB.Model(&model.LeaderboardEntry{}).Where("user_id = ?", 30).Updates(map[string]interface{}{
		"is_name_public": false, "display_name": "Private name", "username": "Private login",
	}).Error)
	done, err := PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	assert.True(t, done)
	announcements, err := model.ListAutomaticAnnouncements()
	require.NoError(t, err)
	require.Len(t, announcements, 1)
	assert.Equal(t, 30, announcements[0].UserId)
	assert.Contains(t, announcements[0].Content, "匿名王者")
	assert.NotContains(t, announcements[0].Content, "Private")
}

func TestFirstChallengerPublicationSurvivesRetryAndFeedsDismissibleTimeline(t *testing.T) {
	setupFirstChallengerTest(t)
	seedChallengerHistory(t, 10, 1, 100_000)
	require.NoError(t, model.DB.Model(&model.LeaderboardEntry{}).Where("user_id = ?", 10).Update("display_name", "[Winner](https://example.com)<img>*").Error)
	done, err := PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	require.True(t, done)
	original, err := model.ListAutomaticAnnouncements()
	require.NoError(t, err)
	require.Len(t, original, 1)
	assert.Contains(t, original[0].Content, `\[Winner\]\(https://example\.com\)\<img\>\*`)

	// A competing publisher and a restarted worker cannot replace the receipt.
	require.NoError(t, model.PublishAutomaticAnnouncement(&model.AutomaticAnnouncement{
		EventKey: firstChallengerAnnouncementEvent, UserId: 20, Content: "Duplicate",
	}))
	invalidateRankReplayCache()
	done, err = PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	assert.True(t, done)
	after, err := model.ListAutomaticAnnouncements()
	require.NoError(t, err)
	assert.Equal(t, original, after)
	timeline, err := GetTimelineAnnouncements()
	require.NoError(t, err)
	require.Len(t, timeline, 2)
	assert.Equal(t, true, timeline[0]["requireRead"])
	assert.Equal(t, "Manual announcement", timeline[1]["content"])
	assert.NotContains(t, timeline[0], "user_id")
	pending, err := GetPendingAnnouncements(50)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	assert.Equal(t, "system:"+firstChallengerAnnouncementEvent, pending[0].Id)
	require.NoError(t, DismissAnnouncement(50, pending[0].Revision))
	pending, err = GetPendingAnnouncements(50)
	require.NoError(t, err)
	assert.Empty(t, pending)
	pending, err = GetPendingAnnouncements(60)
	require.NoError(t, err)
	assert.Len(t, pending, 1)
}

func TestFirstChallengerWaitsForMigrationAndQualification(t *testing.T) {
	setupFirstChallengerTest(t)
	done, err := PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	assert.False(t, done)
	seedChallengerHistory(t, 10, 1, 100_000)
	common.LeaderboardMigrationRequired = true
	done, err = PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	assert.False(t, done)
	common.LeaderboardMigrationRequired = false
	invalidateRankReplayCache()
	done, err = PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	assert.True(t, done)
}

func TestFirstChallengerSkipsInactiveProfileAndDiscoversNewAnonymousProfile(t *testing.T) {
	setupFirstChallengerTest(t)
	seedChallengerHistory(t, 10, 1, 100_000)
	seedChallengerHistory(t, 20, 2, 100_000)
	require.NoError(t, model.DB.Model(&model.LeaderboardEntry{}).Where("user_id = ?", 10).Update("active", false).Error)
	require.NoError(t, model.DB.Where("user_id = ?", 20).Delete(&model.LeaderboardEntry{}).Error)
	require.NoError(t, model.DB.Create(&model.User{Id: 20, Username: "Private-login", DisplayName: "Private-display"}).Error)
	done, err := PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	assert.True(t, done)
	announcements, err := model.ListAutomaticAnnouncements()
	require.NoError(t, err)
	require.Len(t, announcements, 1)
	assert.Equal(t, 20, announcements[0].UserId)
	assert.Contains(t, announcements[0].Content, "匿名用户")
	assert.NotContains(t, announcements[0].Content, "Private")
}

func TestFirstChallengerRetriesAfterPublicationWriteFailure(t *testing.T) {
	setupFirstChallengerTest(t)
	seedChallengerHistory(t, 10, 1, 100_000)
	writeFailure := errors.New("announcement storage unavailable")
	require.NoError(t, model.DB.Callback().Create().Before("gorm:create").Register("announcement_write_failure", func(db *gorm.DB) {
		if db.Statement.Table == "automatic_announcements" {
			db.AddError(writeFailure)
		}
	}))
	done, err := PublishFirstChallengerAnnouncement()
	require.ErrorIs(t, err, writeFailure)
	assert.False(t, done)
	require.NoError(t, model.DB.Callback().Create().Remove("announcement_write_failure"))
	published, err := model.HasAutomaticAnnouncement(firstChallengerAnnouncementEvent)
	require.NoError(t, err)
	assert.False(t, published)
	done, err = PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	assert.True(t, done)
}

func TestFirstChallengerCanBeEditedDisabledAndDeletedThroughAnnouncementSettings(t *testing.T) {
	setupFirstChallengerTest(t)
	seedChallengerHistory(t, 10, 1, 100_000)
	_, err := PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	pending, err := GetPendingAnnouncements(50)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	require.NoError(t, DismissAnnouncement(50, pending[0].Revision))
	timeline, err := GetTimelineAnnouncements()
	require.NoError(t, err)
	require.Len(t, timeline, 2)
	known := []string{"system:" + firstChallengerAnnouncementEvent}
	timeline[0]["content"] = "Edited champion announcement"
	timeline[0]["requireRead"] = false
	encoded, err := common.Marshal(timeline)
	require.NoError(t, err)
	require.NoError(t, model.SaveManagedAnnouncements(string(encoded), known))
	pending, err = GetPendingAnnouncements(50)
	require.NoError(t, err)
	assert.Empty(t, pending)
	timeline, err = GetTimelineAnnouncements()
	require.NoError(t, err)
	assert.Equal(t, "Edited champion announcement", timeline[0]["content"])
	assert.Equal(t, false, timeline[0]["requireRead"])
	timeline[0]["requireRead"] = true
	encoded, err = common.Marshal(timeline)
	require.NoError(t, err)
	require.NoError(t, model.SaveManagedAnnouncements(string(encoded), known))
	pending, err = GetPendingAnnouncements(50)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	assert.Equal(t, "Edited champion announcement", pending[0].Content)
	require.NoError(t, DismissAnnouncement(50, pending[0].Revision))
	require.NoError(t, model.SaveManagedAnnouncements(string(encoded), known))
	pending, err = GetPendingAnnouncements(50)
	require.NoError(t, err)
	assert.Empty(t, pending, "saving unchanged content must preserve dismissal")

	encoded, err = common.Marshal(timeline[1:])
	require.NoError(t, err)
	require.NoError(t, model.SaveManagedAnnouncements(string(encoded), known))
	done, err := PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	assert.True(t, done)
	timeline, err = GetTimelineAnnouncements()
	require.NoError(t, err)
	require.Len(t, timeline, 1)
	assert.Equal(t, "Manual announcement", timeline[0]["content"])
	assert.NoError(t, model.SaveManagedAnnouncements(string(encoded), known))
	events, err := model.ListAutomaticAnnouncements()
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.True(t, events[0].Deleted)
}

func TestFirstChallengerPublishedWhileEditorIsOpenSurvivesStaleSave(t *testing.T) {
	setupFirstChallengerTest(t)
	seedChallengerHistory(t, 10, 1, 100_000)
	before, err := GetTimelineAnnouncements()
	require.NoError(t, err)
	encoded, err := common.Marshal(before)
	require.NoError(t, err)
	_, err = PublishFirstChallengerAnnouncement()
	require.NoError(t, err)
	require.NoError(t, model.SaveManagedAnnouncements(string(encoded), nil))
	after, err := GetTimelineAnnouncements()
	require.NoError(t, err)
	require.Len(t, after, 2)
	assert.Equal(t, "system:"+firstChallengerAnnouncementEvent, after[0]["id"])

	after[0]["content"] = "Must roll back"
	encoded, err = common.Marshal(after)
	require.NoError(t, err)
	require.NoError(t, model.DB.Migrator().DropTable(&model.Option{}))
	require.Error(t, model.SaveManagedAnnouncements(string(encoded), []string{"system:" + firstChallengerAnnouncementEvent}))
	unchanged, err := GetTimelineAnnouncements()
	require.NoError(t, err)
	assert.NotEqual(t, "Must roll back", unchanged[0]["content"])
}
