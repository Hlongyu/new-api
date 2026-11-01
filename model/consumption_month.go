package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// One checkpoint per Beijing month. Backfill is resumable and never reset by TTL.
type ConsumptionMonth struct {
	BackfillStarted bool   `gorm:"not null"`
	Period          string `gorm:"primaryKey;size:7"`
	BackfillID      int64  `gorm:"type:bigint;not null"`
	BackfillLimit   int64  `gorm:"type:bigint;not null"`
	Initialized     bool   `gorm:"not null"`
	UpdatedAt       int64  `gorm:"type:bigint;not null"`
}

// Attribution is persisted before writing the optional/separate log database.
// A log arriving before settlement is therefore also safe across process crashes.
type ConsumptionAttribution struct {
	RequestID   string `gorm:"primaryKey;size:64"`
	GroupName   string `gorm:"size:64;not null"`
	OwnerUserID int    `gorm:"not null"`
	Ambiguous   bool   `gorm:"not null"`
}

// Last applied contribution supports idempotent delta updates, including refunds.
type ConsumptionContribution struct {
	AttributionConflict  bool   `gorm:"not null"`
	SettlementID         int64  `gorm:"primaryKey;autoIncrement:false"`
	Period               string `gorm:"size:7;index;not null"`
	GroupName            string `gorm:"size:64;not null"`
	OwnerUserID          int    `gorm:"not null"`
	UserID               int    `gorm:"not null"`
	WalletQuota          int64  `gorm:"type:bigint;not null"`
	SubscriptionQuota    int64  `gorm:"type:bigint;not null"`
	Requests             int64  `gorm:"type:bigint;not null"`
	WalletRequests       int64  `gorm:"type:bigint;not null"`
	SubscriptionRequests int64  `gorm:"type:bigint;not null"`
	Unattributed         int64  `gorm:"type:bigint;not null"`
}

type ConsumptionAggregate struct {
	Period               string `gorm:"primaryKey;size:7"`
	GroupName            string `gorm:"primaryKey;size:64"`
	OwnerUserID          int    `gorm:"primaryKey;autoIncrement:false"`
	UserID               int    `gorm:"primaryKey;autoIncrement:false"`
	WalletQuota          int64  `gorm:"type:bigint;not null"`
	SubscriptionQuota    int64  `gorm:"type:bigint;not null"`
	Requests             int64  `gorm:"type:bigint;not null"`
	WalletRequests       int64  `gorm:"type:bigint;not null"`
	SubscriptionRequests int64  `gorm:"type:bigint;not null"`
	Unattributed         int64  `gorm:"type:bigint;not null"`
}

func recordConsumptionAttribution(log *Log) error {
	if log.Type != LogTypeConsume || strings.HasSuffix(log.RequestId, ":violation") {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		candidate := ConsumptionAttribution{RequestID: log.RequestId, GroupName: log.Group, OwnerUserID: log.GroupOwnerUserID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate).Error; err != nil {
			return err
		}
		var stored ConsumptionAttribution
		if err := lockForUpdate(tx).Where("request_id = ?", log.RequestId).First(&stored).Error; err != nil {
			return err
		}
		if stored.GroupName != candidate.GroupName || stored.OwnerUserID != candidate.OwnerUserID {
			if err := tx.Model(&stored).Update("ambiguous", true).Error; err != nil {
				return err
			}
		}
		// The settlement transaction sets this too, covering either arrival order.
		return tx.Model(&PostpaidSettlement{}).Where("request_id = ?", log.RequestId).UpdateColumn("consumption_dirty", true).Error
	})
}

