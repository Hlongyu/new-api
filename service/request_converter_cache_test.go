package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChatResponsesSessionCachePriority(t *testing.T) {
	gin.SetMode(gin.TestMode)
	converters := []struct {
		name    string
		convert func(*gin.Context, *dto.GeneralOpenAIRequest) (*relayconvert.RequestResult, error)
	}{
		{"target", func(c *gin.Context, r *dto.GeneralOpenAIRequest) (*relayconvert.RequestResult, error) {
			return ConvertRequest(c, nil, types.RelayFormatOpenAIResponses, r)
		}},
		{"advanced custom", func(c *gin.Context, r *dto.GeneralOpenAIRequest) (*relayconvert.RequestResult, error) {
			return ConvertRequestByID(c, nil, relayconvert.ConverterOpenAIChatToOpenAIResponses, r)
		}},
		{"global policy", func(c *gin.Context, r *dto.GeneralOpenAIRequest) (*relayconvert.RequestResult, error) {
			return ConvertRequestVia(c, nil, r, types.RelayFormatOpenAI, types.RelayFormatOpenAIResponses)
		}},
	}
	cases := []struct{ name, session, conversation, body, want string }{
		{"session wins", " session-1 ", "conversation-1", "body-1", "session-1"},
		{"conversation fallback", "  ", " conversation-1 ", "body-1", "conversation-1"},
		{"body fallback", "", "", "body-1", "body-1"},
		{"blank headers preserve body", " ", " ", "body-1", "body-1"},
		{"content fallback", "", "", "", ""},
		{"escaped header", "session-\"quoted\"\\path", "", "", "session-\"quoted\"\\path"},
	}
	for _, converter := range converters {
		for _, tt := range cases {
			t.Run(converter.name+"/"+tt.name, func(t *testing.T) {
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
				c.Request.Header.Set("session_id", tt.session)
				c.Request.Header.Set("conversation_id", tt.conversation)
				request := &dto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []dto.Message{{Role: "user", Content: "hello"}}, PromptCacheKey: tt.body}
				result, err := converter.convert(c, request)
				require.NoError(t, err)
				response, ok := result.Value.(*dto.OpenAIResponsesRequest)
				require.True(t, ok)
				var got string
				require.NoError(t, common.Unmarshal(response.PromptCacheKey, &got))
				if tt.want == "" {
					assert.Regexp(t, `^newapi_cc_v1_[0-9a-f]{64}$`, got)
				} else {
					assert.Equal(t, tt.want, got)
				}
				assert.Equal(t, tt.body, request.PromptCacheKey, "headers must not modify the client request or retry input")
			})
		}
	}
}

func TestSessionCacheDoesNotOverrideNativeResponses(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/responses", nil)
	c.Request.Header.Set("session_id", "session")
	request := &dto.OpenAIResponsesRequest{Model: "gpt-test", PromptCacheKey: []byte(`"native"`)}
	result, err := ConvertRequest(c, nil, types.RelayFormatOpenAIResponses, request)
	require.NoError(t, err)
	got, ok := result.Value.(*dto.OpenAIResponsesRequest)
	require.True(t, ok)
	assert.Equal(t, `"native"`, string(got.PromptCacheKey))
	result, err = ConvertRequest(nil, nil, types.RelayFormatOpenAIResponses, &dto.GeneralOpenAIRequest{Model: "gpt-test", PromptCacheKey: "body"})
	require.NoError(t, err)
	got, ok = result.Value.(*dto.OpenAIResponsesRequest)
	require.True(t, ok)
	assert.Equal(t, `"body"`, string(got.PromptCacheKey))
}
