package setting

import (
	"fmt"
	"math"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
)

const UserRequestLimitsOptionKey = "UserRequestLimits"
const MaxRequestLimitWindowMinutes = 10080

// Zero disables a dimension. A key-group rule replaces the whole default rule.
type UserRequestLimitRule struct {
	MaxConcurrent     int `json:"max_concurrent"`
	RateCount         int `json:"rate_count"`
	RateWindowMinutes int `json:"rate_window_minutes"`
}

type UserGroupRequestLimits struct {
	Default   UserRequestLimitRule            `json:"default"`
	KeyGroups map[string]UserRequestLimitRule `json:"key_groups"`
}

type UserRequestLimitConfig map[string]UserGroupRequestLimits

type userRequestLimitSnapshot struct {
	raw    string
	groups UserRequestLimitConfig
}

var userRequestLimits atomic.Pointer[userRequestLimitSnapshot]

func ParseUserRequestLimits(raw string) (UserRequestLimitConfig, error) {
	var groups UserRequestLimitConfig
	if err := common.UnmarshalJsonStr(raw, &groups); err != nil {
		return nil, err
	}
	if groups == nil {
		return nil, fmt.Errorf("user request limits must be a JSON object")
	}
	for group, limits := range groups {
		if group == "" || group != strings.TrimSpace(group) {
			return nil, fmt.Errorf("invalid user group name %q", group)
		}
		if err := limits.Default.Validate(); err != nil {
			return nil, fmt.Errorf("%s default: %w", group, err)
		}
		for keyGroup, rule := range limits.KeyGroups {
			if keyGroup == "" || keyGroup != strings.TrimSpace(keyGroup) || keyGroup == "auto" {
				return nil, fmt.Errorf("invalid key group name %q", keyGroup)
			}
			if err := rule.Validate(); err != nil {
				return nil, fmt.Errorf("%s/%s: %w", group, keyGroup, err)
			}
		}
	}
	return groups, nil
}

func (r UserRequestLimitRule) Validate() error {
	if r.MaxConcurrent < 0 || r.MaxConcurrent > math.MaxInt32 || r.RateCount < 0 || r.RateCount > math.MaxInt32 {
		return fmt.Errorf("request limits must be integers between 0 and %d", math.MaxInt32)
	}
	if r.RateWindowMinutes < 0 || r.RateWindowMinutes > MaxRequestLimitWindowMinutes || (r.RateCount > 0 && r.RateWindowMinutes == 0) {
		return fmt.Errorf("enabled rate limits require a window of 1 to %d minutes", MaxRequestLimitWindowMinutes)
	}
	return nil
}

func UpdateUserRequestLimits(raw string) error {
	// Empty represents an absent option when restoring/loading configuration.
	// API writes still go through ParseUserRequestLimits and require an object.
	if raw == "" {
		userRequestLimits.Store(nil)
		return nil
	}
	groups, err := ParseUserRequestLimits(raw)
	if err != nil {
		return err
	}
	userRequestLimits.Store(&userRequestLimitSnapshot{raw: raw, groups: groups})
	return nil
}

func UserRequestLimitsJSON() string {
	if snapshot := userRequestLimits.Load(); snapshot != nil {
		return snapshot.raw
	}
	return "" // An absent option keeps legacy limits until an administrator saves the new policy.
}

func ResolveUserRequestLimit(userGroup, keyGroup string) (rule UserRequestLimitRule, pool string, configured bool) {
	snapshot := userRequestLimits.Load()
	if snapshot == nil {
		return rule, "", false
	}
	limits := snapshot.groups[userGroup]
	if keyGroup != "" && keyGroup != "auto" {
		if override, ok := limits.KeyGroups[keyGroup]; ok {
			return override, "key:" + keyGroup, true
		}
	}
	return limits.Default, "default", true
}
