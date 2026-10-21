package service

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/console_setting"
)

var ErrAnnouncementUnavailable = errors.New("announcement is no longer available")

type RequiredAnnouncement struct {
	Revision    string `json:"revision"`
	Content     string `json:"content"`
	Extra       string `json:"extra"`
	PublishDate string `json:"publishDate"`
}

// PublishedRequiredAnnouncements excludes future and disabled announcements.
// A content-derived revision prevents an old dialog from dismissing edited content.
func PublishedRequiredAnnouncements() ([]RequiredAnnouncement, error) {
	announcements := make([]RequiredAnnouncement, 0)
	if !console_setting.GetConsoleSetting().AnnouncementsEnabled {
		return announcements, nil
	}
	now := time.Now()
	for _, item := range console_setting.GetAnnouncements() {
		if required, _ := item["requireRead"].(bool); !required {
			continue
		}
		date, _ := item["publishDate"].(string)
		publishedAt, err := time.Parse(time.RFC3339, date)
		if err != nil || publishedAt.After(now) {
			continue
		}
		content, _ := item["content"].(string)
		if content == "" {
			continue
		}
		encoded, err := common.Marshal(item)
		if err != nil {
			return nil, err
		}
		extra, _ := item["extra"].(string)
		announcements = append(announcements, RequiredAnnouncement{
			Revision: fmt.Sprintf("%x", sha256.Sum256(encoded)),
			Content:  content, Extra: extra, PublishDate: date,
		})
	}
	return announcements, nil
}

func GetPendingAnnouncements(userId int) ([]RequiredAnnouncement, error) {
	announcements, err := PublishedRequiredAnnouncements()
	if err != nil {
		return nil, err
	}
	revisions := make([]string, 0, len(announcements))
	for _, announcement := range announcements {
		revisions = append(revisions, announcement.Revision)
	}
	read, err := model.GetReadAnnouncementRevisions(userId, revisions)
	if err != nil {
		return nil, err
	}
	readSet := make(map[string]bool, len(read))
	for _, revision := range read {
		readSet[revision] = true
	}
	pending := make([]RequiredAnnouncement, 0, len(announcements))
	for _, announcement := range announcements {
		if !readSet[announcement.Revision] {
			pending = append(pending, announcement)
		}
	}
	return pending, nil
}

func DismissAnnouncement(userId int, revision string) error {
	announcements, err := PublishedRequiredAnnouncements()
	if err != nil {
		return err
	}
	for _, announcement := range announcements {
		if announcement.Revision == revision {
			return model.MarkAnnouncementRead(userId, revision)
		}
	}
	return ErrAnnouncementUnavailable
}
