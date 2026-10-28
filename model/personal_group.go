package model

import (
	"errors"
	"math"
	"regexp"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// Personal group names and ownership are immutable, including after archival.
// This prevents historical consumption from being reassigned to another owner.
type PersonalGroup struct {
	Id          int     `json:"id"`
	OwnerUserID int     `json:"owner_user_id" gorm:"index;not null"`
	Name        string  `json:"name" gorm:"size:64;uniqueIndex;not null"`
	Description string  `json:"description" gorm:"size:255"`
	Ratio       float64 `json:"ratio"`
	CreatedAt   int64   `json:"created_at"`
	ArchivedAt  int64   `json:"archived_at"`
}

var personalGroupNamePattern = regexp.MustCompile(`^custom-[a-z0-9][a-z0-9-]{0,56}$`)
var personalGroupCacheMutex sync.Mutex

func ValidatePersonalGroup(name string, ratio float64) error {
	if !personalGroupNamePattern.MatchString(name) {
		return errors.New("Use a custom- prefix followed by lowercase letters, numbers or hyphens (up to 64 characters)")
	}
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 || ratio > 1000000 {
		return errors.New("Group ratio must be between 0 and 1000000")
	}
	return nil
}

func CreatePersonalGroup(ownerID int, name, description string, ratio float64) (*PersonalGroup, error) {
	name = strings.TrimSpace(name)
	if !strings.HasPrefix(name, "custom-") {
		name = "custom-" + name
	}
	if ownerID <= 0 || len(description) > 255 {
		return nil, errors.New("Invalid group owner or description")
	}
	if err := ValidatePersonalGroup(name, ratio); err != nil {
		return nil, err
	}
	// Existing administrator-created groups must never be claimed by a user.
	if ratio_setting.ContainsGroupRatio(name) {
		return nil, errors.New("Group name already exists")
	}
	var channels int64
	if err := ApplyChannelGroupFilter(DB.Model(&Channel{}), name).Count(&channels).Error; err != nil {
		return nil, err
	}
	if channels > 0 {
		return nil, errors.New("Group name already exists")
	}
	group := &PersonalGroup{OwnerUserID: ownerID, Name: name, Description: description, Ratio: ratio, CreatedAt: common.GetTimestamp()}
	if err := DB.Create(group).Error; err != nil {
		return nil, errors.New("Unable to create group; its name may already be reserved")
	}
	RefreshPersonalGroupRatios()
	return group, nil
}

func UpdatePersonalGroup(ownerID, id int, description string, ratio float64) error {
	if len(description) > 255 {
		return errors.New("Group description is too long")
	}
	if err := ValidatePersonalGroup("custom-validation", ratio); err != nil {
		return err
	}
	result := DB.Model(&PersonalGroup{}).Where("id = ? AND owner_user_id = ? AND archived_at = 0", id, ownerID).Updates(map[string]any{"description": description, "ratio": ratio})
	if result.Error != nil {
		return result.Error
	}
	// MySQL may report no changed rows when saving the same values.
	var group PersonalGroup
	if err := DB.Where("id = ? AND owner_user_id = ? AND archived_at = 0", id, ownerID).First(&group).Error; err != nil {
		return err
	}
	RefreshPersonalGroupRatios()
	return nil
}

// Refreshed with ordinary options on every instance; writes refresh locally.
// Keep the last good snapshot if the database is temporarily unavailable.
func RefreshPersonalGroupRatios() {
	personalGroupCacheMutex.Lock()
	defer personalGroupCacheMutex.Unlock()
	if DB == nil {
		return
	}
	var groups []PersonalGroup
	if err := DB.Where("archived_at = 0").Find(&groups).Error; err != nil {
		common.SysError("failed to refresh personal group ratios: " + err.Error())
		return
	}
	ratios := make(map[string]float64, len(groups))
	for _, group := range groups {
		ratios[group.Name] = group.Ratio
	}
	ratio_setting.SetPersonalGroupRatios(ratios)
}

func GetPublishedPersonalGroups() map[string]string {
	groups := make(map[string]string)
	if DB == nil || !ratio_setting.HasPersonalGroups() {
		return groups
	}
	var rows []PersonalGroup
	// Only approved, enabled channels make a group discoverable and selectable.
	err := DB.Model(&PersonalGroup{}).Where("archived_at = 0 AND id IN (?)", DB.Model(&PersonalChannel{}).Select("group_id").Where("published_channel_id IN (?)", DB.Model(&Channel{}).Select("id").Where("status = ?", common.ChannelStatusEnabled))).Find(&rows).Error
	if err != nil {
		return groups
	}
	for _, group := range rows {
		groups[group.Name] = group.Description
	}
	return groups
}
