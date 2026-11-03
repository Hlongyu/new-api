package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

func init() {
	relayconvert.SetMediaResolver(relayconvert.MediaResolver{
		// relayconvert is gin-free; recover the gin context when the caller
		// passed one so file caching/cleanup keeps working.
		GetBase64Data: func(ctx context.Context, source types.FileSource, reason ...string) (string, string, error) {
			ginCtx, _ := ctx.(*gin.Context)
			return GetBase64Data(ginCtx, source, reason...)
		},
		DecodeBase64FileData: DecodeBase64FileData,
	})
}

func ConvertRequest(c *gin.Context, info *relaycommon.RelayInfo, target types.RelayFormat, request any) (*relayconvert.RequestResult, error) {
	result, err := relayconvert.ConvertRequest(c, info, target, request)
	if err != nil {
		return nil, err
	}
	return applyChatResponsesSessionCacheKey(c, result)
}

func ConvertRequestByID(c *gin.Context, info *relaycommon.RelayInfo, converter string, request any) (*relayconvert.RequestResult, error) {
	result, err := relayconvert.ConvertRequestByID(c, info, converter, request)
	if err != nil {
		return nil, err
	}
	return applyChatResponsesSessionCacheKey(c, result)
}

func ConvertRequestVia(c *gin.Context, info *relaycommon.RelayInfo, request any, path ...types.RelayFormat) (*relayconvert.RequestResult, error) {
	result, err := relayconvert.ConvertRequestVia(c, info, request, path...)
	if err != nil {
		return nil, err
	}
	return applyChatResponsesSessionCacheKey(c, result)
}

// Session headers take precedence only on the Chat-to-Responses bridge. Keep
// HTTP policy in the host so relaykit stays independent of Gin and requests.
func applyChatResponsesSessionCacheKey(c *gin.Context, result *relayconvert.RequestResult) (*relayconvert.RequestResult, error) {
	if c == nil || c.Request == nil || result == nil || result.From != types.RelayFormatOpenAI || result.To != types.RelayFormatOpenAIResponses {
		return result, nil
	}
	key := strings.TrimSpace(c.GetHeader("session_id"))
	if key == "" {
		key = strings.TrimSpace(c.GetHeader("conversation_id"))
	}
	if key == "" {
		return result, nil
	}
	request, ok := result.Value.(*dto.OpenAIResponsesRequest)
	if !ok || request == nil {
		return result, nil
	}
	encoded, err := common.Marshal(key)
	if err != nil {
		return nil, fmt.Errorf("marshal session prompt_cache_key: %w", err)
	}
	request.PromptCacheKey = encoded
	return result, nil
}

func ClaudeToOpenAIRequest(claudeRequest dto.ClaudeRequest, info *relaycommon.RelayInfo) (*dto.GeneralOpenAIRequest, error) {
	result, err := ConvertRequest(nil, info, types.RelayFormatOpenAI, &claudeRequest)
	if err != nil {
		return nil, err
	}
	openAIRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
	if !ok {
		return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
	}
	return openAIRequest, nil
}

func GeminiToOpenAIRequest(geminiRequest *dto.GeminiChatRequest, info *relaycommon.RelayInfo) (*dto.GeneralOpenAIRequest, error) {
	result, err := ConvertRequest(nil, info, types.RelayFormatOpenAI, geminiRequest)
	if err != nil {
		return nil, err
	}
	openAIRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
	if !ok {
		return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
	}
	return openAIRequest, nil
}
