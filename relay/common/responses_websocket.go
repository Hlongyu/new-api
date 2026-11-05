package common

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gorilla/websocket"
)

type responsesWebSocketContextKey struct{}

// ResponsesWebSocketSession belongs to one authenticated downstream connection.
// Turns run sequentially; neither the upstream nor its credentials are pooled.
type ResponsesWebSocketSession struct {
	clientWriteMu sync.Mutex
	Client        *websocket.Conn
	Upstream      *websocket.Conn
	ChannelID     int
	KeyIndex      int
	Signature     [32]byte
	Broken        bool
}

// ResponsesWebSocketTurn carries transport-only fields outside the HTTP DTO.
type ResponsesWebSocketTurn struct {
	Session  *ResponsesWebSocketSession
	Generate *bool
	StreamID *string
}

func WithResponsesWebSocketTurn(ctx context.Context, turn *ResponsesWebSocketTurn) context.Context {
	return context.WithValue(ctx, responsesWebSocketContextKey{}, turn)
}

func GetResponsesWebSocketTurn(req *http.Request) *ResponsesWebSocketTurn {
	if req == nil {
		return nil
	}
	turn, _ := req.Context().Value(responsesWebSocketContextKey{}).(*ResponsesWebSocketTurn)
	return turn
}

func ResponsesWebSocketIdleTimeout() time.Duration {
	if constant.StreamingTimeout > 0 {
		return time.Duration(constant.StreamingTimeout) * time.Second
	}
	return 5 * time.Minute
}

func ResponsesWebSocketMessageLimit() int64 {
	maxMB := constant.MaxRequestBodyMB
	if maxMB <= 0 {
		maxMB = 128
	}
	return int64(maxMB) << 20
}

func (s *ResponsesWebSocketSession) Write(data []byte) error {
	s.clientWriteMu.Lock()
	defer s.clientWriteMu.Unlock()
	if err := s.Client.SetWriteDeadline(time.Now().Add(30 * time.Second)); err != nil {
		return err
	}
	return s.Client.WriteMessage(websocket.TextMessage, data)
}

func (t *ResponsesWebSocketTurn) WriteError(status int, apiError any) error {
	event := map[string]any{"type": "error", "status": status, "error": apiError}
	if t.StreamID != nil {
		event["stream_id"] = *t.StreamID
	}
	data, err := common.Marshal(event)
	if err != nil {
		return err
	}
	return t.Session.Write(data)
}
