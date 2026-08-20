package model

type DataMigration struct {
	Name        string `gorm:"primaryKey;size:128"`
	CompletedAt int64
}
