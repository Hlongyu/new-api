package model

import (
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// One root-managed subscription; secrets never appear in API responses.
type GroupRatioWebhook struct {
	ID      int    `json:"-" gorm:"primaryKey"`
	Enabled bool   `json:"enabled"`
	URL     string `json:"url" gorm:"type:text"`
	Groups  string `json:"-" gorm:"type:text"`
	Secret  string `json:"-" gorm:"type:text"`
}

type GroupRatioChange struct {
	Group    string  `json:"group"`
	OldRatio float64 `json:"old_ratio"`
	NewRatio float64 `json:"new_ratio"`
}

type GroupRatioEvent struct {
	ID        string             `json:"id"`
	Type      string             `json:"type"`
	Timestamp int64              `json:"timestamp"`
	Changes   []GroupRatioChange `json:"changes"`
}

type GroupRatioWebhookDelivery struct {
	ID            string `json:"id" gorm:"primaryKey;size:36"`
	Payload       string `json:"payload" gorm:"type:text"`
	URL           string `json:"-" gorm:"type:text"`
	Secret        string `json:"-" gorm:"type:text"`
	Status        string `json:"status" gorm:"size:20;index"`
	Attempts      int    `json:"attempts"`
	NextAttemptAt int64  `json:"next_attempt_at" gorm:"index"`
	Lease         string `json:"-" gorm:"size:36"`
	LastStatus    int    `json:"last_status"`
	LastError     string `json:"last_error" gorm:"type:text"`
	CreatedAt     int64  `json:"created_at"`
	DeliveredAt   int64  `json:"delivered_at"`
}

const groupRatioAlias = "group_ratio_setting.group_ratio"

func isGroupRatioOption(key string) bool { return key == "GroupRatio" || key == groupRatioAlias }

func ValidateGroupRatioWebhook(config GroupRatioWebhook, groups []string) error {
	if len(config.URL) > 2048 || len(config.Secret) > 512 || len(groups) > 1000 {
		return errors.New("webhook configuration exceeds size limits")
	}
	if config.URL != "" {
		u, err := url.Parse(config.URL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
			return errors.New("webhook URL must be HTTPS without credentials or fragment")
		}
		if u.Port() != "" && u.Port() != "443" {
			return errors.New("webhook URL must use port 443")
		}
		protection := &common.SSRFProtection{AllowedPorts: []int{443}}
		if err := protection.ValidateNetworkTarget(u.Hostname(), 443); err != nil {
			return errors.New("webhook URL must target a public host")
		}
	}
	for _, group := range groups {
		if strings.TrimSpace(group) == "" || len(group) > 255 {
			return errors.New("invalid webhook group")
		}
	}
	if config.Enabled && (config.URL == "" || len(groups) == 0) {
		return errors.New("enabled webhook requires a URL and at least one group")
	}
	if config.Secret != "" && len(config.Secret) < 32 {
		return errors.New("signing secret must contain at least 32 characters when provided")
	}
	return nil
}

func GetGroupRatioWebhook() (GroupRatioWebhook, error) {
	config := GroupRatioWebhook{ID: 1, Groups: "[]"}
	err := DB.First(&config, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = nil
	}
	return config, err
}

// The canonical option is also the cross-instance serialization point. Seed it
// from legacy persisted settings before taking a row lock (SQLite serializes writes).
func lockGroupRatioOption(tx *gorm.DB) (Option, error) {
	seed := Option{Key: "GroupRatio", Value: ratio_setting.GroupRatio2JSONString()}
	var legacy Option
	err := tx.Where(&Option{Key: groupRatioAlias}).First(&legacy).Error
	if err == nil {
		seed.Value = legacy.Value
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return seed, err
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
		return seed, err
	}
	err = lockForUpdate(tx).Where(&Option{Key: "GroupRatio"}).First(&seed).Error
	return seed, err
}

func SaveGroupRatioWebhook(config GroupRatioWebhook, groups []string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if _, err := lockGroupRatioOption(tx); err != nil {
			return err
		}
		var previous GroupRatioWebhook
		err := lockForUpdate(tx).First(&previous, 1).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if config.Secret == "" {
			config.Secret = previous.Secret
		}
		if err := ValidateGroupRatioWebhook(config, groups); err != nil {
			return err
		}
		if groups == nil {
			groups = []string{}
		}
		raw, err := common.Marshal(groups)
		if err != nil {
			return err
		}
		config.ID, config.Groups = 1, string(raw)
		return tx.Save(&config).Error
	})
}

