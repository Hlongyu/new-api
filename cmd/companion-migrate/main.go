package main

import (
	"crypto/sha256"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	sourcePath   = flag.String("source", "", "path to the stopped Companion SQLite database")
	migrationKey = flag.String("migration-key", "companion-cutover-v1", "unique key for this migration batch")
	cutoverAt    = flag.Int64("cutover-at", 0, "Companion cutover time as a Unix timestamp")
	dryRun       = flag.Bool("dry-run", false, "read and validate the source without writing Core")
	excludedIds  = flag.String("excluded-user-ids", os.Getenv("LEADERBOARD_EXCLUDED_USER_IDS"), "fallback excluded user IDs when Companion has no saved setting")
)

type sourcePostpaidGrant struct {
	Id                string `gorm:"column:id"`
	RequestKey        string `gorm:"column:request_key"`
	UserId            int    `gorm:"column:user_id"`
	EntryId           int    `gorm:"column:entry_id"`
	TierKey           string `gorm:"column:tier_key"`
	TierName          string `gorm:"column:tier_name"`
	CreditAmount      int    `gorm:"column:credit_amount"`
	QuotaAmount       int    `gorm:"column:quota_amount"`
	OutstandingQuota  int    `gorm:"column:outstanding_quota"`
	RedemptionStartId int    `gorm:"column:redemption_start_id"`
	Status            string `gorm:"column:status"`
	ErrorMessage      string `gorm:"column:error_message"`
	OperatorUserId    int    `gorm:"column:operator_user_id"`
	CreatedAt         int64  `gorm:"column:created_at"`
	UpdatedAt         int64  `gorm:"column:updated_at"`
	DueAt             int64  `gorm:"column:due_at"`
	CompletedAt       int64  `gorm:"column:completed_at"`
}

func (sourcePostpaidGrant) TableName() string { return "postpaid_grants" }

type sourcePostpaidEvent struct {
	Id                string `gorm:"column:id"`
	GrantId           string `gorm:"column:grant_id"`
	UserId            int    `gorm:"column:user_id"`
	EventType         string `gorm:"column:event_type"`
	RedemptionId      *int   `gorm:"column:redemption_id"`
	RedemptionTime    int64  `gorm:"column:redemption_time"`
	QuotaAmount       int    `gorm:"column:quota_amount"`
	OutstandingBefore int    `gorm:"column:outstanding_before"`
	OutstandingAfter  int    `gorm:"column:outstanding_after"`
	Status            string `gorm:"column:status"`
	ErrorMessage      string `gorm:"column:error_message"`
	CreatedAt         int64  `gorm:"column:created_at"`
	UpdatedAt         int64  `gorm:"column:updated_at"`
}

func (sourcePostpaidEvent) TableName() string { return "postpaid_events" }

type sourceAppSetting struct {
	Key   string `gorm:"column:key"`
	Value string `gorm:"column:value"`
}

func (sourceAppSetting) TableName() string { return "app_settings" }

type migrationBundle struct {
	Entries              []model.LeaderboardEntry
	SponsorOrders        []model.SponsorOrder
	RenameCardBalances   []model.RenameCardBalance
	RenameEvents         []model.RenameEvent
	RenameCardOrders     []model.RenameCardOrder
	LotteryDraws         []model.LotteryDraw
	LotteryPeriods       []model.LotteryPeriod
	LotteryOpportunities []model.LotteryOpportunity
	PostpaidGrants       []sourcePostpaidGrant
	PostpaidEvents       []sourcePostpaidEvent
	RechargeCampaigns    []model.RechargeLotteryCampaign
	RechargePrizes       []model.RechargeLotteryPrize
	RechargeGrantBatches []model.RechargeLotteryGrantBatch
	RechargeLedger       []model.RechargeLotteryLedger
	RechargeDrawBatches  []model.RechargeLotteryDrawBatch
	RechargeDrawItems    []model.RechargeLotteryDrawItem
	RechargePlanMappings []model.RechargeLotteryPlanMapping
	RechargeProgress     []model.RechargeLotteryRedemptionProgress
	ExcludedUserIds      []int
	ExcludedUsersStored  bool
}

