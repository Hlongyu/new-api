package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesCacheUsageSurvivesChatConversionAndSettlement(t *testing.T) {
	var response dto.OpenAIResponsesResponse
	require.NoError(t, common.Unmarshal([]byte(`{"id":"resp_test","model":"gpt-test","status":"completed","usage":{"input_tokens":30783,"output_tokens":373,"total_tokens":31156,"input_tokens_details":{"cached_tokens":30336}}}`), &response))
	_, converted, err := ResponsesResponseToChatCompletionsResponse(&response, "chat_test")
	require.NoError(t, err)
	require.NotNil(t, converted.BillingUsage)
	require.Equal(t, 30336, converted.PromptTokensDetails.CachedTokens)
	effective := effectiveBillingUsage(converted)
	assert.Equal(t, 30336, effective.PromptTokensDetails.CachedTokens)

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	const expression = `tier("base", p * 2 + c * 10 + cr * 0.1)`
	info := &relaycommon.RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		FinalRequestRelayFormat: types.RelayFormatOpenAIResponses,
		OriginModelName:         "gpt-test", StartTime: time.Now(),
		PriceData: hosttypes.PriceData{GroupRatioInfo: hosttypes.GroupRatioInfo{GroupRatio: 0.25}},
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode: "tiered_expr", ExprString: expression, ExprHash: billingexpr.ExprHashString(expression), GroupRatio: 0.25, QuotaPerUnit: 500000,
		},
	}
	summary := calculateTextQuotaSummary(ctx, info, effective)
	assert.Equal(t, 30336, summary.CacheTokens, "consume log must retain upstream cache usage")
	params := BuildTieredTokenParams(effective, summary.IsClaudeUsageSemantic, billingexpr.UsedVars(expression))
	assert.Equal(t, float64(447), params.P)
	assert.Equal(t, float64(30336), params.CR)
	ok, quota, result := TryTieredSettle(info, params)
	require.True(t, ok)
	require.NotNil(t, result)
	assert.Equal(t, 957, quota, "cache reads must use the cache price instead of the full input price")
	assert.Equal(t, 0, response.Usage.PromptTokensDetails.CachedTokens, "normalization must not mutate the original response")
}

func TestOpenAIBillingUsageFillsMissingInputDetails(t *testing.T) {
	prompt := dto.InputTokenDetails{CachedTokens: 99}
	details := dto.InputTokenDetails{CachedTokens: 100, CachedCreationTokens: 20, CacheWriteTokens: 30, TextTokens: 40, AudioTokens: 50, ImageTokens: 60}
	merged := details
	merged.CachedTokens = prompt.CachedTokens
	tests := []struct {
		name, source string
		input        *dto.InputTokenDetails
		want         dto.InputTokenDetails
	}{
		{"responses details", dto.BillingUsageSourceOAIResponses, &details, merged},
		{"responses explicit zeros", dto.BillingUsageSourceOAIResponses, &dto.InputTokenDetails{}, prompt},
		{"responses absent details", dto.BillingUsageSourceOAIResponses, nil, prompt},
		{"chat keeps native details", dto.BillingUsageSourceOAIChat, &details, merged},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			usage := &dto.Usage{BillingUsage: &dto.BillingUsage{Source: tt.source, Semantic: dto.BillingUsageSemanticOpenAI, OpenAIUsage: &dto.Usage{InputTokens: 1000, OutputTokens: 10, InputTokensDetails: tt.input, PromptTokensDetails: prompt}}}
			got := effectiveBillingUsage(usage)
			require.NotNil(t, got)
			assert.Equal(t, tt.want, got.PromptTokensDetails)
			assert.Equal(t, 1000, got.PromptTokens)
			assert.Equal(t, 10, got.CompletionTokens)
			assert.Equal(t, prompt, usage.BillingUsage.OpenAIUsage.PromptTokensDetails)
		})
	}
}

