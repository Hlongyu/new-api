package service

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLeaderboardCosmeticsRequireCurrentChallengerAndPersistAfterDemotion(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.LeaderboardEntry{}, &model.RenameCardBalance{}, &model.RenameEvent{}, &model.QuotaData{}, &model.RenameCardOrder{}, &model.SponsorOrder{}, &model.LeaderboardExcludedUser{}))
	previousDB, previousQuota, previousRedis := model.DB, common.QuotaPerUnit, common.RedisEnabled
	model.DB, common.QuotaPerUnit, common.RedisEnabled = db, 1, false
	invalidateRankReplayCache()
	t.Cleanup(func() {
		model.DB, common.QuotaPerUnit, common.RedisEnabled = previousDB, previousQuota, previousRedis
		invalidateRankReplayCache()
	})
	require.NoError(t, db.Create(&model.User{Id: 42, Username: "alice"}).Error)
	require.NoError(t, db.Create(&model.LeaderboardEntry{Id: 7, UserId: 42, Active: true, ParticipateRank: true}).Error)
	require.NoError(t, db.Create(&model.RenameCardBalance{UserId: 42, Balance: 3}).Error)
	title := "一二三四五六七八九十"
	_, err = UpdateLeaderboardMe(42, false, LeaderboardProfilePatch{CustomTitle: &title})
	require.ErrorContains(t, err, "最强王者")
	location, err := time.LoadLocation(leaderboardTimeZone)
	require.NoError(t, err)
	now := time.Now().In(location)
	// Replay a real promotion history through all eight promotion series.
	for day := 0; day <= 21; day++ {
		quota := 20
		if day == 0 {
			quota = 100_000
		}
		require.NoError(t, db.Create(&model.QuotaData{UserID: 42, CreatedAt: now.AddDate(0, 0, day-21).Unix(), UseGroup: "default", Quota: quota, Count: 1}).Error)
	}
	invalidateRankReplayCache()
	progress, err := GetRankProgress(42)
	require.NoError(t, err)
	require.Equal(t, "challenger", progress.TierKey)
	for _, invalid := range []string{"", "   ", title + "多"} {
		_, err = UpdateLeaderboardMe(42, false, LeaderboardProfilePatch{CustomTitle: &invalid})
		require.ErrorContains(t, err, "1-10")
	}
	avatar := "data:image/jpeg;base64,test"
	me, err := UpdateLeaderboardMe(42, false, LeaderboardProfilePatch{CustomTitle: &title, AvatarImage: &avatar})
	require.NoError(t, err)
	assert.Equal(t, title, me.Entry.CustomTitle)
	assert.Equal(t, avatar, me.Entry.AvatarImage)
	assert.Equal(t, 1, me.Rename.CardBalance)
	// Reduce the history to a lower rank and verify stored cosmetics still show.
	require.NoError(t, db.Model(&model.QuotaData{}).Where("user_id = ?", 42).Update("quota", 1).Error)
	invalidateRankReplayCache()
	board, err := GetTierBoard()
	require.NoError(t, err)
	require.Len(t, board.Entries, 1)
	assert.Equal(t, title, board.Entries[0].CustomTitle)
	assert.Equal(t, avatar, board.Entries[0].AvatarImage)
	next := "新称号"
	_, err = UpdateLeaderboardMe(42, false, LeaderboardProfilePatch{CustomTitle: &next})
	require.ErrorContains(t, err, "最强王者")
	_, err = UpdateLeaderboardMe(42, false, LeaderboardProfilePatch{AvatarImage: &next})
	require.ErrorContains(t, err, "最强王者")
}

func TestNormalizeLeaderboardAvatarBoundsAndReencodesUploads(t *testing.T) {
	var input bytes.Buffer
	require.NoError(t, png.Encode(&input, image.NewRGBA(image.Rect(0, 0, 200, 100))))
	avatar, err := NormalizeLeaderboardAvatar(input.Bytes())
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(avatar, "data:image/jpeg;base64,"))
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(avatar, "data:image/jpeg;base64,"))
	require.NoError(t, err)
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	require.NoError(t, err)
	assert.Equal(t, "jpeg", format)
	assert.Equal(t, 128, config.Width)
	assert.Equal(t, 128, config.Height)
	assert.Less(t, len(avatar), 65535)
	for _, invalid := range [][]byte{nil, []byte("<svg></svg>"), make([]byte, MaxLeaderboardAvatarBytes+1), input.Bytes()[:30]} {
		_, err = NormalizeLeaderboardAvatar(invalid)
		require.Error(t, err)
	}
	var huge bytes.Buffer
	require.NoError(t, png.Encode(&huge, image.NewGray(image.Rect(0, 0, 4097, 1))))
	_, err = NormalizeLeaderboardAvatar(huge.Bytes())
	require.ErrorContains(t, err, "尺寸")
}
