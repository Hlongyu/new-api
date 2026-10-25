package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newWeComWebhookTestClient(t *testing.T, handler http.HandlerFunc) *http.Client {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	client := server.Client()
	client.Transport.(*http.Transport).TLSClientConfig.ServerName = "127.0.0.1"
	client.Transport.(*http.Transport).DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	client.CheckRedirect = newGroupRatioWebhookClient().CheckRedirect
	return client
}

func TestGroupRatioWebhookSendsWeComMarkdown(t *testing.T) {
	payload := `{"id":"event-1","type":"group.ratio.changed","timestamp":0,"changes":[{"group":"vip","old_ratio":1,"new_ratio":0},{"group":"中文分组","old_ratio":0.5,"new_ratio":1.25}]}`
	client := newWeComWebhookTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/cgi-bin/webhook/send?key=test-key", r.URL.String())
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Empty(t, r.Header.Get("X-Webhook-Signature"))
		body, err := io.ReadAll(r.Body)
		if assert.NoError(t, err) {
			assert.JSONEq(t, `{"msgtype":"markdown","markdown":{"content":"## new-api 分组倍率变更\n时间：1970-01-01T00:00:00Z\n变更分组：2\n\n> `+"`vip`"+`：1 → 0\n> `+"`中文分组`"+`：0.5 → 1.25"}}`, string(body))
		}
		_, _ = io.WriteString(w, `{"errcode":0,"errmsg":"ok"}`)
	})
	delivery := &model.GroupRatioWebhookDelivery{URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key", Payload: payload, Secret: "legacy-secret"}
	status, message := deliverGroupRatioWebhook(client, delivery)
	assert.Equal(t, http.StatusOK, status)
	assert.Empty(t, message)
	assert.Equal(t, payload, delivery.Payload, "the complete event remains available for audit and retry")
}

func TestGroupRatioWebhookChecksWeComResponse(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		error  string
	}{
		{"rate limit", 200, `{"errcode":45009,"errmsg":"secret-key"}`, "WeCom webhook returned errcode 45009"},
		{"invalid key", 200, `{"errcode":93000,"errmsg":"secret-key"}`, "WeCom webhook returned errcode 93000"},
		{"missing code", 200, `{}`, "WeCom webhook returned an invalid response"},
		{"null code", 200, `{"errcode":null}`, "WeCom webhook returned an invalid response"},
		{"invalid JSON", 200, `not JSON`, "WeCom webhook returned an invalid response"},
		{"empty body", 204, ``, "WeCom webhook returned an invalid response"},
		{"oversized response", 200, `{"errcode":0}` + strings.Repeat(" ", 4096), "WeCom webhook returned an invalid response"},
		{"HTTP failure", 503, `{"errcode":0}`, "webhook returned non-2xx status"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := newWeComWebhookTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			})
			status, message := deliverGroupRatioWebhook(client, &model.GroupRatioWebhookDelivery{
				URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-key", Payload: `{"changes":[{"group":"vip","old_ratio":1,"new_ratio":2}]}`,
			})
			assert.Equal(t, tc.status, status)
			assert.Equal(t, tc.error, message)
			assert.NotContains(t, message, "secret-key")
		})
	}
}

func TestGroupRatioWeComPayloadBoundsUTF8ContentAndEscapesGroupNames(t *testing.T) {
	event := model.GroupRatioEvent{Changes: []model.GroupRatioChange{{Group: "vip`\n<@all>", OldRatio: 1, NewRatio: 0}}}
	// Explicit maximum-size subscription: the notification must fit WeCom's
	// byte limit while the full list remains in the stored event.
	for range 999 {
		event.Changes = append(event.Changes, model.GroupRatioChange{Group: strings.Repeat("分组", 40), OldRatio: 1, NewRatio: 2})
	}
	raw, err := common.Marshal(event)
	require.NoError(t, err)
	payload, err := groupRatioWeComPayload(string(raw))
	require.NoError(t, err)
	var message struct {
		Markdown struct{ Content string } `json:"markdown"`
	}
	require.NoError(t, common.UnmarshalJsonStr(payload, &message))
	assert.LessOrEqual(t, len(message.Markdown.Content), 4096)
	assert.True(t, utf8.ValidString(message.Markdown.Content))
	assert.Contains(t, message.Markdown.Content, "`vip' &lt;@all&gt;`：1 → 0")
	assert.Contains(t, message.Markdown.Content, "另有 984 个分组变更，请在管理后台查看完整投递记录。")
	assert.NotContains(t, message.Markdown.Content, "<@all>")
}

