package rank

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCalculateCombinesDailyScoreSources(t *testing.T) {
	progress := Calculate([]DailyScore{{
		Day: "2026-07-18", TokenScore: 9, RenameScore: 4, SponsorScore: 5,
	}}, "2026-07-18")

	assert.EqualValues(t, 9, progress.TokenScore)
	assert.EqualValues(t, 4, progress.RenameScore)
	assert.EqualValues(t, 5, progress.SponsorScore)
	assert.EqualValues(t, 18, progress.TotalScore)
	assert.Equal(t, "黑铁 IV", progress.Label)
	assert.EqualValues(t, 18, progress.Score)
}

func TestCalculateAdvancesDivisionsBeforePromotion(t *testing.T) {
	progress := Calculate([]DailyScore{{Day: "2026-07-18", TokenScore: 45}}, "2026-07-18")

	assert.Equal(t, "黑铁 II", progress.Label)
	assert.EqualValues(t, 5, progress.Score)
	assert.Nil(t, progress.Promotion)
}

func TestCalculatePromotionStartsWithoutCountingEntryDay(t *testing.T) {
	progress := Calculate([]DailyScore{{Day: "2026-07-18", TokenScore: 80}}, "2026-07-18")

	require.NotNil(t, progress.Promotion)
	assert.Equal(t, "黑铁 I", progress.Label)
	assert.Equal(t, 0, progress.Promotion.CheckedDays)
	assert.False(t, progress.Promotion.TodayCounts)
}

func TestCalculatePromotionSucceedsOnFinalDay(t *testing.T) {
	progress := Calculate([]DailyScore{
		{Day: "2026-07-18", TokenScore: 80},
		{Day: "2026-07-21", TokenScore: 5},
	}, "2026-07-21")

	assert.Equal(t, "青铜 IV", progress.Label)
	assert.EqualValues(t, 5, progress.Score)
	assert.Nil(t, progress.Promotion)
}

func TestCalculateDoesNotFailPromotionBeforeTodayCloses(t *testing.T) {
	progress := Calculate([]DailyScore{{Day: "2026-07-18", TokenScore: 80}}, "2026-07-21")

	require.NotNil(t, progress.Promotion)
	assert.Equal(t, 3, progress.Promotion.CheckedDays)
	assert.Equal(t, 0, progress.Promotion.ActiveDays)
	assert.True(t, progress.Promotion.TodayCounts)
	assert.EqualValues(t, 5, progress.Promotion.TodayRequiredRemaining)
}

func TestCalculateFailsPromotionAfterWindowCloses(t *testing.T) {
	progress := Calculate([]DailyScore{{Day: "2026-07-18", TokenScore: 80}}, "2026-07-22")

	assert.Equal(t, "黑铁 I", progress.Label)
	assert.EqualValues(t, 10, progress.Score)
	assert.EqualValues(t, 0, progress.PendingScore)
	assert.Nil(t, progress.Promotion)
}
