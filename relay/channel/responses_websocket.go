package channel

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// DoResponsesWebSocketRequest sends exactly once on the connection bound to
// this downstream session. A changed endpoint, key or transport requires a new
// session; silently reconnecting would lose store=false continuation state.
func DoResponsesWebSocketRequest(a Adaptor, c *gin.Context, info *relaycommon.RelayInfo, body []byte) error {
	turn := relaycommon.GetResponsesWebSocketTurn(c.Request)
	session := turn.Session
	// Personal channels remain disabled until their protected dial-time SSRF
	// transport supports WebSockets. Never fall back to an unprotected dialer.
	if c.GetBool("personal_channel") {
		return errors.New("personal channels do not support Responses WebSocket requests")
	}
	requestURL, err := a.GetRequestURL(info)
	if err != nil {
		return err
	}
	u, err := url.Parse(requestURL)
	if err != nil {
		return errors.New("invalid Responses WebSocket URL")
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	case "ws", "wss":
	default:
		return errors.New("invalid Responses WebSocket URL scheme")
	}
	headers := make(http.Header)
	if err := a.SetupRequestHeader(c, &headers, info); err != nil {
		return err
	}
	// Codex session and beta headers are safe protocol metadata, not client
	// credentials. Explicit channel overrides still take precedence.
	for _, name := range []string{"OpenAI-Beta", "session_id", "conversation_id", "x-codex-turn-state"} {
		if value := c.GetHeader(name); value != "" {
			headers.Set(name, value)
		}
	}
	overrides, err := processHeaderOverride(info, c)
	if err != nil {
		return err
	}
	for name, value := range overrides {
		headers.Set(name, value)
	}
	for _, name := range []string{"Content-Type", "Accept", "Content-Length", "Connection", "Upgrade", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol"} {
		headers.Del(name)
	}
	signatureData, err := common.Marshal([]any{info.ChannelId, u.String(), headers, info.ChannelSetting.Proxy})
	if err != nil {
		return err
	}
	signature := sha256.Sum256(signatureData)
	if session.Upstream != nil && session.Signature != signature {
		session.Broken = true
		return errors.New("WebSocket channel configuration changed; reconnect to continue")
	}
	fields := map[string]json.RawMessage{
		"type":   json.RawMessage(`"response.create"`),
		"stream": nil, "stream_options": nil, "background": nil,
	}
	if turn.Generate != nil {
		fields["generate"], err = common.Marshal(*turn.Generate)
		if err != nil {
			return err
		}
	}
	if turn.StreamID != nil {
		fields["stream_id"], err = common.Marshal(*turn.StreamID)
		if err != nil {
			return err
		}
	}
	if err := c.Request.Context().Err(); err != nil {
		return err
	}
	if session.Upstream == nil {
		settings := info.ChannelSetting
		settings.HTTPProtocol, settings.HTTP2ConnectionShards = dto.HTTPProtocolHTTP1, 1
		client, err := service.GetHttpClientWithProxySettings(settings.Proxy, settings)
		if err != nil {
			return err
		}
		transport, ok := client.Transport.(*http.Transport)
		if !ok {
			return errors.New("unsupported Responses WebSocket transport")
		}
		dialer := websocket.Dialer{
			Proxy: transport.Proxy, NetDialContext: transport.DialContext,
			TLSClientConfig: transport.TLSClientConfig, HandshakeTimeout: 30 * time.Second,
		}
		conn, response, err := dialer.DialContext(c.Request.Context(), u.String(), headers)
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		if err != nil {
			// Dial errors can contain sensitive URL/header data.
			if response != nil {
				return fmt.Errorf("upstream Responses WebSocket handshake failed (HTTP %d)", response.StatusCode)
			}
			return errors.New("upstream Responses WebSocket connection failed")
		}
		conn.SetReadLimit(relaycommon.ResponsesWebSocketMessageLimit())
		session.Upstream, session.Signature = conn, signature
		session.ChannelID = info.ChannelId
		session.KeyIndex = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
	}
	if err := session.Upstream.SetWriteDeadline(time.Now().Add(30 * time.Second)); err != nil {
		session.Broken = true
		return errors.New("upstream Responses WebSocket closed; request was not replayed")
	}
	writer, err := session.Upstream.NextWriter(websocket.TextMessage)
	if err == nil {
		err = common.WriteJSONObject(writer, body, fields)
		if err == nil {
			err = writer.Close()
		}
	}
	if err != nil {
		session.Broken = true
		_ = session.Upstream.Close()
		return errors.New("upstream Responses WebSocket send failed; request was not replayed")
	}
	return nil
}
