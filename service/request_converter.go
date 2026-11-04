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
	"github.com/google/uuid"
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
	return applyChatResponsesSessionCacheKey(c, info, result)
}

func ConvertRequestByID(c *gin.Context, info *relaycommon.RelayInfo, converter string, request any) (*relayconvert.RequestResult, error) {
	result, err := relayconvert.ConvertRequestByID(c, info, converter, request)
	if err != nil {
		return nil, err
	}
	return applyChatResponsesSessionCacheKey(c, info, result)
}

func ConvertRequestVia(c *gin.Context, info *relaycommon.RelayInfo, request any, path ...types.RelayFormat) (*relayconvert.RequestResult, error) {
	result, err := relayconvert.ConvertRequestVia(c, info, request, path...)
	if err != nil {
		return nil, err
	}
	return applyChatResponsesSessionCacheKey(c, info, result)
}

// Session headers take precedence only on the Chat-to-Responses bridge. Keep
// HTTP policy in the host so relaykit stays independent of Gin and requests.
func applyChatResponsesSessionCacheKey(c *gin.Context, info *relaycommon.RelayInfo, result *relayconvert.RequestResult) (*relayconvert.RequestResult, error) {
	if c == nil || c.Request == nil || result == nil || result.From != types.RelayFormatOpenAI || result.To != types.RelayFormatOpenAIResponses {
		return result, nil
	}
	key := strings.TrimSpace(c.GetHeader("session_id"))
	if key == "" {
		key = strings.TrimSpace(c.GetHeader("conversation_id"))
	}
	request, ok := result.Value.(*dto.OpenAIResponsesRequest)
	if !ok || request == nil {
		return result, nil
	}
	if key != "" {
		encoded, err := common.Marshal(key)
		if err != nil {
			return nil, fmt.Errorf("marshal session prompt_cache_key: %w", err)
		}
		request.PromptCacheKey = encoded
	} else if len(request.PromptCacheKey) > 0 {
		if err := common.Unmarshal(request.PromptCacheKey, &key); err != nil {
			return nil, fmt.Errorf("decode session prompt_cache_key: %w", err)
		}
	}
	// xxgate binds accounts using session headers, not prompt_cache_key.
	// Scope the session to the authenticated caller and token even when different
	// users supply the same client key or identical conversation prefixes.
	if info != nil && info.UserId > 0 && key != "" {
		seed, err := common.Marshal(struct {
			UserID  int    `json:"user_id"`
			TokenID int    `json:"token_id"`
			Key     string `json:"key"`
		}{info.UserId, info.TokenId, key})
		if err != nil {
			return nil, fmt.Errorf("derive upstream session: %w", err)
		}
		// Use a stable RFC 4122 UUID v5, as the xxgate identity mapper does.
		// The namespace separates this caller-scoped mapping from other UUID uses.
		namespace := uuid.NewSHA1(uuid.NameSpaceURL, []byte("https://github.com/QuantumNous/new-api/chat-responses-session/v1"))
		info.ChatResponsesSessionID = uuid.NewSHA1(namespace, seed).String()
	}
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
