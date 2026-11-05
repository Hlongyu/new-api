package openai

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	info.RecordResponseModel(responsesResponse.Model)

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := dto.Usage{}
	if responsesResponse.Usage != nil {
		usage.PromptTokens = responsesResponse.Usage.InputTokens
		usage.CompletionTokens = responsesResponse.Usage.OutputTokens
		usage.TotalTokens = responsesResponse.Usage.TotalTokens
		if responsesResponse.Usage.InputTokensDetails != nil {
			usage.PromptTokensDetails.CachedTokens = responsesResponse.Usage.InputTokensDetails.CachedTokens
			usage.PromptTokensDetails.CacheWriteTokens = responsesResponse.Usage.InputTokensDetails.CacheWriteTokens
		}
	}
	// Count actual tool invocations from Output (not tool declarations).
	for _, output := range responsesResponse.Output {
		switch output.Type {
		case dto.BuildInCallWebSearchCall:
			info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, output.Name)
		}
	}

	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	if !relaycommon.IsNonBillableResponsesStatus(responsesResponse.Status) {
		for i := range responsesResponse.Output {
			idx := i
			imageCounter.Observe(&responsesResponse.Output[i], &idx)
		}
	}
	imageCounter.Commit(info)

	return &usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	state := &responsesStreamUsage{}
	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		var event dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &event); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		sendResponsesStreamData(c, event, data)
		state.Observe(info, event)
	})
	return state.Usage(info), nil
}

// responsesStreamUsage keeps tool and token accounting identical across SSE
// and WebSocket transports. Each response has a fresh accumulator.
type responsesStreamUsage struct {
	usage               dto.Usage
	responseTextBuilder strings.Builder
	imageCounter        relaycommon.ImageGenerationCallCounter
	imageCommitted      bool
	authoritativeUsage  bool
}

func (state *responsesStreamUsage) Observe(info *relaycommon.RelayInfo, streamResponse dto.ResponsesStreamResponse) {
	if streamResponse.Response != nil {
		info.RecordResponseModel(streamResponse.Response.Model)
	}
	switch streamResponse.Type {
	case "response.completed", "response.done":
		if streamResponse.Response != nil {
			if streamResponse.Response.Usage != nil {
				if streamResponse.Response.Usage.InputTokens != 0 {
					state.usage.PromptTokens = streamResponse.Response.Usage.InputTokens
				}
				if streamResponse.Response.Usage.OutputTokens != 0 {
					state.usage.CompletionTokens = streamResponse.Response.Usage.OutputTokens
				}
				if streamResponse.Response.Usage.TotalTokens != 0 {
					state.usage.TotalTokens = streamResponse.Response.Usage.TotalTokens
				}
				if streamResponse.Response.Usage.InputTokensDetails != nil {
					state.usage.PromptTokensDetails.CachedTokens = streamResponse.Response.Usage.InputTokensDetails.CachedTokens
					state.usage.PromptTokensDetails.CacheWriteTokens = streamResponse.Response.Usage.InputTokensDetails.CacheWriteTokens
				}
			}
			if !state.imageCommitted {
				if relaycommon.IsNonBillableResponsesStatus(streamResponse.Response.Status) {
					state.imageCounter.Reset()
					state.imageCounter.Commit(info)
					state.imageCommitted = true
				} else {
					for i := range streamResponse.Response.Output {
						idx := i
						state.imageCounter.Observe(&streamResponse.Response.Output[i], &idx)
					}
					state.imageCounter.Commit(info)
					state.imageCommitted = true
				}
			}
		} else if !state.imageCommitted {
			state.imageCounter.Commit(info)
			state.imageCommitted = true
		}
	case "response.failed", "response.incomplete", "response.cancelled", "response.canceled":
		if !state.imageCommitted {
			state.imageCounter.Reset()
			state.imageCounter.Commit(info)
			state.imageCommitted = true
		}
	case "response.output_text.delta":
		// 处理输出文本
		state.responseTextBuilder.WriteString(streamResponse.Delta)
	case dto.ResponsesOutputTypeItemDone:
		if streamResponse.Item != nil {
			switch streamResponse.Item.Type {
			case dto.BuildInCallWebSearchCall:
				info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
			case dto.BuildInCallFileSearchCall:
				info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
			case dto.BuildInCallFunctionCall:
				info.CountBillableToolCall(dto.BuildInCallFunctionCall, streamResponse.Item.Name)
			case dto.ResponsesOutputTypeImageGenerationCall:
				if !state.imageCommitted {
					state.imageCounter.Observe(streamResponse.Item, streamResponse.OutputIndex)
				}
			}
		}
	}
}

func (state *responsesStreamUsage) Usage(info *relaycommon.RelayInfo) *dto.Usage {
	if !state.authoritativeUsage && state.usage.CompletionTokens == 0 {
		// 计算输出文本的 token 数量
		tempStr := state.responseTextBuilder.String()
		if len(tempStr) > 0 {
			// 非正常结束，使用输出文本的 token 数量
			completionTokens := service.CountTextToken(tempStr, info.UpstreamModelName)
			state.usage.CompletionTokens = completionTokens
		}
	}

	if !state.authoritativeUsage && state.usage.PromptTokens == 0 && state.usage.CompletionTokens != 0 {
		state.usage.PromptTokens = info.GetEstimatePromptTokens()
	}

	// Upstream counters are untrusted. Clamp before adding or multiplying them
	// so malformed usage cannot overflow into a credit during settlement.
	for _, counter := range []*int{&state.usage.PromptTokens, &state.usage.CompletionTokens, &state.usage.PromptTokensDetails.CachedTokens, &state.usage.PromptTokensDetails.CacheWriteTokens} {
		value, clamp := common.QuotaFromFloatChecked(float64(*counter))
		*counter = max(0, value)
		if info.QuotaClamp == nil {
			info.QuotaClamp = clamp
		}
	}
	total, clamp := common.QuotaFromFloatChecked(float64(state.usage.PromptTokens) + float64(state.usage.CompletionTokens))
	state.usage.TotalTokens = total
	if info.QuotaClamp == nil {
		info.QuotaClamp = clamp
	}

	return &state.usage
}
