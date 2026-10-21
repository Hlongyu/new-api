package rank

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCalculateRecordsFirstChallengerDayAfterPromotionCompletes(t *testing.T) {
	start := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	scores := []DailyScore{{Day: "2026-01-01", TokenScore: 100_000}}
	// The eight promotion series require 21 active days after the entry day.
	for day := 1; day <= 21; day++ {
		scores = append(scores, DailyScore{Day: start.AddDate(0, 0, day).Format(dayLayout), TokenScore: 20})
	}
	before := Calculate(scores, "2026-01-21")
	assert.Equal(t, "grandmaster", before.TierKey)
	assert.Empty(t, before.ChallengerReachedOn)
	reached := Calculate(scores, "2026-01-22")
	assert.Equal(t, "challenger", reached.TierKey)
	assert.Equal(t, "2026-01-22", reached.ChallengerReachedOn)
	scores = append(scores, DailyScore{Day: "2026-02-01", SponsorScore: 1_000})
	later := Calculate(scores, "2026-02-01")
	assert.Equal(t, "2026-01-22", later.ChallengerReachedOn)
}

func TestCalculateCombinesDailyScoreSources(t *testing.T) {
	progress := Calculate([]DailyScore{{
		Day: "2026-07-18", TokenScore: 9, RenameScore: 4, SponsorScore: 5,
	}}, "2026-07-18")

	assert.EqualValues(t, 9, progress.TokenScore)
	assert.EqualValues(t, 4, progress.RenameScore)
	assert.EqualValues(t, 5, progress.SponsorScore)
	assert.EqualValues(t, 18, progress.TotalScore)
	assert.Equal(t, "坚韧黑铁 IV", progress.Label)
	assert.EqualValues(t, 18, progress.Score)
}

func TestCalculateAdvancesDivisionsBeforePromotion(t *testing.T) {
	progress := Calculate([]DailyScore{{Day: "2026-07-18", TokenScore: 45}}, "2026-07-18")

	assert.Equal(t, "坚韧黑铁 II", progress.Label)
	assert.EqualValues(t, 5, progress.Score)
	assert.Nil(t, progress.Promotion)
}

func TestCalculatePromotionStartsWithoutCountingEntryDay(t *testing.T) {
	progress := Calculate([]DailyScore{{Day: "2026-07-18", TokenScore: 80}}, "2026-07-18")

	require.NotNil(t, progress.Promotion)
	assert.Equal(t, "坚韧黑铁 I", progress.Label)
	assert.Equal(t, 0, progress.Promotion.CheckedDays)
	assert.False(t, progress.Promotion.TodayCounts)
}

func TestCalculatePromotionSucceedsOnFinalDay(t *testing.T) {
	progress := Calculate([]DailyScore{
		{Day: "2026-07-18", TokenScore: 80},
		{Day: "2026-07-21", TokenScore: 5},
	}, "2026-07-21")

	assert.Equal(t, "英勇青铜 IV", progress.Label)
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

	assert.Equal(t, "坚韧黑铁 I", progress.Label)
	assert.EqualValues(t, 10, progress.Score)
	assert.EqualValues(t, 0, progress.PendingScore)
	assert.Nil(t, progress.Promotion)
}

func TestTierKeysUseMajorRankOrder(t *testing.T) {
	position, ok := ParseTierKey("gold")
	require.True(t, ok)
	assert.Equal(t, 3, position)

	_, ok = ParseTierKey("gold:II")
	assert.False(t, ok)
	_, ok = ParseTierKey("unknown")
	assert.False(t, ok)
}
