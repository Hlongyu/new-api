package model

import (
	"time"

	"gorm.io/gorm/clause"
)

// AnnouncementRead records dismissal of one published version, scoped to an account.
type AnnouncementRead struct {
	UserId   int    `gorm:"primaryKey;autoIncrement:false"`
	Revision string `gorm:"primaryKey;type:varchar(64)"`
	ReadAt   int64  `gorm:"not null"`
}

func GetReadAnnouncementRevisions(userId int, revisions []string) ([]string, error) {
	read := make([]string, 0)
	if len(revisions) == 0 {
		return read, nil
	}
	err := DB.Model(&AnnouncementRead{}).
		Where("user_id = ? AND revision IN ?", userId, revisions).
		Pluck("revision", &read).Error
	return read, err
}

func MarkAnnouncementRead(userId int, revision string) error {
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&AnnouncementRead{
		UserId: userId, Revision: revision, ReadAt: time.Now().Unix(),
	}).Error
}
