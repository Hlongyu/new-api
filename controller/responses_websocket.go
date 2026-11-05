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
			if msg.kind != websocket.TextMessage || common.Unmarshal(msg.data, &envelope) != nil || envelope.Type != "response.create" || (envelope.Background != nil && *envelope.Background) {
				if turn.WriteError(http.StatusBadRequest, gin.H{"type": "invalid_request_error", "code": "invalid_request", "message": "Expected a response.create text event; background is not supported"}) != nil {
					return
				}
				continue
			}
			turn.Generate, turn.StreamID = envelope.Generate, envelope.StreamID
			// Preserve request fields for passthrough and expression pricing.
			var fields map[string]json.RawMessage
			if common.Unmarshal(msg.data, &fields) != nil {
				return
			}
			delete(fields, "type")
			delete(fields, "generate")
			delete(fields, "stream_id")
			delete(fields, "background")
			fields["stream"] = json.RawMessage("true")
			body, err := common.Marshal(fields)
			if err != nil {
				return
			}
			request := c.Request.Clone(relaycommon.WithResponsesWebSocketTurn(ctx, turn))
			request.Method = http.MethodPost
			request.URL.Path, request.URL.RawPath, request.URL.RawQuery = "/v1/responses", "", ""
			request.RequestURI = "/v1/responses"
			request.Body = io.NopCloser(bytes.NewReader(body))
			request.ContentLength = int64(len(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Del("Content-Encoding")
			request.Header.Del("Content-Length")
			for _, name := range []string{"Connection", "Upgrade", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol"} {
				request.Header.Del(name)
			}
			writer := &responsesWebSocketHTTPWriter{header: make(http.Header), status: http.StatusOK}
			router.ServeHTTP(writer, request)
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