type migrationCounts struct {
	Entries              int
	SponsorOrders        int
	RenameCardBalances   int
	RenameEvents         int
	RenameCardOrders     int
	LotteryDraws         int
	LotteryPeriods       int
	LotteryOpportunities int
	QuotaLoans           int
	QuotaLoanEvents      int
	RechargeCampaigns    int
	RechargePrizes       int
	RechargeGrantBatches int
	RechargeLedger       int
	RechargeDrawBatches  int
	RechargeDrawItems    int
	RechargePlanMappings int
	RechargeProgress     int
	ExcludedUsers        int
	UnresolvedRows       int
}

func main() {
	common.InitEnv()
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "companion migration failed:", err)
		os.Exit(1)
	}
}

func run() error {
	if *sourcePath == "" {
		return errors.New("--source is required")
	}
	if *migrationKey == "" {
		return errors.New("--migration-key must not be empty")
	}
	if len(*migrationKey) > 128 {
		return errors.New("--migration-key must not exceed 128 characters")
	}
	if *cutoverAt <= 0 {
		return errors.New("--cutover-at must be the Unix timestamp recorded after Companion stopped")
	}
	absoluteSource, err := filepath.Abs(*sourcePath)
	if err != nil {
		return err
	}
	info, err := os.Stat(absoluteSource)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("--source must point to a regular SQLite database file")
	}

	sourceURL := &url.URL{Scheme: "file", Path: absoluteSource, RawQuery: "mode=ro&_busy_timeout=5000"}
	source, err := gorm.Open(sqlite.Open(sourceURL.String()), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open Companion database: %w", err)
	}
	bundle, err := readMigrationBundle(source)
	if err != nil {
		return err
	}
	if !bundle.ExcludedUsersStored && strings.TrimSpace(*excludedIds) != "" {
		bundle.ExcludedUserIds, err = parseExcludedUserIds(*excludedIds)
		if err != nil {
			return err
		}
	}
	if err := validateMigrationBundle(bundle); err != nil {
		return err
	}
	hash, err := bundleHash(bundle)
	if err != nil {
		return err
	}
	counts := bundle.counts()
	printMigrationSummary("source", hash, counts)
	if *dryRun {
		fmt.Println("dry run complete; Core was not changed")
		return nil
	}

	if err := model.InitDB(); err != nil {
		return fmt.Errorf("initialize Core database: %w", err)
	}
	targetSQL, err := model.DB.DB()
	if err != nil {
		return fmt.Errorf("access Core database connection: %w", err)
	}
	defer targetSQL.Close()
	alreadyDone, err := migrationAlreadyCompleted(model.DB, *migrationKey, hash, *cutoverAt)
	if err != nil {
		return err
	}
	if alreadyDone {
		fmt.Println("migration already completed with the same source manifest")
		return nil
	}
	if err := importMigrationBundle(model.DB, bundle, *migrationKey, hash, *cutoverAt); err != nil {
		return err
	}
	printMigrationSummary("imported", hash, counts)
	return nil
}

