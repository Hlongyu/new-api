package controller

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesHTTPStorageRetryAndOriginalTierBilling(t *testing.T) {
	var attempts atomic.Int32
	requests := make(chan []byte, 2)
	release := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(r.Body)
		if !assert.NoError(t, err) {
			return
		}
		requests <- data
		if attempts.Add(1) == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = io.WriteString(w, `{"error":{"type":"rate_limit_error","message":"retry this request"}}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"storage-test\"}}\n\n")
		w.(http.Flusher).Flush()
		<-release
		_, _ = io.WriteString(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"storage-test\",\"usage\":{\"input_tokens\":10,\"output_tokens\":2}}}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	f := newResponsesWSFixture(t, upstream.URL)
	t.Cleanup(func() {
		select {
		case release <- struct{}{}:
		default:
		}
	})
	oldDisk, oldTimeout, oldRetries := common.GetDiskCacheConfig(), constant.StreamingTimeout, common.RetryTimes
	oldRetryCodes := operation_setting.AutomaticRetryStatusCodeRanges
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(k, v string) error {
		if strings.HasPrefix(k, "billing_setting.") {
			saved[k] = v
		}
		return nil
	}))
	t.Cleanup(func() {
		common.SetDiskCacheConfig(oldDisk)
		constant.StreamingTimeout, common.RetryTimes = oldTimeout, oldRetries
		operation_setting.AutomaticRetryStatusCodeRanges = oldRetryCodes
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})
	common.SetDiskCacheConfig(common.DiskCacheConfig{Enabled: true, ThresholdMB: 0, MaxSizeMB: 32, Path: t.TempDir()})
	constant.StreamingTimeout, common.RetryTimes = 120, 1
	require.NoError(t, operation_setting.AutomaticRetryStatusCodesFromString("429"))
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{"ws-test":"tiered_expr"}`,
		"billing_setting.billing_expr": `{"ws-test":"(p+c) * (param(\"service_tier\") == \"priority\" ? 2 : 1)"}`,
	}))
	before := common.GetDiskCacheStats()
	body := `{"model":"ws-test","input":[{"role":"user","content":"original conversation"}],"stream":true,"service_tier":"priority","temperature":0}`
	req, err := http.NewRequest(http.MethodPost, "http"+strings.TrimPrefix(f.url, "ws"), strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer sk-wstesttoken")
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = resp.Body.Close() })
	require.Equal(t, http.StatusOK, resp.StatusCode)
	first, second := <-requests, <-requests
	assert.JSONEq(t, string(first), string(second), "retry must replay the complete request")
	assert.NotContains(t, string(second), "service_tier", "channel filtering still applies upstream")
	assert.Contains(t, string(second), "original conversation")
	// Only the incoming replay body is needed while the response is streaming.
	assert.Equal(t, before.ActiveDiskFiles+1, common.GetDiskCacheStats().ActiveDiskFiles)
	release <- struct{}{}
	response, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Contains(t, string(response), "response.completed")
	f.waitTurn(t)
	assert.Equal(t, before.ActiveDiskFiles, common.GetDiskCacheStats().ActiveDiskFiles)
	var user model.User
	require.NoError(t, f.db.First(&user, 1).Error)
	assert.Equal(t, 1000000-12, user.Quota, "settlement uses the client's original priority tier")
	assert.Equal(t, 1, user.RequestCount)
}
