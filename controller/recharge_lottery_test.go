package controller

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseRechargeLotteryTimestampPreservesLegacyInputs(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int64
	}{
		{name: "unix", input: `1788254500`, expected: 1_788_254_500},
		{name: "RFC3339", input: `"2026-09-01T17:00:00+08:00"`, expected: 1_788_253_200},
		{name: "local datetime", input: `"2026-09-01T09:00"`, expected: 1_788_224_400},
		{name: "date", input: `"2026-09-01"`, expected: 1_788_220_800},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual, err := parseRechargeLotteryTimestamp(json.RawMessage(test.input))
			require.NoError(t, err)
			assert.Equal(t, test.expected, actual)
		})
	}

	_, err := parseRechargeLotteryTimestamp(json.RawMessage(`"not-a-date"`))
	assert.Error(t, err)
}