func readMigrationBundle(source *gorm.DB) (migrationBundle, error) {
	requiredTables := []string{
		"leaderboard_entries", "sponsor_orders", "rename_card_balances", "rename_events",
		"rename_card_orders", "lottery_draws", "lottery_periods", "lottery_opportunities",
		"postpaid_grants", "postpaid_events", "app_settings", "lottery_campaigns",
		"lottery_prizes", "lottery_grant_batches", "lottery_ledger", "lottery_draw_batches",
		"lottery_draw_items", "lottery_plan_mappings", "lottery_redemption_progress",
	}
	for _, table := range requiredTables {
		if !source.Migrator().HasTable(table) {
			return migrationBundle{}, fmt.Errorf("Companion table %q is missing", table)
		}
	}

	bundle := migrationBundle{}
	queries := []struct {
		name  string
		order string
		value interface{}
	}{
		{"leaderboard_entries", "id asc", &bundle.Entries},
		{"sponsor_orders", "id asc", &bundle.SponsorOrders},
		{"rename_card_balances", "user_id asc", &bundle.RenameCardBalances},
		{"rename_events", "id asc", &bundle.RenameEvents},
		{"rename_card_orders", "id asc", &bundle.RenameCardOrders},
		{"lottery_draws", "id asc", &bundle.LotteryDraws},
		{"lottery_periods", "rule_version asc, period_key asc", &bundle.LotteryPeriods},
		{"lottery_opportunities", "rule_version asc, period_key asc, draw_rank asc", &bundle.LotteryOpportunities},
		{"postpaid_grants", "id asc", &bundle.PostpaidGrants},
		{"postpaid_events", "id asc", &bundle.PostpaidEvents},
		{"lottery_campaigns", "id asc", &bundle.RechargeCampaigns},
		{"lottery_prizes", "id asc", &bundle.RechargePrizes},
		{"lottery_grant_batches", "id asc", &bundle.RechargeGrantBatches},
		{"lottery_ledger", "created_at asc, id asc", &bundle.RechargeLedger},
		{"lottery_draw_batches", "created_at asc, id asc", &bundle.RechargeDrawBatches},
		{"lottery_draw_items", "draw_batch_id asc, ordinal asc", &bundle.RechargeDrawItems},
		{"lottery_plan_mappings", "quota_amount asc, duration_days asc", &bundle.RechargePlanMappings},
		{"lottery_redemption_progress", "user_id asc", &bundle.RechargeProgress},
	}
	for _, query := range queries {
		if err := source.Table(query.name).Order(query.order).Find(query.value).Error; err != nil {
			return migrationBundle{}, fmt.Errorf("read %s: %w", query.name, err)
		}
	}

	var excludedSetting sourceAppSetting
	result := source.Where("key = ?", "excluded_user_ids").Limit(1).Find(&excludedSetting)
	if result.Error != nil {
		return migrationBundle{}, fmt.Errorf("read excluded users: %w", result.Error)
	}
	if result.RowsAffected > 0 && excludedSetting.Value != "" {
		bundle.ExcludedUsersStored = true
		if err := common.UnmarshalJsonStr(excludedSetting.Value, &bundle.ExcludedUserIds); err != nil {
			return migrationBundle{}, fmt.Errorf("decode excluded_user_ids: %w", err)
		}
	}
	if result.RowsAffected > 0 {
		bundle.ExcludedUsersStored = true
	}
	return bundle, nil
}

func parseExcludedUserIds(value string) ([]int, error) {
	parts := strings.FieldsFunc(value, func(character rune) bool {
		return character == ',' || character == ' ' || character == '\t' || character == '\r' || character == '\n'
	})
	unique := make(map[int]bool, len(parts))
	result := make([]int, 0, len(parts))
	for _, part := range parts {
		userId, err := strconv.Atoi(part)
		if err != nil || userId <= 0 {
			return nil, fmt.Errorf("invalid excluded user ID %q", part)
		}
		if !unique[userId] {
			unique[userId] = true
			result = append(result, userId)
		}
	}
	sort.Ints(result)
	return result, nil
}

func validateMigrationBundle(bundle migrationBundle) error {
	processing := make([]string, 0)
	for _, order := range bundle.SponsorOrders {
		if order.Status == model.LeaderboardOrderProcessing {
			processing = append(processing, "sponsor_orders/"+order.Id)
		}
	}
	for _, order := range bundle.RenameCardOrders {
		if order.Status == model.LeaderboardOrderProcessing {
			processing = append(processing, "rename_card_orders/"+order.Id)
		}
	}
	for _, draw := range bundle.LotteryDraws {
		if draw.Status == model.LeaderboardOrderProcessing {
			processing = append(processing, "lottery_draws/"+draw.Id)
		}
	}
	for _, grant := range bundle.PostpaidGrants {
		if grant.Status == model.LeaderboardOrderProcessing {
			processing = append(processing, "postpaid_grants/"+grant.Id)
		}
	}
	for _, event := range bundle.PostpaidEvents {
		if event.Status == model.LeaderboardOrderProcessing {
			processing = append(processing, "postpaid_events/"+event.Id)
		}
	}
	for _, batch := range bundle.RechargeGrantBatches {
		if batch.Status == model.RechargeLotteryBatchProcessing {
			processing = append(processing, "lottery_grant_batches/"+batch.Id)
		}
	}
	for _, draw := range bundle.RechargeDrawBatches {
		if draw.Status == model.RechargeLotteryDrawProcessing {
			processing = append(processing, "lottery_draw_batches/"+draw.Id)
		}
	}
	if len(processing) > 0 {
		sort.Strings(processing)
		return fmt.Errorf("Companion still has processing rows: %s", strings.Join(processing, ", "))
	}
	return nil
}

func bundleHash(bundle migrationBundle) (string, error) {
	data, err := common.Marshal(bundle)
	if err != nil {
		return "", fmt.Errorf("encode migration manifest: %w", err)
	}
	hash := sha256.Sum256(data)
	return fmt.Sprintf("sha256:%x", hash), nil
}