// A month's row lock serializes aggregate updates across instances. SQLite takes
// its writer lock on the insert before reading the checkpoint; other DBs use FOR UPDATE.
func syncConsumptionMonthBatch(db, logDB *gorm.DB, period string, start, end int64) (bool, error) {
	done := false
	err := db.Transaction(func(tx *gorm.DB) error {
		state := ConsumptionMonth{Period: period}
		claim := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&state)
		if claim.Error != nil {
			return claim.Error
		}
		if err := lockForUpdate(tx).Where("period = ?", period).First(&state).Error; err != nil {
			return err
		}
		if !state.BackfillStarted {
			state.BackfillStarted = true
			if err := tx.Model(&PostpaidSettlement{}).Where("started_at >= ? AND started_at < ?", start, end).Select("COALESCE(MAX(id),0)").Scan(&state.BackfillLimit).Error; err != nil {
				return err
			}
		}
		query := lockForUpdate(tx.Model(&PostpaidSettlement{})).Where("started_at >= ? AND started_at < ?", start, end)
		if state.Initialized {
			query = query.Where("consumption_dirty = ?", true)
		} else {
			query = query.Where("id > ? AND id <= ?", state.BackfillID, state.BackfillLimit)
		}
		var settlements []PostpaidSettlement
		if err := query.Order("id ASC").Limit(500).Find(&settlements).Error; err != nil {
			return err
		}
		if len(settlements) == 0 {
			if state.Initialized {
				done = true
				return nil
			}
			state.Initialized = true
		} else {
			// Only unresolved historical requests consult logs. New requests have durable attribution.
			ids := make([]string, 0, len(settlements))
			settlementIDs := make([]int64, 0, len(settlements))
			for _, settlement := range settlements {
				ids = append(ids, settlement.RequestId)
				settlementIDs = append(settlementIDs, settlement.Id)
			}
			var attributions []ConsumptionAttribution
			if err := tx.Where("request_id IN ?", ids).Find(&attributions).Error; err != nil {
				return err
			}
			byRequest := map[string]ConsumptionAttribution{}
			for _, attribution := range attributions {
				byRequest[attribution.RequestID] = attribution
			}
			var previous []ConsumptionContribution
			if err := tx.Where("settlement_id IN ?", settlementIDs).Find(&previous).Error; err != nil {
				return err
			}
			previousByID := map[int64]ConsumptionContribution{}
			for _, row := range previous {
				previousByID[row.SettlementID] = row
			}
			for _, settlement := range settlements {
				if old := previousByID[settlement.Id]; old.GroupName != "" {
					if _, ok := byRequest[settlement.RequestId]; !ok {
						byRequest[settlement.RequestId] = ConsumptionAttribution{RequestID: settlement.RequestId, GroupName: old.GroupName, OwnerUserID: old.OwnerUserID}
					}
				}
			}
			missing := []string{}
			for _, id := range ids {
				if _, ok := byRequest[id]; !ok {
					missing = append(missing, id)
				}
			}
			if len(missing) > 0 {
				var logs []Log
				logReader := logDB
				if db == logDB {
					logReader = tx
				}
				if err := logReader.Model(&Log{}).Select([]string{"request_id", "group", "group_owner_user_id"}).Where("request_id IN ? AND type = ?", missing, LogTypeConsume).Distinct().Find(&logs).Error; err != nil {
					return err
				}
				for _, log := range logs {
					previous, ok := byRequest[log.RequestId]
					current := ConsumptionAttribution{RequestID: log.RequestId, GroupName: log.Group, OwnerUserID: log.GroupOwnerUserID}
					if ok && (previous.Ambiguous || previous.GroupName != current.GroupName || previous.OwnerUserID != current.OwnerUserID) {
						current.Ambiguous = true
					}
					byRequest[log.RequestId] = current
				}
			}
			type aggregateKey struct {
				group       string
				owner, user int
			}
			deltas := map[aggregateKey]ConsumptionContribution{}
			contributions := make([]ConsumptionContribution, 0, len(settlements))
			for _, settlement := range settlements {
				old := previousByID[settlement.Id]
				next := ConsumptionContribution{SettlementID: settlement.Id, Period: period, UserID: settlement.UserId}
				attribution, found := byRequest[settlement.RequestId]
				// Original attribution survives log retention. A later conflicting live
				// snapshot is never allowed to transfer historical consumption to an owner.
				if old.SettlementID != 0 && old.GroupName != "" {
					if !found {
						attribution = ConsumptionAttribution{GroupName: old.GroupName, OwnerUserID: old.OwnerUserID}
						found = true
					} else if attribution.GroupName != old.GroupName || attribution.OwnerUserID != old.OwnerUserID {
						attribution.Ambiguous = true
					}
				}
				next.AttributionConflict = old.AttributionConflict || attribution.Ambiguous
				if !strings.HasSuffix(settlement.RequestId, ":violation") {
					if found && attribution.GroupName != "" && !next.AttributionConflict {
						next.GroupName = attribution.GroupName
						next.OwnerUserID = attribution.OwnerUserID
						next.WalletQuota = int64(settlement.WalletQuota)
						next.SubscriptionQuota = int64(settlement.SubscriptionQuota)
						next.Requests = 1
						if settlement.WalletQuota > 0 {
							next.WalletRequests = 1
						}
						if settlement.SubscriptionQuota > 0 {
							next.SubscriptionRequests = 1
						}
					} else if settlement.WalletQuota > 0 || settlement.SubscriptionQuota > 0 {
						next.Unattributed = 1
					}
				}
				for _, change := range []struct {
					row  ConsumptionContribution
					sign int64
				}{{old, -1}, {next, 1}} {
					if change.row.SettlementID == 0 {
						continue
					}
					k := aggregateKey{change.row.GroupName, change.row.OwnerUserID, change.row.UserID}
					delta := deltas[k]
					delta.Period = period
					delta.GroupName = k.group
					delta.OwnerUserID = k.owner
					delta.UserID = k.user
					delta.WalletQuota += change.sign * change.row.WalletQuota
					delta.SubscriptionQuota += change.sign * change.row.SubscriptionQuota
					delta.Requests += change.sign * change.row.Requests
					delta.WalletRequests += change.sign * change.row.WalletRequests
					delta.SubscriptionRequests += change.sign * change.row.SubscriptionRequests
					delta.Unattributed += change.sign * change.row.Unattributed
					deltas[k] = delta
				}
				contributions = append(contributions, next)
			}
			for _, delta := range deltas {
				if err := applyConsumptionContribution(tx, delta, 1); err != nil {
					return err
				}
			}
			if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).CreateInBatches(&contributions, 100).Error; err != nil {
				return err
			}
			if err := tx.Model(&PostpaidSettlement{}).Where("id IN ?", settlementIDs).UpdateColumn("consumption_dirty", false).Error; err != nil {
				return err
			}

			if !state.Initialized {
				state.BackfillID = settlements[len(settlements)-1].Id
			}
		}
		state.UpdatedAt = time.Now().Unix()
		return tx.Save(&state).Error
	})
	return done, err
}