// Called inside the same transaction as all accompanying option changes.
func persistGroupRatioEvent(tx *gorm.DB, raw string) error {
	previous, err := lockGroupRatioOption(tx)
	if err != nil {
		return err
	}
	var oldRatios, newRatios map[string]float64
	if err := common.UnmarshalJsonStr(previous.Value, &oldRatios); err != nil {
		return err
	}
	if err := common.UnmarshalJsonStr(raw, &newRatios); err != nil {
		return err
	}
	var config GroupRatioWebhook
	err = lockForUpdate(tx).First(&config, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && !config.Enabled) {
		return nil
	}
	if err != nil {
		return err
	}
	var groups []string
	if err := common.UnmarshalJsonStr(config.Groups, &groups); err != nil {
		return err
	}
	sort.Strings(groups)
	changes := make([]GroupRatioChange, 0)
	seen := make(map[string]bool)
	for _, group := range groups {
		old, existed := oldRatios[group]
		next, exists := newRatios[group]
		if existed && exists && old != next && !seen[group] {
			changes = append(changes, GroupRatioChange{group, old, next})
		}
		seen[group] = true
	}
	if len(changes) == 0 {
		return nil
	}
	event := GroupRatioEvent{uuid.NewString(), "group.ratio.changed", time.Now().Unix(), changes}
	payload, err := common.Marshal(event)
	if err != nil {
		return err
	}
	return tx.Create(&GroupRatioWebhookDelivery{ID: event.ID, Payload: string(payload), URL: config.URL, Secret: config.Secret, Status: "pending", CreatedAt: event.Timestamp, NextAttemptAt: event.Timestamp}).Error
}

func ClaimGroupRatioWebhook(now int64) (*GroupRatioWebhookDelivery, error) {
	var delivery GroupRatioWebhookDelivery
	err := DB.Where("status = ? AND next_attempt_at <= ?", "pending", now).Order("next_attempt_at, created_at").First(&delivery).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	lease := uuid.NewString()
	result := DB.Model(&GroupRatioWebhookDelivery{}).Where("id = ? AND status = ? AND next_attempt_at <= ? AND lease = ?", delivery.ID, "pending", now, delivery.Lease).Updates(map[string]interface{}{"lease": lease, "next_attempt_at": now + 60})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	delivery.Lease = lease
	return &delivery, nil
}

func FinishGroupRatioWebhook(delivery *GroupRatioWebhookDelivery, status int, deliveryError string, now int64) error {
	attempts := delivery.Attempts + 1
	values := map[string]interface{}{"attempts": attempts, "last_status": status, "last_error": deliveryError, "lease": ""}
	if status >= 200 && status < 300 && deliveryError == "" {
		values["status"], values["delivered_at"] = "delivered", now
	} else if attempts >= 8 {
		values["status"] = "failed"
	} else {
		values["next_attempt_at"] = now + int64(30<<(attempts-1))
	}
	return DB.Model(&GroupRatioWebhookDelivery{}).Where("id = ? AND lease = ? AND status = ?", delivery.ID, delivery.Lease, "pending").Updates(values).Error
}

func RetryGroupRatioWebhook(id string) error {
	result := DB.Model(&GroupRatioWebhookDelivery{}).Where("id = ? AND status = ?", id, "failed").Updates(map[string]interface{}{"status": "pending", "attempts": 0, "next_attempt_at": time.Now().Unix(), "lease": "", "last_error": ""})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("delivery not found or not failed")
	}
	return nil
}
