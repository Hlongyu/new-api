package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/tidwall/gjson"
)

// ResponsesWebSocket sends each create event through the normal POST route, so
// auth, model restrictions, rate limits, billing and request logs apply per turn.
func ResponsesWebSocket(router http.Handler) gin.HandlerFunc {
	return func(c *gin.Context) {
		wsUpgrader := websocket.Upgrader{CheckOrigin: upgrader.CheckOrigin}
		client, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Minute)
		defer cancel()
		stopClose := context.AfterFunc(ctx, func() { _ = client.Close() })
		defer stopClose()
		defer client.Close()
		session := &relaycommon.ResponsesWebSocketSession{Client: client}
		defer func() {
			if session.Upstream != nil {
				_ = session.Upstream.Close()
			}
		}()
		client.SetReadLimit(relaycommon.ResponsesWebSocketMessageLimit())
		type message struct {
			kind int
			data []byte
		}
		messages := make(chan message, 1)
		readerDone := make(chan struct{})
		go func() {
			defer close(readerDone)
			defer cancel()
			for {
				kind, data, err := client.ReadMessage()
				if err != nil {
					return
				}
				// Codex sends response.interrupt while draining a response after
				// new user input. It is a control event, not a billable create.
				// This sequential relay cannot discard upstream partial items:
				// report that through the dedicated acknowledgement, which lets
				// the client drain normally instead of treating it as a turn error.
				var control struct {
					Type       string `json:"type"`
					ResponseID string `json:"response_id"`
				}
				if kind == websocket.TextMessage && gjson.GetBytes(data, "type").Str == "response.interrupt" &&
					common.Unmarshal(data, &control) == nil && control.Type == "response.interrupt" {
					ack, err := common.Marshal(gin.H{
						"type":        "response.interrupt.failed",
						"response_id": control.ResponseID,
						"error": gin.H{
							"type":    "invalid_request_error",
							"code":    "interruption_not_supported",
							"message": "This relay finishes the current response before processing the next turn",
						},
					})
					if err != nil || session.Write(ack) != nil {
						return
					}
					continue
				}
				// Bound pending input while a response is running. Reading stays
				// active so a client disconnect cancels the upstream immediately.
				select {
				case messages <- message{kind, data}:
				case <-ctx.Done():
					return
				default:
					return
				}
			}
		}()
		defer func() {
			cancel()
			_ = client.Close()
			<-readerDone
		}()

		for {
			idle := time.NewTimer(relaycommon.ResponsesWebSocketIdleTimeout())
			var msg message
			select {
			case msg = <-messages:
				idle.Stop()
			case <-idle.C:
				return
			case <-ctx.Done():
				idle.Stop()
				return
			}
			turn := &relaycommon.ResponsesWebSocketTurn{Session: session}
			var envelope struct {
				Type       string  `json:"type"`
				Generate   *bool   `json:"generate"`
				StreamID   *string `json:"stream_id"`
				Background *bool   `json:"background"`
			}
			validationError := ""
			switch {
			case msg.kind != websocket.TextMessage || common.Unmarshal(msg.data, &envelope) != nil:
				validationError = "Expected a JSON text event"
			case envelope.Type != "response.create":
				validationError = "Unsupported Responses WebSocket event type"
			case envelope.Background != nil && *envelope.Background:
				validationError = "background is not supported over Responses WebSocket"
			}
			if validationError != "" {
				if turn.WriteError(http.StatusBadRequest, gin.H{"type": "invalid_request_error", "code": "invalid_request", "message": validationError}) != nil {
					return
				}
				continue
			}
			turn.Generate, turn.StreamID = envelope.Generate, envelope.StreamID
			// Preserve request fields for passthrough and expression pricing.
			var body bytes.Buffer
			body.Grow(len(msg.data))
			err := common.WriteJSONObject(&body, msg.data, map[string]json.RawMessage{
				"type": nil, "generate": nil, "stream_id": nil, "background": nil,
				"stream": json.RawMessage("true"),
			})
			msg.data = nil
			if err != nil {
				return
			}
			storage, err := common.CreateBodyStorage(body.Bytes())
			if err != nil {
				return
			}
			request := c.Request.Clone(relaycommon.WithResponsesWebSocketTurn(ctx, turn))
			request.Method = http.MethodPost
			request.URL.Path, request.URL.RawPath, request.URL.RawQuery = "/v1/responses", "", ""
			request.RequestURI = "/v1/responses"
			request.Body = storage
			request.ContentLength = storage.Size()
			request.Header.Set("Content-Type", "application/json")
			request.Header.Del("Content-Encoding")
			request.Header.Del("Content-Length")
			for _, name := range []string{"Connection", "Upgrade", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol"} {
				request.Header.Del(name)
			}
			writer := &responsesWebSocketHTTPWriter{header: make(http.Header), status: http.StatusOK}
			router.ServeHTTP(writer, request)
			// Auth may reject the turn before body-storage middleware adopts it.
			_ = storage.Close()
			if writer.status >= http.StatusBadRequest {
				var response struct {
					Error json.RawMessage `json:"error"`
				}
				if common.Unmarshal(writer.body.Bytes(), &response) != nil || len(response.Error) == 0 {
					response.Error = json.RawMessage(`{"type":"server_error","message":"Request failed"}`)
				}
				if turn.WriteError(writer.status, response.Error) != nil {
					return
				}
			}
			if session.Broken {
				return
			}
		}
	}
}

// Successful events go directly to the socket. Only HTTP middleware/controller
// errors are captured here and translated into native WebSocket error events.
type responsesWebSocketHTTPWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *responsesWebSocketHTTPWriter) Header() http.Header    { return w.header }
func (w *responsesWebSocketHTTPWriter) WriteHeader(status int) { w.status = status }
func (w *responsesWebSocketHTTPWriter) Write(data []byte) (int, error) {
	if w.body.Len()+len(data) > 64<<10 {
		return 0, io.ErrShortBuffer
	}
	return w.body.Write(data)
}
func (w *responsesWebSocketHTTPWriter) Flush() {}
