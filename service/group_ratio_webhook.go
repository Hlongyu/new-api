package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
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
	target, err := url.Parse(delivery.URL)
	if err != nil {
		return 0, "invalid webhook request"
	}
	if target.Scheme != "https" || target.User != nil {
		return 0, "webhook requires HTTPS without credentials"
	}
	wecom := strings.EqualFold(target.Hostname(), "qyapi.weixin.qq.com") && target.Path == "/cgi-bin/webhook/send"
	payload := delivery.Payload
	if wecom {
		payload, err = groupRatioWeComPayload(delivery.Payload)
		if err != nil {
			return 0, "invalid group ratio event for WeCom webhook"
		}
	}
	req, err := http.NewRequest(http.MethodPost, delivery.URL, bytes.NewBufferString(payload))
	if err != nil {
		return 0, "invalid webhook request"
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-ID", delivery.ID)
	req.Header.Set("X-Webhook-Timestamp", timestamp)
	if delivery.Secret != "" && !wecom {
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
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4097))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, "webhook returned non-2xx status"
	}
	if wecom {
		var result struct {
			ErrCode *int `json:"errcode"`
		}
		if readErr != nil || len(body) > 4096 || common.Unmarshal(body, &result) != nil || result.ErrCode == nil {
			return resp.StatusCode, "WeCom webhook returned an invalid response"
		}
		if *result.ErrCode != 0 {
			// Do not store errmsg: it can echo the secret-bearing webhook URL.
			return resp.StatusCode, fmt.Sprintf("WeCom webhook returned errcode %d", *result.ErrCode)
		}
	}
	return resp.StatusCode, ""
}

// Keep the full event in the outbox for audit/retry, and format only at delivery
// time so already queued events can also be sent directly to a WeCom robot.
func groupRatioWeComPayload(payload string) (string, error) {
	var event model.GroupRatioEvent
	if err := common.UnmarshalJsonStr(payload, &event); err != nil {
		return "", err
	}
	if len(event.Changes) == 0 {
		return "", fmt.Errorf("group ratio event has no changes")
	}
	var content strings.Builder
	fmt.Fprintf(&content, "## new-api 分组倍率变更\n时间：%s\n变更分组：%d\n", time.Unix(event.Timestamp, 0).UTC().Format(time.RFC3339), len(event.Changes))
	// Group names are untrusted display text, never Markdown or @mentions.
	escape := strings.NewReplacer("\r", " ", "\n", " ", "`", "'", "&", "&amp;", "<", "&lt;", ">", "&gt;")
	for i, change := range event.Changes {
		line := fmt.Sprintf("\n> `%s`：%s → %s", escape.Replace(change.Group), strconv.FormatFloat(change.OldRatio, 'g', -1, 64), strconv.FormatFloat(change.NewRatio, 'g', -1, 64))
		omitted := fmt.Sprintf("\n\n另有 %d 个分组变更，请在管理后台查看完整投递记录。", len(event.Changes)-i)
		// WeCom limits Markdown content to 4096 UTF-8 bytes. Keep complete
		// lines and reserve a summary rather than splitting a retryable event.
		if content.Len()+len(line)+len(omitted) > 4096 {
			content.WriteString(omitted)
			break
		}
		content.WriteString(line)
	}
	message := struct {
		MsgType  string `json:"msgtype"`
		Markdown struct {
			Content string `json:"content"`
		} `json:"markdown"`
	}{MsgType: "markdown"}
	message.Markdown.Content = content.String()
	encoded, err := common.Marshal(message)
	return string(encoded), err
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
