package model

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
)

const (
	PersonalRevisionDraft      = "draft"
	PersonalRevisionPending    = "pending"
	PersonalRevisionApproved   = "approved"
	PersonalRevisionRejected   = "rejected"
	PersonalRevisionSuperseded = "superseded"
)

// Only approved revisions are materialized in channels/abilities. Pending
// credentials and models can never be selected by the relay or cache rebuilds.
type PersonalChannel struct {
	Id                 int   `json:"id"`
	OwnerUserID        int   `json:"owner_user_id" gorm:"index;not null"`
	GroupID            int   `json:"group_id" gorm:"index;not null"`
	PublishedChannelID int   `json:"published_channel_id" gorm:"index"`
	LatestRevisionID   int   `json:"latest_revision_id"`
	CreatedAt          int64 `json:"created_at"`
}

type PersonalChannelRevision struct {
	Id                int    `json:"id"`
	PersonalChannelID int    `json:"personal_channel_id" gorm:"index;not null"`
	Payload           string `json:"-" gorm:"type:text;not null"`
	Status            string `json:"status" gorm:"size:20;index;not null"`
	CreatedAt         int64  `json:"created_at"`
	ReviewedAt        int64  `json:"reviewed_at"`
	ReviewerID        int    `json:"reviewer_id"`
	Reason            string `json:"reason" gorm:"size:1000"`
}

// Explicit allowlist: personal owners cannot inject IDs, groups, balances,
// proxy/header overrides, automatic model updates or other admin-only fields.
type PersonalChannelConfig struct {
	Name         string `json:"name"`
	Type         int    `json:"type"`
	BaseURL      string `json:"base_url"`
	Key          string `json:"key,omitempty"`
	Models       string `json:"models"`
	ModelMapping string `json:"model_mapping"`
	Priority     int64  `json:"priority"`
	Weight       uint   `json:"weight"`
	Enabled      bool   `json:"enabled"`
}

func (config *PersonalChannelConfig) Validate() error {
	config.Name = strings.TrimSpace(config.Name)
	config.BaseURL = strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	config.Key = strings.TrimSpace(config.Key)
	if config.Name == "" || len(config.Name) > 128 {
		return errors.New("Channel name must contain 1 to 128 characters")
	}
	switch config.Type {
	case constant.ChannelTypeOpenAI, constant.ChannelTypeAnthropic, constant.ChannelTypeGemini, constant.ChannelTypeNewAPI:
	default:
		return errors.New("Personal channels support OpenAI-compatible, Anthropic, Gemini and New API providers")
	}
	u, err := url.Parse(config.BaseURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("Channel URL must be an HTTPS URL without credentials, query or fragment")
	}
	port := 443
	if u.Port() != "" {
		port, err = strconv.Atoi(u.Port())
		if err != nil {
			return errors.New("Invalid channel port")
		}
	}
	protection := common.SSRFProtection{ApplyIPFilterForDomain: true}
	if err := protection.ValidateNetworkTarget(u.Hostname(), port); err != nil {
		return errors.New("Channel URL must use a public network address")
	}
	if config.Key == "" || len(config.Key) > 16384 || strings.ContainsAny(config.Key, "\r\n") {
		return errors.New("A single valid API key is required")
	}
	models := strings.Split(config.Models, ",")
	if len(models) > 200 {
		return errors.New("At most 200 models are allowed per channel")
	}
	seen := map[string]bool{}
	normalized := make([]string, 0, len(models))
	for _, name := range models {
		name = strings.TrimSpace(name)
		if name == "" || len(name) > 255 || strings.ContainsAny(name, "\r\n") {
			return errors.New("Invalid model name")
		}
		if !seen[name] {
			normalized = append(normalized, name)
			seen[name] = true
		}
	}
	config.Models = strings.Join(normalized, ",")
	if config.Priority < 0 || config.Priority > 1000000 || config.Weight > 1000000 {
		return errors.New("Priority and weight must be between 0 and 1000000")
	}
	if config.ModelMapping != "" && config.ModelMapping != "{}" {
		return errors.New("Personal channels do not support model mapping")
	}
	config.ModelMapping = ""
	return nil
}