func TestGroupRatioWebhookRejectsInvalidWeComEventBeforeSending(t *testing.T) {
	for _, payload := range []string{`{`, `{}`, `{"changes":[]}`} {
		status, message := deliverGroupRatioWebhook(nil, &model.GroupRatioWebhookDelivery{
			URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-key", Payload: payload,
		})
		assert.Zero(t, status)
		assert.Equal(t, "invalid group ratio event for WeCom webhook", message)
	}
}

func TestGroupRatioWebhookSignsExactBodyAndDoesNotFollowRedirect(t *testing.T) {
	delivery := &model.GroupRatioWebhookDelivery{ID: "event-1", Payload: `{"changes":[{"group":"vip","old_ratio":1,"new_ratio":0}]}`, Secret: strings.Repeat("s", 32)}
	hits := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Equal(t, delivery.Payload, string(body))
		assert.Equal(t, delivery.ID, r.Header.Get("X-Webhook-ID"))
		timestamp := r.Header.Get("X-Webhook-Timestamp")
		assert.NotEmpty(t, timestamp)
		signature := hmac.New(sha256.New, []byte(delivery.Secret))
		signature.Write([]byte(timestamp + "." + string(body)))
		assert.Equal(t, "sha256="+hex.EncodeToString(signature.Sum(nil)), r.Header.Get("X-Webhook-Signature"))
		w.Header().Set("Location", "/redirect")
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	delivery.URL = server.URL
	client := server.Client()
	client.CheckRedirect = newGroupRatioWebhookClient().CheckRedirect
	status, message := deliverGroupRatioWebhook(client, delivery)
	assert.Equal(t, 307, status)
	assert.NotEmpty(t, message)
	assert.Equal(t, 1, hits)
}

func TestGroupRatioWebhookRejectsPrivateDestinationEvenWithNormalHTTPSRequest(t *testing.T) {
	client := newGroupRatioWebhookClient()
	defer client.CloseIdleConnections()
	status, message := deliverGroupRatioWebhook(client, &model.GroupRatioWebhookDelivery{URL: "https://127.0.0.1/hook?token=do-not-leak", Payload: "{}", Secret: "secret"})
	assert.Zero(t, status)
	assert.NotEmpty(t, message)
	assert.NotContains(t, message, "do-not-leak")
}

func TestGroupRatioWebhookAcceptsAnySuccessfulHTTPStatus(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	status, message := deliverGroupRatioWebhook(server.Client(), &model.GroupRatioWebhookDelivery{URL: server.URL, Payload: "{}", Secret: "secret"})
	assert.Equal(t, 204, status)
	assert.Empty(t, message)
}

func TestGroupRatioWebhookWithoutSecretOmitsSignature(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Empty(t, r.Header.Get("X-Webhook-Signature"))
		assert.Equal(t, "unsigned-event", r.Header.Get("X-Webhook-ID"))
		assert.NotEmpty(t, r.Header.Get("X-Webhook-Timestamp"))
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	status, message := deliverGroupRatioWebhook(server.Client(), &model.GroupRatioWebhookDelivery{ID: "unsigned-event", URL: server.URL, Payload: "{}"})
	assert.Equal(t, 204, status)
	assert.Empty(t, message)
}
