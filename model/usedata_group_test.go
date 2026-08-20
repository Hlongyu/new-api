package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestGetGroupQuotaDataAggregatesMetricsAndScopesByRole(t *testing.T) {
	truncateTables(t)

	rows := []QuotaData{
		{
			UserID: 1, Username: "alice", UseGroup: "vip", CreatedAt: 1000,
			Count: 2, InputTokens: 100, OutputTokens: 20, CacheReadTokens: 40, Quota: 200,
		},
		{
			UserID: 1, Username: "alice", UseGroup: "vip", CreatedAt: 1100,
			Count: 1, InputTokens: 50, OutputTokens: 10, CacheReadTokens: 20, Quota: 100,
		},
		{
			UserID: 2, Username: "bob", UseGroup: "default", CreatedAt: 1200,
			Count: 3, InputTokens: 80, OutputTokens: 40, CacheReadTokens: 8, Quota: 150,
		},
		{
			UserID: 2, Username: "bob", UseGroup: "", CreatedAt: 1300,
			Count: 9, InputTokens: 900, OutputTokens: 900, CacheReadTokens: 900, Quota: 900,
		},
	}
	for _, row := range rows {
		require.NoError(t, DB.Create(&row).Error)
	}

	adminRows, err := GetGroupQuotaData(900, 2000, "", 0, common.RoleAdminUser)
	require.NoError(t, err)
	require.Equal(t, []*GroupQuotaData{
		{UseGroup: "vip", Count: 3, InputTokens: 150, OutputTokens: 30, CacheReadTokens: 60, Quota: 300},
		{UseGroup: "default", Count: 3, InputTokens: 80, OutputTokens: 40, CacheReadTokens: 8, Quota: 150},
	}, adminRows)

	filteredRows, err := GetGroupQuotaData(900, 2000, "alice", 0, common.RoleAdminUser)
	require.NoError(t, err)
	require.Equal(t, adminRows[:1], filteredRows)

	selfRows, err := GetGroupQuotaData(900, 2000, "", 2, common.RoleCommonUser)
	require.NoError(t, err)
	require.Equal(t, adminRows[1:], selfRows)
}