func migrationAlreadyCompleted(target *gorm.DB, key string, hash string, cutover int64) (bool, error) {
	var migration model.CompanionMigration
	result := target.Where("migration_key = ?", key).Limit(1).Find(&migration)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, nil
	}
	if migration.ManifestHash != hash || migration.CutoverAt != cutover {
		return false, errors.New("migration key already exists with a different source manifest or cutover time")
	}
	return true, nil
}

func importMigrationBundle(target *gorm.DB, bundle migrationBundle, key string, hash string, cutover int64) error {
	return target.Transaction(func(baseTx *gorm.DB) error {
		tx := baseTx.Session(&gorm.Session{NowFunc: func() time.Time { return time.Unix(0, 0) }})
		entryIdMap := make(map[int]int, len(bundle.Entries))
		for index := range bundle.Entries {
			sourceEntry := bundle.Entries[index]
			var targetEntry model.LeaderboardEntry
			result := tx.Where("user_id = ?", sourceEntry.UserId).Limit(1).Find(&targetEntry)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				sourceId := sourceEntry.Id
				sourceEntry.Id = 0
				if err := tx.Create(&sourceEntry).Error; err != nil {
					return fmt.Errorf("import leaderboard entry for user %d: %w", sourceEntry.UserId, err)
				}
				entryIdMap[sourceId] = sourceEntry.Id
				continue
			}
			if err := tx.Model(&targetEntry).Select(
				"username", "source_name", "token_id", "token_name", "masked_key", "display_name",
				"anonymous_name", "is_name_public", "token_created_at", "manage_secret_hash", "created_at",
				"active", "participating", "participate_day", "participate_week", "participate_month",
				"participate_all", "participate_rank", "show_rank_badge",
			).Updates(sourceEntry).Error; err != nil {
				return fmt.Errorf("update leaderboard entry for user %d: %w", sourceEntry.UserId, err)
			}
			entryIdMap[sourceEntry.Id] = targetEntry.Id
		}

		for index := range bundle.SponsorOrders {
			entryId, ok := entryIdMap[bundle.SponsorOrders[index].EntryId]
			if !ok {
				return fmt.Errorf("sponsor order %s references missing entry %d", bundle.SponsorOrders[index].Id, bundle.SponsorOrders[index].EntryId)
			}
			bundle.SponsorOrders[index].EntryId = entryId
		}
		for index := range bundle.RenameEvents {
			entryId, ok := entryIdMap[bundle.RenameEvents[index].EntryId]
			if !ok {
				return fmt.Errorf("rename event %s references missing entry %d", bundle.RenameEvents[index].Id, bundle.RenameEvents[index].EntryId)
			}
			bundle.RenameEvents[index].EntryId = entryId
		}
		for index := range bundle.RenameCardOrders {
			entryId, ok := entryIdMap[bundle.RenameCardOrders[index].EntryId]
			if !ok {
				return fmt.Errorf("rename card order %s references missing entry %d", bundle.RenameCardOrders[index].Id, bundle.RenameCardOrders[index].EntryId)
			}
			bundle.RenameCardOrders[index].EntryId = entryId
		}
		for index := range bundle.LotteryDraws {
			entryId, ok := entryIdMap[bundle.LotteryDraws[index].EntryId]
			if !ok {
				return fmt.Errorf("lottery draw %s references missing entry %d", bundle.LotteryDraws[index].Id, bundle.LotteryDraws[index].EntryId)
			}
			bundle.LotteryDraws[index].EntryId = entryId
		}
		for index := range bundle.LotteryOpportunities {
			entryId, ok := entryIdMap[bundle.LotteryOpportunities[index].EntryId]
			if !ok {
				return fmt.Errorf("lottery opportunity %s/%d references missing entry %d", bundle.LotteryOpportunities[index].PeriodKey, bundle.LotteryOpportunities[index].DrawRank, bundle.LotteryOpportunities[index].EntryId)
			}
			bundle.LotteryOpportunities[index].EntryId = entryId
		}

		loans := make([]model.QuotaLoan, 0, len(bundle.PostpaidGrants))
		for _, grant := range bundle.PostpaidGrants {
			entryId, ok := entryIdMap[grant.EntryId]
			if !ok {
				return fmt.Errorf("postpaid grant %s references missing entry %d", grant.Id, grant.EntryId)
			}
			loans = append(loans, model.QuotaLoan{
				Id: grant.Id, RequestKey: grant.RequestKey, UserId: grant.UserId, EntryId: entryId,
				TierKey: grant.TierKey, TierName: grant.TierName, CreditAmount: grant.CreditAmount,
				QuotaAmount: grant.QuotaAmount, OutstandingQuota: grant.OutstandingQuota,
				RedemptionStartId: grant.RedemptionStartId, Status: grant.Status,
				ErrorMessage: grant.ErrorMessage, OperatorUserId: grant.OperatorUserId,
				CreatedAt: grant.CreatedAt, UpdatedAt: grant.UpdatedAt, DueAt: grant.DueAt,
				CompletedAt: grant.CompletedAt,
			})
		}
		events := make([]model.QuotaLoanEvent, 0, len(bundle.PostpaidEvents))
		for _, event := range bundle.PostpaidEvents {
			sourceType := "legacy"
			sourceId := event.Id
			if event.RedemptionId != nil {
				sourceType = "redemption"
				sourceId = strconv.Itoa(*event.RedemptionId)
			}
			events = append(events, model.QuotaLoanEvent{
				Id: event.Id, LoanId: event.GrantId, UserId: event.UserId, EventType: event.EventType,
				SourceType: sourceType, SourceId: sourceId, QuotaAmount: event.QuotaAmount,
				OutstandingBefore: event.OutstandingBefore, OutstandingAfter: event.OutstandingAfter,
				RedemptionTime: event.RedemptionTime, Status: event.Status, ErrorMessage: event.ErrorMessage,
				CreatedAt: event.CreatedAt, UpdatedAt: event.UpdatedAt,
			})
		}

		if len(bundle.RenameCardBalances) > 0 {
			if err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "user_id"}},
				DoUpdates: clause.AssignmentColumns([]string{"balance", "updated_at"}),
			}).Create(&bundle.RenameCardBalances).Error; err != nil {
				return fmt.Errorf("import rename card balances: %w", err)
			}
		}
		imports := []struct {
			name  string
			value interface{}
			count int
		}{
			{"sponsor orders", &bundle.SponsorOrders, len(bundle.SponsorOrders)},
			{"rename events", &bundle.RenameEvents, len(bundle.RenameEvents)},
			{"rename card orders", &bundle.RenameCardOrders, len(bundle.RenameCardOrders)},
			{"lottery draws", &bundle.LotteryDraws, len(bundle.LotteryDraws)},
			{"lottery periods", &bundle.LotteryPeriods, len(bundle.LotteryPeriods)},
			{"lottery opportunities", &bundle.LotteryOpportunities, len(bundle.LotteryOpportunities)},
			{"quota loans", &loans, len(loans)},
			{"quota loan events", &events, len(events)},
			{"recharge lottery campaigns", &bundle.RechargeCampaigns, len(bundle.RechargeCampaigns)},
			{"recharge lottery prizes", &bundle.RechargePrizes, len(bundle.RechargePrizes)},
			{"recharge lottery grant batches", &bundle.RechargeGrantBatches, len(bundle.RechargeGrantBatches)},
			{"recharge lottery ledger", &bundle.RechargeLedger, len(bundle.RechargeLedger)},
			{"recharge lottery draw batches", &bundle.RechargeDrawBatches, len(bundle.RechargeDrawBatches)},
			{"recharge lottery draw items", &bundle.RechargeDrawItems, len(bundle.RechargeDrawItems)},
			{"recharge lottery plan mappings", &bundle.RechargePlanMappings, len(bundle.RechargePlanMappings)},
			{"recharge lottery redemption progress", &bundle.RechargeProgress, len(bundle.RechargeProgress)},
		}
		for _, item := range imports {
			if item.count == 0 {
				continue
			}
			if len(bundle.RechargePrizes) > 0 && tx.Dialector.Name() == "postgres" {
				if err := tx.Exec(
					"SELECT setval(pg_get_serial_sequence('lottery_prizes', 'id'), COALESCE((SELECT MAX(id) FROM lottery_prizes), 1), true)",
				).Error; err != nil {
					return fmt.Errorf("advance recharge lottery prize sequence: %w", err)
				}
			}
			if err := tx.CreateInBatches(item.value, 200).Error; err != nil {
				return fmt.Errorf("import %s: %w", item.name, err)
			}
		}
		for _, userId := range bundle.ExcludedUserIds {
			if userId <= 0 {
				continue
			}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.LeaderboardExcludedUser{
				UserId: userId, CreatedAt: cutover,
			}).Error; err != nil {
				return fmt.Errorf("import excluded user %d: %w", userId, err)
			}
		}
		if err := tx.Create(&model.CompanionMigration{
			MigrationKey: key, ManifestHash: hash, CutoverAt: cutover, CompletedAt: time.Now().Unix(),
		}).Error; err != nil {
			return fmt.Errorf("record migration: %w", err)
		}
		return nil
	})
}