func SavePersonalChannelDraft(ownerID, groupID, channelID, expectedRevisionID int, config PersonalChannelConfig) (*PersonalChannelRevision, error) {
	var revision PersonalChannelRevision
	err := DB.Transaction(func(tx *gorm.DB) error {
		var group PersonalGroup
		if err := lockForUpdate(tx).Where("id = ? AND owner_user_id = ? AND archived_at = 0", groupID, ownerID).First(&group).Error; err != nil {
			return err
		}
		channel := PersonalChannel{OwnerUserID: ownerID, GroupID: groupID, CreatedAt: common.GetTimestamp()}
		if channelID != 0 {
			if err := lockForUpdate(tx).Where("id = ? AND owner_user_id = ? AND group_id = ?", channelID, ownerID, groupID).First(&channel).Error; err != nil {
				return err
			}
			if channel.LatestRevisionID != expectedRevisionID {
				return errors.New("Channel changed; reload before saving")
			}
			if config.Key == "" {
				var previous PersonalChannelRevision
				if err := tx.First(&previous, channel.LatestRevisionID).Error; err != nil {
					return err
				}
				var previousConfig PersonalChannelConfig
				if err := common.UnmarshalJsonStr(previous.Payload, &previousConfig); err != nil {
					return err
				}
				config.Key = previousConfig.Key
			}
		}
		if err := config.Validate(); err != nil {
			return err
		}
		if channelID == 0 {
			if err := tx.Create(&channel).Error; err != nil {
				return err
			}
		}
		payload, err := common.Marshal(config)
		if err != nil {
			return err
		}
		revision = PersonalChannelRevision{PersonalChannelID: channel.Id, Payload: string(payload), Status: PersonalRevisionDraft, CreatedAt: common.GetTimestamp()}
		if err := tx.Model(&PersonalChannelRevision{}).Where("personal_channel_id = ? AND status IN ?", channel.Id, []string{PersonalRevisionDraft, PersonalRevisionPending}).Update("status", PersonalRevisionSuperseded).Error; err != nil {
			return err
		}
		if err := tx.Create(&revision).Error; err != nil {
			return err
		}
		result := tx.Model(&PersonalChannel{}).Where("id = ? AND latest_revision_id = ?", channel.Id, channel.LatestRevisionID).Update("latest_revision_id", revision.Id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("Channel changed; reload before saving")
		}
		return nil
	})
	return &revision, err
}

func SubmitPersonalChannel(ownerID, channelID, revisionID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var channel PersonalChannel
		if err := lockForUpdate(tx).Where("id = ? AND owner_user_id = ? AND latest_revision_id = ?", channelID, ownerID, revisionID).First(&channel).Error; err != nil {
			return err
		}
		result := tx.Model(&PersonalChannelRevision{}).Where("id = ? AND personal_channel_id = ? AND status = ?", revisionID, channelID, PersonalRevisionDraft).Update("status", PersonalRevisionPending)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("Only the latest draft can be submitted")
		}
		return nil
	})
}

func ReviewPersonalChannel(reviewerID, channelID, revisionID int, approve bool, reason string) error {
	reason = strings.TrimSpace(reason)
	if len(reason) > 1000 || (!approve && reason == "") {
		return errors.New("A rejection reason is required (up to 1000 characters)")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var channel PersonalChannel
		if err := lockForUpdate(tx).Where("id = ? AND latest_revision_id = ?", channelID, revisionID).First(&channel).Error; err != nil {
			return errors.New("This revision is no longer current")
		}
		var revision PersonalChannelRevision
		if err := tx.Where("id = ? AND personal_channel_id = ? AND status = ?", revisionID, channelID, PersonalRevisionPending).First(&revision).Error; err != nil {
			return errors.New("This revision is not pending review")
		}
		status := PersonalRevisionRejected
		if approve {
			var group PersonalGroup
			if err := tx.Where("id = ? AND owner_user_id = ? AND archived_at = 0", channel.GroupID, channel.OwnerUserID).First(&group).Error; err != nil {
				return err
			}
			var config PersonalChannelConfig
			if err := common.UnmarshalJsonStr(revision.Payload, &config); err != nil {
				return err
			}
			if err := config.Validate(); err != nil {
				return err
			}
			published := Channel{}
			if channel.PublishedChannelID != 0 {
				if err := lockForUpdate(tx).Where("id = ? AND owner_user_id = ?", channel.PublishedChannelID, channel.OwnerUserID).First(&published).Error; err != nil {
					return fmt.Errorf("published channel unavailable: %w", err)
				}
			}
			published.OwnerUserID = channel.OwnerUserID
			published.Name, published.Type, published.Key = config.Name, config.Type, config.Key
			published.BaseURL, published.Models, published.Group = &config.BaseURL, config.Models, group.Name
			published.ModelMapping, published.Priority, published.Weight = &config.ModelMapping, &config.Priority, &config.Weight
			published.Status = common.ChannelStatusManuallyDisabled
			if config.Enabled {
				published.Status = common.ChannelStatusEnabled
			}
			if published.Id == 0 {
				published.CreatedTime = common.GetTimestamp()
			}
			if err := tx.Save(&published).Error; err != nil {
				return err
			}
			if err := published.UpdateAbilities(tx); err != nil {
				return err
			}
			if err := tx.Model(&PersonalChannel{}).Where("id = ?", channel.Id).Update("published_channel_id", published.Id).Error; err != nil {
				return err
			}
			status = PersonalRevisionApproved
		}
		result := tx.Model(&PersonalChannelRevision{}).Where("id = ? AND status = ?", revisionID, PersonalRevisionPending).Updates(map[string]any{"status": status, "reviewer_id": reviewerID, "reviewed_at": common.GetTimestamp(), "reason": reason})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("Revision has already been reviewed")
		}
		return nil
	})
}