func applyConsumptionContribution(tx *gorm.DB, row ConsumptionContribution, sign int64) error {
	if row.Requests == 0 && row.Unattributed == 0 && row.WalletQuota == 0 && row.SubscriptionQuota == 0 && row.WalletRequests == 0 && row.SubscriptionRequests == 0 {
		return nil
	}
	aggregate := ConsumptionAggregate{Period: row.Period, GroupName: row.GroupName, OwnerUserID: row.OwnerUserID, UserID: row.UserID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&aggregate).Error; err != nil {
		return err
	}
	return tx.Model(&ConsumptionAggregate{}).Where("period = ? AND group_name = ? AND owner_user_id = ? AND user_id = ?", row.Period, row.GroupName, row.OwnerUserID, row.UserID).Updates(map[string]any{
		"wallet_quota":          gorm.Expr("wallet_quota + ?", sign*row.WalletQuota),
		"subscription_quota":    gorm.Expr("subscription_quota + ?", sign*row.SubscriptionQuota),
		"requests":              gorm.Expr("requests + ?", sign*row.Requests),
		"wallet_requests":       gorm.Expr("wallet_requests + ?", sign*row.WalletRequests),
		"subscription_requests": gorm.Expr("subscription_requests + ?", sign*row.SubscriptionRequests),
		"unattributed":          gorm.Expr("unattributed + ?", sign*row.Unattributed),
	}).Error
}

func QueryPersistedConsumption(start, end int64, ownerID int, filters ConsumptionFilters) (GroupConsumptionReport, error) {
	if err := validateConsumptionQuery(start, end, ownerID, filters); err != nil {
		return GroupConsumptionReport{}, err
	}
	period := time.Unix(start, 0).In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01")
	monthStart, monthEnd, err := BeijingConsumptionWindow(period)
	if err != nil || monthStart.Unix() != start || monthEnd.Unix() != end {
		return GroupConsumptionReport{}, errors.New("consumption persistence requires a calendar month")
	}
	for {
		done, err := syncConsumptionMonthBatch(DB, LOG_DB, period, start, end)
		if err != nil {
			return GroupConsumptionReport{}, err
		}
		if done {
			break
		}
	}
	cube := &consumptionCube{Unattributed: map[int]int64{}}
	// A short read transaction keeps the timestamp and aggregate rows consistent.
	err = DB.Transaction(func(tx *gorm.DB) error {
		var state ConsumptionMonth
		if err := tx.Where("period = ?", period).First(&state).Error; err != nil {
			return err
		}
		cube.GeneratedAt = state.UpdatedAt
		var rows []ConsumptionAggregate
		query := tx.Where("period = ? AND (requests > 0 OR unattributed > 0)", period)
		if ownerID > 0 {
			query = query.Where("owner_user_id = ? AND group_name <> ?", ownerID, "")
		}
		if err := query.Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if row.GroupName == "" {
				cube.Unattributed[row.UserID] += row.Unattributed
				continue
			}
			cube.Rows = append(cube.Rows, consumptionCubeRow{GroupConsumption: GroupConsumption{Group: row.GroupName, OwnerUserID: row.OwnerUserID, UserID: row.UserID, WalletQuota: row.WalletQuota, SubscriptionQuota: row.SubscriptionQuota, Requests: row.Requests}, WalletRequests: row.WalletRequests, SubscriptionRequests: row.SubscriptionRequests})
		}
		return nil
	})
	if err != nil {
		return GroupConsumptionReport{}, err
	}
	return summarizeConsumption(cube, ownerID, filters), nil
}

// Used by controlled imports that bypass normal settlement/log writers.
// Requeue only the affected requests; never reset a month's completed checkpoint.
func MarkConsumptionRequestsDirty(requestIDs []string) error {
	if len(requestIDs) > 500 {
		return errors.New("too many consumption requests")
	}
	if len(requestIDs) == 0 {
		return nil
	}
	return DB.Model(&PostpaidSettlement{}).Where("request_id IN ?", requestIDs).UpdateColumn("consumption_dirty", true).Error
}
