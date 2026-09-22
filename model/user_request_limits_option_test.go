package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserRequestLimitOptionValidatesAndPersistsWholePolicy(t *testing.T) {
	db := useFrontendOptionMigrationDB(t)
	previous := setting.UserRequestLimitsJSON()
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserRequestLimits(previous)); common.OptionMap = previousMap })
	raw := `{"default":{"default":{"max_concurrent":5},"key_groups":{"ds":{"rate_count":10,"rate_window_minutes":1}}}}`
	require.NoError(t, UpdateOption(setting.UserRequestLimitsOptionKey, raw))
	assert.Equal(t, raw, requireOptionValue(t, db, setting.UserRequestLimitsOptionKey))
	assert.Equal(t, raw, setting.UserRequestLimitsJSON())
	require.Error(t, UpdateOption(setting.UserRequestLimitsOptionKey, `{"default":{"default":{"max_concurrent":-1}}}`))
	assert.Equal(t, raw, requireOptionValue(t, db, setting.UserRequestLimitsOptionKey))
	// A persistence failure must not publish the replacement to running requests.
	require.NoError(t, db.Migrator().DropTable(&Option{}))
	require.Error(t, UpdateOption(setting.UserRequestLimitsOptionKey, `{}`))
	assert.Equal(t, raw, setting.UserRequestLimitsJSON())
}