func (bundle migrationBundle) counts() migrationCounts {
	counts := migrationCounts{
		Entries: len(bundle.Entries), SponsorOrders: len(bundle.SponsorOrders),
		RenameCardBalances: len(bundle.RenameCardBalances), RenameEvents: len(bundle.RenameEvents),
		RenameCardOrders: len(bundle.RenameCardOrders), LotteryDraws: len(bundle.LotteryDraws),
		LotteryPeriods: len(bundle.LotteryPeriods), LotteryOpportunities: len(bundle.LotteryOpportunities),
		QuotaLoans: len(bundle.PostpaidGrants), QuotaLoanEvents: len(bundle.PostpaidEvents),
		RechargeCampaigns: len(bundle.RechargeCampaigns), RechargePrizes: len(bundle.RechargePrizes),
		RechargeGrantBatches: len(bundle.RechargeGrantBatches), RechargeLedger: len(bundle.RechargeLedger),
		RechargeDrawBatches: len(bundle.RechargeDrawBatches), RechargeDrawItems: len(bundle.RechargeDrawItems),
		RechargePlanMappings: len(bundle.RechargePlanMappings), RechargeProgress: len(bundle.RechargeProgress),
		ExcludedUsers: len(bundle.ExcludedUserIds),
	}
	for _, order := range bundle.SponsorOrders {
		if order.Status == model.LeaderboardOrderUnknown {
			counts.UnresolvedRows++
		}
	}
	for _, order := range bundle.RenameCardOrders {
		if order.Status == model.LeaderboardOrderUnknown {
			counts.UnresolvedRows++
		}
	}
	for _, draw := range bundle.LotteryDraws {
		if draw.Status == model.LeaderboardOrderUnknown {
			counts.UnresolvedRows++
		}
	}
	for _, grant := range bundle.PostpaidGrants {
		if grant.Status == model.LeaderboardOrderUnknown {
			counts.UnresolvedRows++
		}
	}
	for _, event := range bundle.PostpaidEvents {
		if event.Status == model.LeaderboardOrderUnknown {
			counts.UnresolvedRows++
		}
	}
	for _, batch := range bundle.RechargeGrantBatches {
		if batch.Status == model.RechargeLotteryBatchFailed {
			counts.UnresolvedRows++
		}
	}
	for _, draw := range bundle.RechargeDrawBatches {
		if draw.Status == model.RechargeLotteryDrawPending || draw.Status == model.RechargeLotteryDrawUnknown || draw.Status == model.RechargeLotteryDrawFailed {
			counts.UnresolvedRows++
		}
	}
	return counts
}

