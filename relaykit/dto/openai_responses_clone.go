package dto

import "bytes"

// Clone returns an independent request for an upstream attempt. Copy raw JSON in
// bulk: reflection-based slice copying visits and allocates for every byte of
// conversation history. Keep pointers isolated so adaptation cannot affect retries.
func (r *OpenAIResponsesRequest) Clone() *OpenAIResponsesRequest {
	if r == nil {
		return nil
	}
	cloned := *r
	cloned.Input = bytes.Clone(r.Input)
	cloned.Include = bytes.Clone(r.Include)
	cloned.Conversation = bytes.Clone(r.Conversation)
	cloned.ContextManagement = bytes.Clone(r.ContextManagement)
	cloned.Instructions = bytes.Clone(r.Instructions)
	cloned.Metadata = bytes.Clone(r.Metadata)
	cloned.Moderation = bytes.Clone(r.Moderation)
	cloned.ParallelToolCalls = bytes.Clone(r.ParallelToolCalls)
	cloned.Store = bytes.Clone(r.Store)
	cloned.PromptCacheKey = bytes.Clone(r.PromptCacheKey)
	cloned.PromptCacheOptions = bytes.Clone(r.PromptCacheOptions)
	cloned.PromptCacheRetention = bytes.Clone(r.PromptCacheRetention)
	cloned.SafetyIdentifier = bytes.Clone(r.SafetyIdentifier)
	cloned.Text = bytes.Clone(r.Text)
	cloned.ToolChoice = bytes.Clone(r.ToolChoice)
	cloned.Tools = bytes.Clone(r.Tools)
	cloned.Truncation = bytes.Clone(r.Truncation)
	cloned.User = bytes.Clone(r.User)
	cloned.Prompt = bytes.Clone(r.Prompt)
	cloned.ClientMetadata = bytes.Clone(r.ClientMetadata)
	cloned.EnableThinking = bytes.Clone(r.EnableThinking)
	cloned.ThinkingBudget = bytes.Clone(r.ThinkingBudget)
	cloned.Preset = bytes.Clone(r.Preset)
	if r.MaxOutputTokens != nil {
		value := *r.MaxOutputTokens
		cloned.MaxOutputTokens = &value
	}
	if r.TopLogProbs != nil {
		value := *r.TopLogProbs
		cloned.TopLogProbs = &value
	}
	if r.Stream != nil {
		value := *r.Stream
		cloned.Stream = &value
	}
	if r.Temperature != nil {
		value := *r.Temperature
		cloned.Temperature = &value
	}
	if r.TopP != nil {
		value := *r.TopP
		cloned.TopP = &value
	}
	if r.MaxToolCalls != nil {
		value := *r.MaxToolCalls
		cloned.MaxToolCalls = &value
	}
	if r.Reasoning != nil {
		reasoning := *r.Reasoning
		reasoning.Mode = bytes.Clone(r.Reasoning.Mode)
		reasoning.Context = bytes.Clone(r.Reasoning.Context)
		cloned.Reasoning = &reasoning
	}
	if r.StreamOptions != nil {
		options := *r.StreamOptions
		cloned.StreamOptions = &options
	}
	return &cloned
}
