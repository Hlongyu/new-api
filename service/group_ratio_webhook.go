package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// Always use direct, verified TLS connections and validate the resolved address
// at dial time. Global fetch/proxy settings cannot disable webhook protection.
func newGroupRatioWebhookClient() *http.Client {
	protection := &common.SSRFProtection{ApplyIPFilterForDomain: true, AllowedPorts: []int{443}}
	dialer := &protectedFetchDialer{
		resolver:      net.DefaultResolver,
		dialContext:   (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
		getProtection: func() (*common.SSRFProtection, bool, error) { return protection, true, nil },
	}
	return &http.Client{
		Timeout:       15 * time.Second,
		Transport:     &http.Transport{DialContext: dialer.DialContext, TLSHandshakeTimeout: 10 * time.Second, IdleConnTimeout: 60 * time.Second},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func deliverGroupRatioWebhook(client *http.Client, delivery *model.GroupRatioWebhookDelivery) (int, string) {
	req, err := http.NewRequest(http.MethodPost, delivery.URL, bytes.NewBufferString(delivery.Payload))
	if err != nil {
		return 0, "invalid webhook request"
	}
	if req.URL.Scheme != "https" || req.URL.User != nil {
		return 0, "webhook requires HTTPS without credentials"
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-ID", delivery.ID)
	req.Header.Set("X-Webhook-Timestamp", timestamp)
	if delivery.Secret != "" {
		signature := hmac.New(sha256.New, []byte(delivery.Secret))
		signature.Write([]byte(timestamp + "." + delivery.Payload))
		req.Header.Set("X-Webhook-Signature", "sha256="+hex.EncodeToString(signature.Sum(nil)))
	}
	resp, err := client.Do(req)
	// Do not persist transport errors: they may embed the secret-bearing URL.
	if err != nil {
		return 0, "webhook connection failed or timed out"
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, "webhook returned non-2xx status"
	}
	return resp.StatusCode, ""
}

func RunGroupRatioWebhookWorker() {
	client := newGroupRatioWebhookClient()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		// Bounded batches also give fresh work a chance after retry failures.
		for range 20 {
			delivery, err := model.ClaimGroupRatioWebhook(time.Now().Unix())
			if err != nil {
				common.SysError("claim group ratio webhook: " + err.Error())
				break
			}
			if delivery == nil {
				break
			}
			status, message := deliverGroupRatioWebhook(client, delivery)
			if err := model.FinishGroupRatioWebhook(delivery, status, message, time.Now().Unix()); err != nil {
				common.SysError("finish group ratio webhook: " + err.Error())
			}
		}
	}
}