func printMigrationSummary(label string, hash string, counts migrationCounts) {
	fmt.Printf("%s manifest %s\n", label, hash)
	fmt.Printf(
		"entries=%d sponsors=%d rename_balances=%d rename_events=%d rename_orders=%d weekly_lottery_draws=%d weekly_lottery_periods=%d weekly_lottery_opportunities=%d quota_loans=%d quota_loan_events=%d recharge_campaigns=%d recharge_prizes=%d recharge_grant_batches=%d recharge_ledger=%d recharge_draw_batches=%d recharge_draw_items=%d recharge_plan_mappings=%d recharge_progress=%d excluded_users=%d unresolved_rows=%d\n",
		counts.Entries, counts.SponsorOrders, counts.RenameCardBalances, counts.RenameEvents,
		counts.RenameCardOrders, counts.LotteryDraws, counts.LotteryPeriods, counts.LotteryOpportunities,
		counts.QuotaLoans, counts.QuotaLoanEvents, counts.RechargeCampaigns, counts.RechargePrizes,
		counts.RechargeGrantBatches, counts.RechargeLedger, counts.RechargeDrawBatches,
		counts.RechargeDrawItems, counts.RechargePlanMappings, counts.RechargeProgress,
		counts.ExcludedUsers, counts.UnresolvedRows,
	)
}