type PersonalChannelView struct {
	PersonalChannel
	GroupName       string                  `json:"group_name"`
	Revision        PersonalChannelRevision `json:"revision"`
	Config          PersonalChannelConfig   `json:"config"`
	HasKey          bool                    `json:"has_key"`
	KeyChanged      bool                    `json:"key_changed"`
	PublishedConfig *PersonalChannelConfig  `json:"published_config,omitempty"`
}

func ListPersonalChannels(ownerID int, review bool, offset, limit int) ([]PersonalChannelView, int64, error) {
	query := DB.Model(&PersonalChannel{})
	if review {
		query = query.Where("latest_revision_id IN (?)", DB.Model(&PersonalChannelRevision{}).Select("id").Where("status = ?", PersonalRevisionPending))
	} else {
		query = query.Where("owner_user_id = ?", ownerID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var channels []PersonalChannel
	if err := query.Order("id DESC").Offset(offset).Limit(limit).Find(&channels).Error; err != nil {
		return nil, 0, err
	}
	views := make([]PersonalChannelView, 0, len(channels))
	for _, channel := range channels {
		view := PersonalChannelView{PersonalChannel: channel}
		if err := DB.First(&view.Revision, channel.LatestRevisionID).Error; err != nil {
			return nil, 0, err
		}
		if err := common.UnmarshalJsonStr(view.Revision.Payload, &view.Config); err != nil {
			return nil, 0, err
		}
		var group PersonalGroup
		if err := DB.First(&group, channel.GroupID).Error; err != nil {
			return nil, 0, err
		}
		view.GroupName = group.Name
		view.HasKey = view.Config.Key != ""
		view.KeyChanged = view.HasKey
		if channel.PublishedChannelID != 0 {
			var published Channel
			if err := DB.First(&published, channel.PublishedChannelID).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, 0, err
			}
			if published.Id != 0 {
				view.KeyChanged = published.Key != view.Config.Key
				view.PublishedConfig = &PersonalChannelConfig{Name: published.Name, Type: published.Type, BaseURL: published.GetBaseURL(), Models: published.Models, Priority: published.GetPriority(), Weight: uint(published.GetWeight()), Enabled: published.Status == common.ChannelStatusEnabled}
				if published.ModelMapping != nil {
					view.PublishedConfig.ModelMapping = *published.ModelMapping
				}
			}
		}
		view.Config.Key = ""
		views = append(views, view)
	}
	return views, total, nil
}

// ResolvePersonalModelCredentials only reuses the caller's current saved key at
// its saved origin. A changed destination requires an explicitly supplied key.
func ResolvePersonalModelCredentials(ownerID, channelID int, config *PersonalChannelConfig) error {
	if channelID == 0 {
		return nil
	}
	var channel PersonalChannel
	if err := DB.Where("id = ? AND owner_user_id = ?", channelID, ownerID).First(&channel).Error; err != nil {
		return errors.New("Personal channel not found")
	}
	if strings.TrimSpace(config.Key) != "" {
		return nil
	}
	var revision PersonalChannelRevision
	if err := DB.First(&revision, channel.LatestRevisionID).Error; err != nil {
		return err
	}
	var saved PersonalChannelConfig
	if err := common.UnmarshalJsonStr(revision.Payload, &saved); err != nil {
		return err
	}
	if strings.TrimRight(strings.TrimSpace(config.BaseURL), "/") != strings.TrimRight(saved.BaseURL, "/") || config.Type != saved.Type {
		return errors.New("Enter an API key when changing the upstream address or provider")
	}
	config.Key = saved.Key
	return nil
}
