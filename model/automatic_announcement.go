package model

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AutomaticAnnouncement is also the durable event receipt. Keeping it separate
// from the editable announcements option prevents concurrent settings saves
// from overwriting a publication or allowing the event to be published twice.
type AutomaticAnnouncement struct {
	EventKey    string `gorm:"primaryKey;type:varchar(100)"`
	UserId      int    `gorm:"not null"`
	AchievedOn  string `gorm:"type:varchar(10);not null"`
	Content     string `gorm:"type:text;not null"`
	PublishedAt int64  `gorm:"not null"`
	Payload     string `gorm:"type:text"`
	Deleted     bool
}

func HasAutomaticAnnouncement(eventKey string) (bool, error) {
	var count int64
	err := DB.Model(&AutomaticAnnouncement{}).Where("event_key = ?", eventKey).Count(&count).Error
	return count > 0, err
}

func PublishAutomaticAnnouncement(announcement *AutomaticAnnouncement) error {
	// The primary key arbitrates retries and concurrent publishers on every DB.
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(announcement).Error
}

func ListAutomaticAnnouncements() ([]AutomaticAnnouncement, error) {
	announcements := make([]AutomaticAnnouncement, 0)
	err := DB.Order("published_at DESC, event_key ASC").Find(&announcements).Error
	return announcements, err
}

// SaveManagedAnnouncements uses the same editor for manual and automatic
// announcements. Only events present when the editor loaded may be deleted;
// an event published while that editor was open must survive a stale save.
func SaveManagedAnnouncements(raw string, knownAutomaticIds []string) error {
	if err := console_setting.ValidateConsoleSettings(raw, "Announcements"); err != nil {
		return err
	}
	var items []map[string]interface{}
	if err := common.UnmarshalJsonStr(raw, &items); err != nil {
		return err
	}
	manual := make([]map[string]interface{}, 0, len(items))
	automatic := make(map[string]string)
	for _, item := range items {
		id, _ := item["id"].(string)
		if !strings.HasPrefix(id, "system:") {
			manual = append(manual, item)
			continue
		}
		key := strings.TrimPrefix(id, "system:")
		if _, exists := automatic[key]; exists {
			return fmt.Errorf("duplicate automatic announcement: %s", id)
		}
		payload, err := common.Marshal(item)
		if err != nil {
			return err
		}
		automatic[key] = string(payload)
	}
	manualJSON, err := common.Marshal(manual)
	if err != nil {
		return err
	}
	optionWriteMutex.Lock()
	defer optionWriteMutex.Unlock()
	err = DB.Transaction(func(tx *gorm.DB) error {
		var events []AutomaticAnnouncement
		if err := lockForUpdate(tx).Order("event_key ASC").Find(&events).Error; err != nil {
			return err
		}
		known := make(map[string]bool, len(knownAutomaticIds))
		for _, id := range knownAutomaticIds {
			known[id] = true
		}
		for _, event := range events {
			payload, included := automatic[event.EventKey]
			if !included && !known["system:"+event.EventKey] {
				continue
			}
			updates := map[string]interface{}{"deleted": !included}
			if included {
				updates["payload"] = payload
				delete(automatic, event.EventKey)
			}
			if err := tx.Model(&AutomaticAnnouncement{}).Where("event_key = ?", event.EventKey).Updates(updates).Error; err != nil {
				return err
			}
		}
		if len(automatic) > 0 {
			return fmt.Errorf("automatic announcement no longer exists")
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value"}),
		}).Create(&Option{Key: "console_setting.announcements", Value: string(manualJSON)}).Error
	})
	if err != nil {
		return err
	}
	return updateOptionMap("console_setting.announcements", string(manualJSON))
}

// GetLeaderboardProfilesByUserIds includes inactive profiles so automatic
// publishers can distinguish an opted-out record from a missing profile.
func GetLeaderboardProfilesByUserIds(userIds []int) ([]LeaderboardEntry, error) {
	entries := make([]LeaderboardEntry, 0)
	if len(userIds) == 0 {
		return entries, nil
	}
	err := DB.Where("user_id IN ?", userIds).Find(&entries).Error
	return entries, err
}
