package model

import (
	"errors"
	"gorm.io/gorm"
	"slices"
	"sort"
	"strconv"
	"time"
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
	GeneratedAt int64              `json:"generated_at"`
	Groups      []ConsumptionGroup `json:"groups"`

	Items                []GroupConsumption `json:"items"`
	UnattributedRequests int64              `json:"unattributed_requests"`
}

// Read settlements in bounded batches: logs may live in a separate database.
// One settlement contributes once even when retries produced multiple logs.
func ListGroupConsumption(start, end int64, ownerID int, excludedUsers []int, groupExclusions map[string][]int) (GroupConsumptionReport, error) {
	return QueryConsumption(start, end, ownerID, ConsumptionFilters{Dimension: "group", Source: "all", ExcludedUsers: excludedUsers, GroupExclusions: groupExclusions})
}

// QueryConsumption is the uncached accounting path. Live query pages use
// QueryPersistedConsumption; accounting also supports non-calendar snapshot windows.
func QueryConsumption(start, end int64, ownerID int, filters ConsumptionFilters) (GroupConsumptionReport, error) {
	if err := validateConsumptionQuery(start, end, ownerID, filters); err != nil {
		return GroupConsumptionReport{}, err
	}
	cube, err := loadConsumptionCube(DB, LOG_DB, start, end)
	if err != nil {
		return GroupConsumptionReport{}, err
	}
	return summarizeConsumption(cube, ownerID, filters), nil
}

func validateConsumptionQuery(start, end int64, ownerID int, filters ConsumptionFilters) error {
	if start < 0 || end <= start || ownerID < 0 || filters.UserID < 0 || (filters.Dimension != "group" && filters.Dimension != "user") || (filters.Source != "all" && filters.Source != "wallet" && filters.Source != "subscription") {
		return errors.New("invalid consumption query")
	}
	return nil
}

// The cube contains only group/owner/user aggregates, never request metadata.
// Counts for each funding source preserve hybrid-request semantics.
type consumptionCubeRow struct {
	GroupConsumption
	WalletRequests       int64
	SubscriptionRequests int64
}
type consumptionCube struct {
	Rows         []consumptionCubeRow
	Unattributed map[int]int64
	GeneratedAt  int64
}

func loadConsumptionCube(db, logDB *gorm.DB, start, end int64) (*consumptionCube, error) {
	cube := &consumptionCube{Unattributed: map[int]int64{}}
	type key struct {
		group       string
		owner, user int
	}
	rows := map[key]*consumptionCubeRow{}
	var after int64
	for {
		var settlements []PostpaidSettlement
		if err := db.Model(&PostpaidSettlement{}).Scopes(monthlyConsumptionScope(start, end)).Where("id > ?", after).Order("id ASC").Limit(1000).Find(&settlements).Error; err != nil {
			return nil, err
		}
		if len(settlements) == 0 {
			break
		}
		ids := make([]string, 0, len(settlements))
		for _, settlement := range settlements {
			ids = append(ids, settlement.RequestId)
		}
		var logs []Log
		if err := logDB.Model(&Log{}).Select([]string{"request_id", "group", "group_owner_user_id"}).Where("request_id IN ? AND type = ?", ids, LogTypeConsume).Distinct().Find(&logs).Error; err != nil {
			return nil, err
		}
		groups := map[string]key{}
		ambiguous := map[string]bool{}
		for _, log := range logs {
			current := key{group: log.Group, owner: log.GroupOwnerUserID}
			if previous, ok := groups[log.RequestId]; ok && previous != current {
				ambiguous[log.RequestId] = true
			}
			groups[log.RequestId] = current
		}
		for _, settlement := range settlements {
			k, ok := groups[settlement.RequestId]
			if !ok || k.group == "" || ambiguous[settlement.RequestId] {
				if settlement.WalletQuota > 0 || settlement.SubscriptionQuota > 0 {
					cube.Unattributed[settlement.UserId]++
				}
				continue
			}
			k.user = settlement.UserId
			row := rows[k]
			if row == nil {
				row = &consumptionCubeRow{GroupConsumption: GroupConsumption{Group: k.group, OwnerUserID: k.owner, UserID: k.user}}
				rows[k] = row
			}
			row.WalletQuota += int64(settlement.WalletQuota)
			row.SubscriptionQuota += int64(settlement.SubscriptionQuota)
			row.Requests++
			if settlement.WalletQuota > 0 {
				row.WalletRequests++
			}
			if settlement.SubscriptionQuota > 0 {
				row.SubscriptionRequests++
			}
		}
		after = settlements[len(settlements)-1].Id
	}
	for _, row := range rows {
		cube.Rows = append(cube.Rows, *row)
	}
	cube.GeneratedAt = time.Now().Unix()
	return cube, nil
}

func summarizeConsumption(cube *consumptionCube, ownerID int, filters ConsumptionFilters) GroupConsumptionReport {
	report := GroupConsumptionReport{Items: []GroupConsumption{}, Groups: []ConsumptionGroup{}, GeneratedAt: cube.GeneratedAt}
	if ownerID == 0 {
		for user, count := range cube.Unattributed {
			if !slices.Contains(filters.ExcludedUsers, user) {
				report.UnattributedRequests += count
			}
		}
	}
	visibleGroups := map[string]int{}
	byGroup := map[string]int{}
	for _, entry := range cube.Rows {
		if ownerID > 0 && entry.OwnerUserID != ownerID {
			continue
		}
		if slices.Contains(filters.ExcludedUsers, entry.UserID) {
			continue
		}
		visibleGroups[entry.Group] = entry.OwnerUserID
		if filters.Group != "" && filters.Group != entry.Group {
			continue
		}
		if filters.UserID > 0 && filters.UserID != entry.UserID {
			continue
		}
		wallet, subscription, requests := entry.WalletQuota, entry.SubscriptionQuota, entry.Requests
		if filters.Source == "wallet" {
			if entry.WalletRequests == 0 {
				continue
			}
			subscription = 0
			requests = entry.WalletRequests
		}
		if filters.Source == "subscription" {
			if entry.SubscriptionRequests == 0 {
				continue
			}
			wallet = 0
			requests = entry.SubscriptionRequests
		}
		key := entry.Group
		if filters.Dimension == "user" {
			key = strconv.Itoa(entry.UserID)
		}
		index, exists := byGroup[key]
		if !exists {
			index = len(report.Items)
			byGroup[key] = index
			row := GroupConsumption{Group: entry.Group, OwnerUserID: entry.OwnerUserID}
			if filters.Dimension == "user" {
				row = GroupConsumption{UserID: entry.UserID}
			}
			report.Items = append(report.Items, row)
		}
		if slices.Contains(filters.GroupExclusions[entry.Group], entry.UserID) {
			continue
		}
		row := &report.Items[index]
		row.WalletQuota += wallet
		row.SubscriptionQuota += subscription
		row.TotalQuota = row.WalletQuota + row.SubscriptionQuota
		row.Requests += requests
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
	return report
}
