package openai

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamResponseModelInConsumeLog(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	chat := `{"id":"chatcmpl-1","model":"gpt-returned","choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`
	responses := `{"id":"resp-1","model":"gpt-returned","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}],"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}`
	// The last usage event deliberately omits model: it must not erase the first event's model.
	chatStream := "data: {\"id\":\"chatcmpl-1\",\"model\":\"gpt-returned\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hello\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3,\"total_tokens\":5}}\n\ndata: [DONE]\n\n"
	responseStream := "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp-1\",\"model\":\"gpt-returned\"}}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-1\",\"status\":\"completed\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3,\"total_tokens\":5}}}\n\ndata: [DONE]\n\n"
	for _, tc := range []struct {
		name, body string
		stream     bool
		format     types.RelayFormat
		handler    func(*gin.Context, *relaycommon.RelayInfo, *http.Response) (*dto.Usage, *types.NewAPIError)
	}{
		{"chat", chat, false, types.RelayFormatOpenAI, OpenaiHandler},
		{"chat stream", chatStream, true, types.RelayFormatOpenAI, OaiStreamHandler},
		{"responses", responses, false, types.RelayFormatOpenAIResponses, OaiResponsesHandler},
		{"responses stream", responseStream, true, types.RelayFormatOpenAIResponses, OaiResponsesStreamHandler},
		{"responses to chat", responses, false, types.RelayFormatOpenAI, OaiResponsesToChatHandler},
		{"responses to chat stream", responseStream, true, types.RelayFormatOpenAI, OaiResponsesToChatStreamHandler},
		{"responses buffered", responseStream, true, types.RelayFormatOpenAI, OaiResponsesToChatBufferedStreamHandler},
		{"chat to responses", chat, false, types.RelayFormatOpenAIResponses, OaiChatToResponsesHandler},
		{"chat to responses stream", chatStream, true, types.RelayFormatOpenAIResponses, OaiChatToResponsesStreamHandler},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _, resp, info := newResponsesChatTestContext(t, tc.body, tc.stream)
			info.OriginModelName = "gpt-requested"
			info.UpstreamModelName = "gpt-mapped"
			info.IsModelMapped = true
			info.RelayMode = relayconstant.RelayModeChatCompletions
			info.RelayFormat = tc.format
			usage, apiErr := tc.handler(c, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, "gpt-returned", info.ResponseModelName)
			assert.Equal(t, "gpt-requested", info.OriginModelName)
			assert.Equal(t, "gpt-mapped", info.UpstreamModelName)
			other := service.GenerateTextOtherInfo(c, info, 1, 1, 1, 0, 1, 0, 1)
			assert.Equal(t, "gpt-returned", other["response_model_name"])
			assert.Equal(t, "gpt-mapped", other["upstream_model_name"])
		})
	}
}

func TestMissingResponseModelIsNotInferredFromRequest(t *testing.T) {
	c, _, resp, info := newResponsesChatTestContext(t, `{"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`, false)
	_, apiErr := OpenaiHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Empty(t, info.ResponseModelName)
	other := service.GenerateTextOtherInfo(c, info, 1, 1, 1, 0, 1, 0, 1)
	assert.NotContains(t, other, "response_model_name")
}

func TestChannelRetryClearsPreviousResponseModel(t *testing.T) {
	c, _, _, info := newResponsesChatTestContext(t, "", false)
	info.RecordResponseModel("gpt-previous")
	info.InitChannelMeta(c)
	assert.Empty(t, info.ResponseModelName)
}