func TestOpenAIBillingUsageLegacyCacheFallback(t *testing.T) {
	for _, source := range []string{dto.BillingUsageSourceOAIChat, dto.BillingUsageSourceOAIResponses} {
		t.Run(source, func(t *testing.T) {
			raw := &dto.Usage{InputTokens: 1000, PromptCacheHitTokens: 800}
			usage := &dto.Usage{BillingUsage: &dto.BillingUsage{Source: source, Semantic: dto.BillingUsageSemanticOpenAI, OpenAIUsage: raw}}
			assert.Equal(t, 800, effectiveBillingUsage(usage).PromptTokensDetails.CachedTokens)
			raw.InputTokensDetails = &dto.InputTokenDetails{CachedTokens: 700}
			assert.Equal(t, 700, effectiveBillingUsage(usage).PromptTokensDetails.CachedTokens)
			raw.PromptTokensDetails.CachedTokens = 600
			assert.Equal(t, 600, effectiveBillingUsage(usage).PromptTokensDetails.CachedTokens)
		})
	}
}

func TestOpenAIBillingUsageEmptySnapshotFallsBack(t *testing.T) {
	for _, details := range []*dto.InputTokenDetails{nil, {}} {
		usage := &dto.Usage{PromptTokens: 1000, CompletionTokens: 10, PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 800}, BillingUsage: &dto.BillingUsage{Source: dto.BillingUsageSourceOAIResponses, Semantic: dto.BillingUsageSemanticOpenAI, OpenAIUsage: &dto.Usage{InputTokensDetails: details}}}
		got := effectiveBillingUsage(usage)
		assert.Equal(t, 1000, got.PromptTokens)
		assert.Equal(t, 10, got.CompletionTokens)
		assert.Equal(t, 800, got.PromptTokensDetails.CachedTokens)
	}
}

func TestResponsesPartialStreamKeepsCacheForClientAndSettlement(t *testing.T) {
	state := relayconvert.NewResponsesToChatStreamState("gpt-test", true)
	first := &dto.Usage{InputTokens: 30783, InputTokensDetails: &dto.InputTokenDetails{CachedTokens: 30336}}
	_, err := relayconvert.ResponsesStreamEventToChatChunks(&dto.ResponsesStreamResponse{Type: "response.created", Response: &dto.OpenAIResponsesResponse{Usage: first}}, state)
	require.NoError(t, err)
	last := &dto.Usage{InputTokens: 30783, OutputTokens: 373, TotalTokens: 31156}
	chunks, err := relayconvert.ResponsesStreamEventToChatChunks(&dto.ResponsesStreamResponse{Type: "response.completed", Response: &dto.OpenAIResponsesResponse{Usage: last}}, state)
	require.NoError(t, err)
	var clientUsage *dto.Usage
	for _, chunk := range chunks {
		if chunk.Usage != nil {
			clientUsage = chunk.Usage
		}
	}
	require.NotNil(t, clientUsage)
	assert.Equal(t, 30336, clientUsage.PromptTokensDetails.CachedTokens)
	effective := effectiveBillingUsage(state.Usage)
	assert.Equal(t, 30336, effective.PromptTokensDetails.CachedTokens)
	assert.Equal(t, 373, effective.CompletionTokens)
	const expression = `tier("base", p * 2 + c * 10 + cr * 0.1)`
	params := BuildTieredTokenParams(effective, false, billingexpr.UsedVars(expression))
	info := &relaycommon.RelayInfo{TieredBillingSnapshot: &billingexpr.BillingSnapshot{BillingMode: "tiered_expr", ExprString: expression, ExprHash: billingexpr.ExprHashString(expression), GroupRatio: .25, QuotaPerUnit: 500000}}
	ok, quota, result := TryTieredSettle(info, params)
	require.True(t, ok)
	require.NotNil(t, result)
	assert.Equal(t, 957, quota)
	require.NotNil(t, state.Usage.BillingUsage.OpenAIUsage.InputTokensDetails)
	state.Usage.BillingUsage.OpenAIUsage.InputTokensDetails.CachedTokens = 1
	assert.Equal(t, 30336, first.InputTokensDetails.CachedTokens, "stream merging must not mutate original usage snapshots")
	assert.Nil(t, last.InputTokensDetails)
}
