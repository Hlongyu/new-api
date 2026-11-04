package channel_test

import (
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatResponsesOutboundSessionAffinity(t *testing.T) {
	var baseline string
	cases := []struct {
		name           string
		user, token    int
		session, cache string
		wantSame       bool
	}{
		{"first", 31, 53, "client-session", "body-key", true},
		{"repeat", 31, 53, "client-session", "different-body-key", true},
		{"different user", 32, 53, "client-session", "body-key", false},
		{"different token", 31, 54, "client-session", "body-key", false},
		{"different session", 31, 53, "other-session", "body-key", false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			c.Request.Header.Set("session_id", tt.session)
			info := &relaycommon.RelayInfo{UserId: tt.user, TokenId: tt.token}
			_, err := service.ConvertRequestByID(c, info, relayconvert.ConverterOpenAIChatToOpenAIResponses, &dto.GeneralOpenAIRequest{Model: "gpt-test", PromptCacheKey: tt.cache, Messages: []dto.Message{{Role: "user", Content: "hello"}}})
			require.NoError(t, err)
			headers := http.Header{}
			channel.SetupApiRequestHeader(info, c, &headers)
			session := headers.Get("session_id")
			parsed, err := uuid.Parse(session)
			require.NoError(t, err)
			assert.Equal(t, uuid.Version(5), parsed.Version())
			assert.Equal(t, uuid.RFC4122, parsed.Variant())
			assert.Equal(t, parsed.String(), session)
			assert.Equal(t, session, headers.Get("conversation_id"))
			if baseline == "" {
				baseline = session
			}
			if tt.wantSame {
				assert.Equal(t, baseline, session)
			} else {
				assert.NotEqual(t, baseline, session)
			}
			assert.Equal(t, tt.session, c.Request.Header.Get("session_id"))
		})
	}
}

func TestChatResponsesGeneratedSessionSurvivesTurnsAndRetry(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{UserId: 31, TokenId: 53}
	req := &dto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []dto.Message{{Role: "user", Content: "first"}}}
	_, err := service.ConvertRequestVia(c, info, req, types.RelayFormatOpenAI, types.RelayFormatOpenAIResponses)
	require.NoError(t, err)
	first := info.ChatResponsesSessionID
	require.NotEmpty(t, first)
	req.Messages = append(req.Messages, dto.Message{Role: "assistant", Content: "reply"}, dto.Message{Role: "user", Content: "next"})
	info.InitChannelMeta(c)
	assert.Empty(t, info.ChatResponsesSessionID)
	headers := http.Header{}
	channel.SetupApiRequestHeader(info, c, &headers)
	assert.Empty(t, headers.Get("session_id"), "a retry on a native channel must not inherit converted affinity")
	_, err = service.ConvertRequest(c, info, types.RelayFormatOpenAIResponses, req)
	require.NoError(t, err)
	assert.Equal(t, first, info.ChatResponsesSessionID)
	headers = http.Header{}
	channel.SetupApiRequestHeader(info, c, &headers)
	assert.Equal(t, first, headers.Get("session_id"))
}
