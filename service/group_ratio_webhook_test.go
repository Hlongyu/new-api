package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
