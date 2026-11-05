package openai

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func OaiResponsesWebSocketHandler(c *gin.Context, info *relaycommon.RelayInfo) (*dto.Usage, *types.NewAPIError) {
	turn := relaycommon.GetResponsesWebSocketTurn(c.Request)
	session := turn.Session
	conn := session.Upstream
	stopClose := context.AfterFunc(c.Request.Context(), func() { _ = conn.Close() })
	defer stopClose()
	state := &responsesStreamUsage{}
	info.StreamStatus = relaycommon.NewStreamStatus()
	for {
		_ = conn.SetReadDeadline(time.Now().Add(relaycommon.ResponsesWebSocketIdleTimeout()))
		kind, data, err := conn.ReadMessage()
		if err != nil {
			session.Broken = true
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonScannerErr, errors.New("WebSocket interrupted"))
			return state.Usage(info), types.NewErrorWithStatusCode(errors.New("upstream Responses WebSocket interrupted before a terminal event; request was not replayed"), types.ErrorCodeBadResponse, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
		}
		var event dto.ResponsesStreamResponse
		if kind != websocket.TextMessage || common.Unmarshal(data, &event) != nil || event.Type == "" {
			session.Broken = true
			return state.Usage(info), types.NewErrorWithStatusCode(errors.New("invalid upstream Responses WebSocket event"), types.ErrorCodeBadResponse, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
		}
		info.SetFirstResponseTime()
		info.ReceivedResponseCount++
		if event.Type == "error" {
			var failure struct {
				Status int               `json:"status"`
				Error  types.OpenAIError `json:"error"`
			}
			if err := common.Unmarshal(data, &failure); err != nil {
				session.Broken = true
				return state.Usage(info), types.NewErrorWithStatusCode(errors.New("invalid upstream WebSocket error"), types.ErrorCodeBadResponse, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
			}
			if failure.Status < 400 || failure.Status > 599 {
				failure.Status = http.StatusBadGateway
			}
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonHandlerStop, errors.New("upstream error"))
			return state.Usage(info), types.WithOpenAIError(failure.Error, failure.Status)
		}
		state.Observe(info, event)
		terminal := false
		switch event.Type {
		case "response.completed", "response.done", "response.failed", "response.incomplete", "response.cancelled", "response.canceled":
			terminal = true
			// Incomplete responses may carry billable usage too. Preserve an
			// explicit zero rather than estimating tokens for warmup requests.
			if event.Response != nil && event.Response.Usage != nil {
				state.authoritativeUsage = true
				u := event.Response.Usage
				state.usage.PromptTokens = u.InputTokens
				state.usage.CompletionTokens = u.OutputTokens
				if u.InputTokensDetails != nil {
					state.usage.PromptTokensDetails.CachedTokens = u.InputTokensDetails.CachedTokens
					state.usage.PromptTokensDetails.CacheWriteTokens = u.InputTokensDetails.CacheWriteTokens
				}
				state.responseTextBuilder.Reset()
			}
		}
		if err := session.Write(data); err != nil {
			session.Broken = true
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, err)
			return state.Usage(info), types.NewErrorWithStatusCode(errors.New("downstream Responses WebSocket closed"), types.ErrorCodeBadResponse, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
		}
		if terminal {
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
			return state.Usage(info), nil
		}
	}
}
