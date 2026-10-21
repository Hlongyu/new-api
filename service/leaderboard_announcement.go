package service

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	rankengine "github.com/QuantumNous/new-api/pkg/rank"
	"gorm.io/gorm"
)

const firstChallengerAnnouncementEvent = "leaderboard-first-challenger"

// StartLeaderboardAnnouncementTask also backfills the first eligible historical
// challenger. After publication there is no need to keep scanning rank history.
func StartLeaderboardAnnouncementTask() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			done, err := PublishFirstChallengerAnnouncement()
			if err != nil {
				common.SysError("failed to publish first challenger announcement: " + err.Error())
			}
			if done {
				return
			}
			<-ticker.C
		}
	}()
}

func PublishFirstChallengerAnnouncement() (bool, error) {
	published, err := model.HasAutomaticAnnouncement(firstChallengerAnnouncementEvent)
	if err != nil || published {
		return published, err
	}
	if common.LeaderboardMigrationRequired {
		ready, err := model.HasCompletedCompanionMigration()
		if err != nil || !ready {
			return false, err
		}
	}
	progresses, _, _, err := getRankProgresses(0)
	if err != nil {
		return false, err
	}
	userIds := make([]int, 0)
	for userId, progress := range progresses {
		if progress.ChallengerReachedOn != "" {
			userIds = append(userIds, userId)
		}
	}
	if len(userIds) == 0 {
		return false, nil
	}
	entries, err := model.GetLeaderboardProfilesByUserIds(userIds)
	if err != nil {
		return false, err
	}
	known := make(map[int]bool, len(entries))
	for _, entry := range entries {
		known[entry.UserId] = true
	}
	sort.Ints(userIds)
	for _, userId := range userIds {
		if known[userId] {
			continue
		}
		entry, err := EnsureLeaderboardProfile(userId)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return false, err
		}
		entries = append(entries, *entry)
	}
	excludedIds, err := model.GetExcludedLeaderboardUserIds()
	if err != nil {
		return false, err
	}
	excluded := make(map[int]bool, len(excludedIds))
	for _, id := range excludedIds {
		excluded[id] = true
	}
	var winner *model.LeaderboardEntry
	var winnerProgress rankengine.Progress
	for i := range entries {
		entry := &entries[i]
		progress := progresses[entry.UserId]
		if !entry.Active || excluded[entry.UserId] || !entry.ParticipateRank || progress.ChallengerReachedOn == "" {
			continue
		}
		// Same-day candidates follow GetTierBoard's rank value, total score,
		// and entry ID ordering. Never use map iteration order to choose a winner.
		if winner != nil {
			if progress.ChallengerReachedOn > winnerProgress.ChallengerReachedOn {
				continue
			}
			if progress.ChallengerReachedOn == winnerProgress.ChallengerReachedOn {
				if progress.RankValue < winnerProgress.RankValue ||
					(progress.RankValue == winnerProgress.RankValue && progress.TotalScore < winnerProgress.TotalScore) ||
					(progress.RankValue == winnerProgress.RankValue && progress.TotalScore == winnerProgress.TotalScore && entry.Id > winner.Id) {
					continue
				}
			}
		}
		winner = entry
		winnerProgress = progress
	}
	if winner == nil {
		return false, nil
	}
	// Names are data, not Markdown/HTML. Preserve the leaderboard privacy mode
	// while escaping formatting and links in user-controlled display names.
	name := leaderboardDisplayName(*winner)
	if !winner.IsNamePublic && winner.AnonymousName == "" {
		name = "匿名用户"
	}
	var escaped strings.Builder
	for _, char := range name {
		if char == '\n' || char == '\r' || char == '\t' {
			escaped.WriteByte(' ')
			continue
		}
		if strings.ContainsRune("\\`*_{}[]<>()#+-.!|~&", char) {
			escaped.WriteByte('\\')
		}
		escaped.WriteRune(char)
	}
	announcement := model.AutomaticAnnouncement{
		EventKey:    firstChallengerAnnouncementEvent,
		UserId:      winner.UserId,
		AchievedOn:  winnerProgress.ChallengerReachedOn,
		Content:     fmt.Sprintf("恭喜 %s 于 %s 晋升最强王者，成为全站首位最强王者！", escaped.String(), winnerProgress.ChallengerReachedOn),
		PublishedAt: time.Now().Unix(),
	}
	if err := model.PublishAutomaticAnnouncement(&announcement); err != nil {
		return false, err
	}
	return true, nil
}
