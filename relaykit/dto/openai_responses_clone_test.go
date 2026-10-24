package dto

import (
	"encoding/json"
	"github.com/QuantumNous/new-api/relaykit/relayconvert/kitutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"reflect"
	"testing"
)

func TestResponsesClonePreservesValuesAndIsolatesAttempts(t *testing.T) {
	const body = `{"model":"qwen-test","input":[{"role":"user","content":"history"}],"include":["reasoning.encrypted_content"],"conversation":"c1","context_management":[],"instructions":"system","max_output_tokens":0,"top_logprobs":0,"metadata":{"id":"m1"},"moderation":{},"parallel_tool_calls":false,"previous_response_id":"r1","reasoning":{"effort":"high","summary":"auto","mode":"test","context":{"id":1}},"service_tier":"default","store":false,"prompt_cache_key":"key","prompt_cache_options":{},"prompt_cache_retention":"24h","safety_identifier":"s1","stream":false,"stream_options":{"include_usage":true,"include_obfuscation":true},"temperature":0,"text":{},"tool_choice":"auto","tools":[{"type":"function","name":"lookup"}],"top_p":0,"truncation":"auto","user":"u1","max_tool_calls":0,"prompt":{},"client_metadata":{},"enable_thinking":false,"thinking_budget":0,"preset":"test"}`
	var original, expected OpenAIResponsesRequest
	require.NoError(t, kitutil.Unmarshal([]byte(body), &original))
	require.NoError(t, kitutil.Unmarshal([]byte(body), &expected))
	clone := original.Clone()
	require.NotNil(t, clone)
	require.Equal(t, &expected, clone)
	// Each attempt may mutate raw JSON without corrupting the next retry.
	fields := reflect.ValueOf(clone).Elem()
	rawType := reflect.TypeOf(json.RawMessage(nil))
	for i := 0; i < fields.NumField(); i++ {
		field := fields.Field(i)
		if field.Type() == rawType {
			require.Positive(t, field.Len(), fields.Type().Field(i).Name)
			field.Index(0).SetUint('!')
		}
	}
	clone.Model = "mapped-model"
	*clone.MaxOutputTokens = 1
	*clone.TopLogProbs = 1
	*clone.Stream = true
	*clone.Temperature = 1
	*clone.TopP = 1
	*clone.MaxToolCalls = 1
	clone.Reasoning.Effort = "low"
	clone.Reasoning.Summary = "detailed"
	clone.Reasoning.Mode[0] = '!'
	clone.Reasoning.Context[0] = '!'
	clone.StreamOptions.IncludeUsage = false
	clone.StreamOptions.IncludeObfuscation = false
	assert.Equal(t, expected, original)
	assert.Equal(t, &expected, original.Clone(), "a retry must start from the client request")
}

func TestResponsesClonePreservesAbsentAndEmptyFields(t *testing.T) {
	var absent *OpenAIResponsesRequest
	assert.Nil(t, absent.Clone())
	empty := &OpenAIResponsesRequest{Model: "test", Input: json.RawMessage{}}
	cloned := empty.Clone()
	require.NotNil(t, cloned)
	assert.Equal(t, empty, cloned)
	assert.NotNil(t, cloned.Input)
	assert.Nil(t, cloned.Tools)
	assert.Nil(t, cloned.Reasoning)
	assert.Nil(t, cloned.StreamOptions)
	assert.Nil(t, cloned.MaxOutputTokens)
	assert.Nil(t, cloned.Stream)
	assert.Nil(t, cloned.Temperature)
}

func TestResponsesClonePreservesExplicitZeroOnWire(t *testing.T) {
	const body = `{"model":"test","max_output_tokens":0,"top_logprobs":0,"stream":false,"temperature":0,"top_p":0,"max_tool_calls":0,"store":false,"parallel_tool_calls":false}`
	var original OpenAIResponsesRequest
	require.NoError(t, kitutil.Unmarshal([]byte(body), &original))
	encoded, err := kitutil.Marshal(original.Clone())
	require.NoError(t, err)
	assert.JSONEq(t, body, string(encoded))
}
