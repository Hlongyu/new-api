package main

import (
	"net/url"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestImportMigrationBundlePreservesFactsWithoutWalletSideEffects(t *testing.T) {
	target, err := gorm.Open(sqlite.Open("file:companion-migration?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, target.AutoMigrate(
		&model.User{},
		&model.LeaderboardEntry{},
		&model.LeaderboardExcludedUser{},
		&model.SponsorOrder{},
		&model.RenameCardBalance{},
		&model.RenameEvent{},
		&model.RenameCardOrder{},
		&model.LotteryDraw{},
		&model.LotteryPeriod{},
		&model.LotteryOpportunity{},
		&model.QuotaLoan{},
		&model.QuotaLoanEvent{},
		&model.CompanionMigration{},
		&model.RechargeLotteryCampaign{}, &model.RechargeLotteryPrize{},
		&model.RechargeLotteryGrantBatch{}, &model.RechargeLotteryLedger{},
		&model.RechargeLotteryDrawBatch{}, &model.RechargeLotteryDrawItem{},
		&model.RechargeLotteryPlanMapping{}, &model.RechargeLotteryRedemptionProgress{},
	))
	require.NoError(t, target.Create(&model.User{Id: 42, Username: "alice", Quota: 12345}).Error)
	require.NoError(t, target.Create(&model.LeaderboardEntry{
		Id: 31, UserId: 42, Username: "temporary", SourceName: "Temporary",
		DisplayName: "Temporary", AnonymousName: "Anonymous Temporary",
		CreatedAt: 10, Active: true, Participating: true, ParticipateDay: true,
	}).Error)

	bundle := migrationBundle{
		Entries: []model.LeaderboardEntry{{
			Id: 7, UserId: 42, Username: "alice", SourceName: "Alice",
			DisplayName: "Alice Board", AnonymousName: "Anonymous Alice",
			IsNamePublic: true, CreatedAt: 100, Active: true, Participating: true,
			ParticipateDay: true, ParticipateWeek: true, ParticipateMonth: true,
			ParticipateAll: true, ParticipateRank: true, ShowRankBadge: true,
		}},
		SponsorOrders: []model.SponsorOrder{{
			Id: "sponsor-1", RequestKey: "sponsor-request-1", UserId: 42, EntryId: 7,
			AmountCny: 10, QuotaAmount: 5_000_000, Status: model.LeaderboardOrderCompleted,
			CreatedAt: 200, UpdatedAt: 200, CompletedAt: 200,
		}},
		RenameCardBalances: []model.RenameCardBalance{{UserId: 42, Balance: 3, UpdatedAt: 0}},
		PostpaidGrants: []sourcePostpaidGrant{{
			Id: "grant-1", RequestKey: "grant-request-1", UserId: 42, EntryId: 7,
			TierKey: "bronze", TierName: "青铜", CreditAmount: 50,
			QuotaAmount: 25_000_000, OutstandingQuota: 10_000_000,
			Status: model.QuotaLoanActive, CreatedAt: 300, UpdatedAt: 400, DueAt: 500,
		}},
		PostpaidEvents: []sourcePostpaidEvent{{
			Id: "event-1", GrantId: "grant-1", UserId: 42, EventType: "repayment",
			RedemptionId: intPointer(9), RedemptionTime: 410, QuotaAmount: 15_000_000,
			OutstandingBefore: 25_000_000, OutstandingAfter: 10_000_000,
			Status: model.LeaderboardOrderCompleted, CreatedAt: 420, UpdatedAt: 430,
		}},
		ExcludedUserIds: []int{42},
		RechargeCampaigns: []model.RechargeLotteryCampaign{{
			Id: "permanent-red-moon", Name: "赤月回响", Status: model.RechargeLotteryCampaignPublished,
			StartsAt: 1, EndsAt: 4_102_444_800, RulesVersion: 1, IsPermanent: true, IsDefault: true,
		}},
		RechargePrizes: []model.RechargeLotteryPrize{{
			Id: 1, CampaignId: "permanent-red-moon", AmountUsd: 1, Weight: 60, Rarity: "common",
		}},
		RechargeLedger: []model.RechargeLotteryLedger{{
			Id: "grant-42", CampaignId: "permanent-red-moon", UserId: 42,
			Kind: "grant", Delta: 2, ReferenceId: "migration-test", CreatedAt: 500,
		}},
		RechargeProgress: []model.RechargeLotteryRedemptionProgress{{
			UserId: 42, CampaignId: "permanent-red-moon", ObservedQuota: 50_000_000,
			RedemptionCount: 1, GrantedDraws: 1, UpdatedAt: 500,
		}},
	}

	require.NoError(t, importMigrationBundle(target, bundle, "cutover-test", "sha256:test", 1_000))

	var user model.User
	require.NoError(t, target.First(&user, 42).Error)
	assert.Equal(t, 12345, user.Quota)

	var entry model.LeaderboardEntry
	require.NoError(t, target.Where("user_id = ?", 42).First(&entry).Error)
	assert.Equal(t, 31, entry.Id)
	assert.Equal(t, "Alice Board", entry.DisplayName)
	assert.True(t, entry.IsNamePublic)

	var sponsor model.SponsorOrder
	require.NoError(t, target.First(&sponsor, "id = ?", "sponsor-1").Error)
	assert.Equal(t, 31, sponsor.EntryId)

	var balance model.RenameCardBalance
	require.NoError(t, target.First(&balance, "user_id = ?", 42).Error)
	assert.Equal(t, 3, balance.Balance)
	assert.EqualValues(t, 0, balance.UpdatedAt)

	var loan model.QuotaLoan
	require.NoError(t, target.First(&loan, "id = ?", "grant-1").Error)
	assert.Equal(t, 31, loan.EntryId)
	assert.Equal(t, 10_000_000, loan.OutstandingQuota)

	var event model.QuotaLoanEvent
	require.NoError(t, target.First(&event, "id = ?", "event-1").Error)
	assert.Equal(t, "redemption", event.SourceType)
	assert.Equal(t, "9", event.SourceId)
	assert.EqualValues(t, 410, event.RedemptionTime)
	assert.EqualValues(t, 430, event.UpdatedAt)

	var excluded model.LeaderboardExcludedUser
	require.NoError(t, target.First(&excluded, "user_id = ?", 42).Error)
	assert.EqualValues(t, 1_000, excluded.CreatedAt)

	var rechargeProgress model.RechargeLotteryRedemptionProgress
	require.NoError(t, target.First(&rechargeProgress, "user_id = ?", 42).Error)
	assert.EqualValues(t, 50_000_000, rechargeProgress.ObservedQuota)
	assert.Equal(t, 1, rechargeProgress.GrantedDraws)
	var rechargeBalance struct{ Balance int64 }
	require.NoError(t, target.Model(&model.RechargeLotteryLedger{}).
		Select("COALESCE(SUM(delta), 0) AS balance").Where("user_id = ?", 42).Scan(&rechargeBalance).Error)
	assert.EqualValues(t, 2, rechargeBalance.Balance)

	done, err := migrationAlreadyCompleted(target, "cutover-test", "sha256:test", 1_000)
	require.NoError(t, err)
	assert.True(t, done)
}

func intPointer(value int) *int {
	return &value
}

func TestParseExcludedUserIds(t *testing.T) {
	ids, err := parseExcludedUserIds("5, 2 5\n1")
	require.NoError(t, err)
	assert.Equal(t, []int{1, 2, 5}, ids)

	_, err = parseExcludedUserIds("1,invalid")
	assert.Error(t, err)
}

func TestValidateMigrationBundleRejectsProcessingRows(t *testing.T) {
	err := validateMigrationBundle(migrationBundle{
		PostpaidGrants: []sourcePostpaidGrant{{Id: "pending", Status: model.LeaderboardOrderProcessing}},
	})
	assert.ErrorContains(t, err, "postpaid_grants/pending")
}

func TestReadMigrationBundleFromReadOnlySQLite(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "leaderboard.db")
	source, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, source.AutoMigrate(
		&model.LeaderboardEntry{}, &model.SponsorOrder{}, &model.RenameCardBalance{},
		&model.RenameEvent{}, &model.RenameCardOrder{}, &model.LotteryDraw{},
		&model.LotteryPeriod{}, &model.LotteryOpportunity{}, &sourcePostpaidGrant{},
		&sourcePostpaidEvent{}, &sourceAppSetting{},
		&model.RechargeLotteryCampaign{}, &model.RechargeLotteryPrize{},
		&model.RechargeLotteryGrantBatch{}, &model.RechargeLotteryLedger{},
		&model.RechargeLotteryDrawBatch{}, &model.RechargeLotteryDrawItem{},
		&model.RechargeLotteryPlanMapping{}, &model.RechargeLotteryRedemptionProgress{},
	))
	require.NoError(t, source.Create(&model.LeaderboardEntry{
		Id: 7, UserId: 42, Username: "alice", SourceName: "Alice",
		DisplayName: "Alice", AnonymousName: "Anonymous Alice",
		CreatedAt: 1, Active: true, Participating: true,
	}).Error)
	require.NoError(t, source.Create(&sourceAppSetting{
		Key: "excluded_user_ids", Value: "[42]",
	}).Error)
	sourceSQL, err := source.DB()
	require.NoError(t, err)
	require.NoError(t, sourceSQL.Close())

	sourceURL := &url.URL{Scheme: "file", Path: databasePath, RawQuery: "mode=ro&_busy_timeout=5000"}
	readOnly, err := gorm.Open(sqlite.Open(sourceURL.String()), &gorm.Config{})
	require.NoError(t, err)
	bundle, err := readMigrationBundle(readOnly)
	require.NoError(t, err)
	require.Len(t, bundle.Entries, 1)
	assert.Equal(t, 42, bundle.Entries[0].UserId)
	assert.True(t, bundle.ExcludedUsersStored)
	assert.Equal(t, []int{42}, bundle.ExcludedUserIds)
}
