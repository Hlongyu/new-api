package model

import (
	"errors"
	"slices"
	"sort"
	"strconv"
)

// GroupConsumption uses the owner snapshot in the request log, never the
// caller's current group. Funding amounts come from the refundable settlement.
type GroupConsumption struct {
	Group             string `json:"group"`
	UserID            int    `json:"user_id,omitempty"`
	OwnerUserID       int    `json:"owner_user_id"`
	WalletQuota       int64  `json:"wallet_quota"`
	SubscriptionQuota int64  `json:"subscription_quota"`
	TotalQuota        int64  `json:"total_quota"`
	Requests          int64  `json:"requests"`
}

type ConsumptionFilters struct {
	Group           string
	UserID          int
	Dimension       string
	Source          string
	ExcludedUsers   []int
	GroupExclusions map[string][]int
}

type ConsumptionGroup struct {
	Group       string `json:"group"`
	OwnerUserID int    `json:"owner_user_id"`
}

type GroupConsumptionReport struct {
	Groups []ConsumptionGroup `json:"groups"`

	Items                []GroupConsumption `json:"items"`
	UnattributedRequests int64              `json:"unattributed_requests"`
}

// Read settlements in bounded batches: logs may live in a separate database.
// One settlement contributes once even when retries produced multiple logs.
func ListGroupConsumption(start, end int64, ownerID int, excludedUsers []int, groupExclusions map[string][]int) (GroupConsumptionReport, error) {
	return QueryConsumption(start, end, ownerID, ConsumptionFilters{Dimension: "group", Source: "all", ExcludedUsers: excludedUsers, GroupExclusions: groupExclusions})
}

// Both dimensions share attribution, permission, funding and exclusion rules.
func QueryConsumption(start, end int64, ownerID int, filters ConsumptionFilters) (GroupConsumptionReport, error) {
	report := GroupConsumptionReport{Items: []GroupConsumption{}, Groups: []ConsumptionGroup{}}
	if (filters.Dimension != "group" && filters.Dimension != "user") || (filters.Source != "all" && filters.Source != "wallet" && filters.Source != "subscription") || filters.UserID < 0 {
		return report, errors.New("invalid consumption filters")
	}
	visibleGroups := map[string]int{}

	if start < 0 || end <= start || ownerID < 0 {
		return report, errors.New("invalid group consumption query")
	}
	byGroup := map[string]int{}
	var after int64
	for {
		var settlements []PostpaidSettlement
		query := DB.Model(&PostpaidSettlement{}).Scopes(monthlyConsumptionScope(start, end)).Where("id > ?", after).Order("id ASC").Limit(500)
		if len(filters.ExcludedUsers) > 0 {
			query = query.Where("user_id NOT IN ?", filters.ExcludedUsers)
		}
		if err := query.Find(&settlements).Error; err != nil {
			return report, err
		}
		if len(settlements) == 0 {
			break
		}
		ids := make([]string, 0, len(settlements))
		for _, settlement := range settlements {
			ids = append(ids, settlement.RequestId)
		}
		var logs []Log
		logQuery := LOG_DB.Model(&Log{}).Select([]string{"request_id", "group", "group_owner_user_id"}).Where("request_id IN ? AND type = ?", ids, LogTypeConsume).Distinct()
		if err := logQuery.Find(&logs).Error; err != nil {
			return report, err
		}
		groups := map[string]string{}
		owners := map[string]int{}
		ambiguous := map[string]bool{}
		for _, log := range logs {
			if previous, ok := groups[log.RequestId]; ok && (previous != log.Group || owners[log.RequestId] != log.GroupOwnerUserID) {
				ambiguous[log.RequestId] = true
			}
			groups[log.RequestId] = log.Group
			owners[log.RequestId] = log.GroupOwnerUserID
		}
		for _, settlement := range settlements {
			group, ok := groups[settlement.RequestId]
			if !ok || group == "" || ambiguous[settlement.RequestId] {
				// Do not leak other users' activity to a group owner.
				if ownerID == 0 && (settlement.WalletQuota > 0 || settlement.SubscriptionQuota > 0) {
					report.UnattributedRequests++
				}
				continue
			}
			if ownerID > 0 && owners[settlement.RequestId] != ownerID {
				continue
			}
			visibleGroups[group] = owners[settlement.RequestId]
			if filters.Group != "" && filters.Group != group {
				continue
			}
			if filters.UserID > 0 && filters.UserID != settlement.UserId {
				continue
			}
			wallet, subscription := settlement.WalletQuota, settlement.SubscriptionQuota
			if filters.Source == "wallet" {
				if wallet == 0 {
					continue
				}
				subscription = 0
			}
			if filters.Source == "subscription" {
				if subscription == 0 {
					continue
				}
				wallet = 0
			}
			key := group
			if filters.Dimension == "user" {
				key = strconv.Itoa(settlement.UserId)
			}
			index, exists := byGroup[key]
			if !exists {
				index = len(report.Items)
				byGroup[key] = index
				row := GroupConsumption{Group: group, OwnerUserID: owners[settlement.RequestId]}
				if filters.Dimension == "user" {
					row = GroupConsumption{UserID: settlement.UserId}
				}
				report.Items = append(report.Items, row)
			}
			if slices.Contains(filters.GroupExclusions[group], settlement.UserId) {
				continue
			}
			row := &report.Items[index]
			row.WalletQuota += int64(wallet)
			row.SubscriptionQuota += int64(subscription)
			row.TotalQuota = row.WalletQuota + row.SubscriptionQuota
			row.Requests++
		}
		after = settlements[len(settlements)-1].Id
	}
	for group, owner := range visibleGroups {
		report.Groups = append(report.Groups, ConsumptionGroup{Group: group, OwnerUserID: owner})
	}
	sort.Slice(report.Groups, func(i, j int) bool { return report.Groups[i].Group < report.Groups[j].Group })
	sort.Slice(report.Items, func(i, j int) bool {
		if filters.Dimension == "user" {
			return report.Items[i].UserID < report.Items[j].UserID
		}
		return report.Items[i].Group < report.Items[j].Group
	})
	return report, nil
}
