package dto

import (
	"reflect"
	"strings"
)

// MergeUsageNonZero retains earlier non-zero counts when a later stream event
// omits them. OpenAI billing snapshots are merged independently of client usage.
func MergeUsageNonZero(current *Usage, incoming *Usage) *Usage {
	if current == nil {
		current = &Usage{}
	}
	if incoming == nil {
		return current
	}

	if incoming.PromptTokens > 0 {
		current.PromptTokens = incoming.PromptTokens
	}
	if incoming.CompletionTokens > 0 {
		current.CompletionTokens = incoming.CompletionTokens
	}
	if incoming.TotalTokens > 0 {
		current.TotalTokens = incoming.TotalTokens
	}
	if incoming.PromptCacheHitTokens > 0 {
		current.PromptCacheHitTokens = incoming.PromptCacheHitTokens
	}
	if incoming.InputTokens > 0 {
		current.InputTokens = incoming.InputTokens
	}
	if incoming.OutputTokens > 0 {
		current.OutputTokens = incoming.OutputTokens
	}
	if incoming.ClaudeCacheCreation5mTokens > 0 {
		current.ClaudeCacheCreation5mTokens = incoming.ClaudeCacheCreation5mTokens
	}
	if incoming.ClaudeCacheCreation1hTokens > 0 {
		current.ClaudeCacheCreation1hTokens = incoming.ClaudeCacheCreation1hTokens
	}

	mergeInputTokenDetails(&current.PromptTokensDetails, incoming.PromptTokensDetails)
	if incoming.InputTokensDetails != nil {
		details := *incoming.InputTokensDetails
		if details.CachedTokens > 0 ||
			details.CachedCreationTokens > 0 ||
			details.CacheWriteTokens > 0 ||
			details.TextTokens > 0 ||
			details.AudioTokens > 0 ||
			details.ImageTokens > 0 {
			if current.InputTokensDetails == nil {
				current.InputTokensDetails = &InputTokenDetails{}
			}
			mergeInputTokenDetails(current.InputTokensDetails, details)
		}
	}

	if incoming.CompletionTokenDetails.TextTokens > 0 {
		current.CompletionTokenDetails.TextTokens = incoming.CompletionTokenDetails.TextTokens
	}
	if incoming.CompletionTokenDetails.AudioTokens > 0 {
		current.CompletionTokenDetails.AudioTokens = incoming.CompletionTokenDetails.AudioTokens
	}
	if incoming.CompletionTokenDetails.ImageTokens > 0 {
		current.CompletionTokenDetails.ImageTokens = incoming.CompletionTokenDetails.ImageTokens
	}
	if incoming.CompletionTokenDetails.ReasoningTokens > 0 {
		current.CompletionTokenDetails.ReasoningTokens = incoming.CompletionTokenDetails.ReasoningTokens
	}

	if incoming.UsageSemantic != "" {
		current.UsageSemantic = incoming.UsageSemantic
	}
	if incoming.UsageSource != "" {
		current.UsageSource = incoming.UsageSource
	}
	if incoming.BillingUsage != nil {
		snapshot := CloneBillingUsage(incoming.BillingUsage)
		if previous := current.BillingUsage; previous != nil {
			snapshot.Estimated = previous.Estimated || snapshot.Estimated
			if previous.OpenAIUsage != nil && snapshot.OpenAIUsage != nil &&
				strings.EqualFold(previous.Source, snapshot.Source) &&
				strings.EqualFold(previous.Semantic, snapshot.Semantic) {
				snapshot.OpenAIUsage = MergeUsageNonZero(cloneOpenAIUsage(previous.OpenAIUsage), snapshot.OpenAIUsage)
			}
		}
		current.BillingUsage = snapshot
	}
	if incoming.Cost != nil && !reflect.ValueOf(incoming.Cost).IsZero() {
		current.Cost = incoming.Cost
	}
	if total := current.PromptTokens + current.CompletionTokens; total > current.TotalTokens {
		current.TotalTokens = total
	}
	if total := current.InputTokens + current.OutputTokens; total > current.TotalTokens {
		current.TotalTokens = total
	}

	return current
}

func mergeInputTokenDetails(current *InputTokenDetails, incoming InputTokenDetails) {
	if incoming.CachedTokens > 0 {
		current.CachedTokens = incoming.CachedTokens
	}
	if incoming.CachedCreationTokens > 0 {
		current.CachedCreationTokens = incoming.CachedCreationTokens
	}
	if incoming.CacheWriteTokens > 0 {
		current.CacheWriteTokens = incoming.CacheWriteTokens
	}
	if incoming.TextTokens > 0 {
		current.TextTokens = incoming.TextTokens
	}
	if incoming.AudioTokens > 0 {
		current.AudioTokens = incoming.AudioTokens
	}
	if incoming.ImageTokens > 0 {
		current.ImageTokens = incoming.ImageTokens
	}
}
