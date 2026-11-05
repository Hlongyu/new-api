package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type responsesWSFixture struct {
	db          *gorm.DB
	url         string
	turnDone    chan struct{}
	sessionDone chan struct{}
}

func newResponsesWSFixture(t *testing.T, upstream string) *responsesWSFixture {
	t.Helper()
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldCache, oldRedis, oldBatch, oldCount := common.MemoryCacheEnabled, common.RedisEnabled, common.BatchUpdateEnabled, constant.CountToken
	oldThreshold := common.QuotaRemindThreshold
	backgroundWorkers := gopool.WorkerCount()
	oldRatio, oldCompletion := ratio_setting.ModelRatio2JSONString(), ratio_setting.CompletionRatio2JSONString()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.MemoryCacheEnabled, common.RedisEnabled, common.BatchUpdateEnabled, constant.CountToken = oldCache, oldRedis, oldBatch, oldCount
		common.QuotaRemindThreshold = oldThreshold
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatio))
		require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(oldCompletion))
	})
	db := setupModelListControllerTestDB(t)
	common.MemoryCacheEnabled, common.RedisEnabled, common.BatchUpdateEnabled, constant.CountToken = false, false, false, false
	// Billing assertions must not initialize the unrelated notification service.
	common.QuotaRemindThreshold = common.MinQuota
	require.NoError(t, i18n.Init())
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Coupon{}, &model.Token{}, &model.Log{}, &model.UserSubscription{}, &model.TokenQuotaUsage{}, &model.PostpaidSettlement{}, &model.PostpaidSettlementAllocation{}, &model.ConsumptionAttribution{}, &model.SystemTask{}, &model.SystemTaskLock{}))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"ws-test":1}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"ws-test":1}`))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "ws-user", Group: "default", Status: common.UserStatusEnabled, Quota: 1000000}).Error)
	require.NoError(t, db.Create(&model.Token{Id: 1, UserId: 1, Key: "wstesttoken", Name: "ws", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 1000000, ModelLimitsEnabled: true, ModelLimits: "ws-test"}).Error)
	require.NoError(t, db.Create(&model.Channel{
		Id: 1, Type: constant.ChannelTypeOpenAI, Name: "ws-upstream", BaseURL: &upstream,
		Key: "upstream-one\nupstream-two", Status: common.ChannelStatusEnabled, Models: "ws-test", Group: "default",
		ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyMode: constant.MultiKeyModePolling},
	}).Error)
	require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "ws-test", ChannelId: 1, Enabled: true}).Error)
	f := &responsesWSFixture{db: db, turnDone: make(chan struct{}, 16), sessionDone: make(chan struct{}, 16)}
	router := gin.New()
	router.Use(middleware.RequestId(), middleware.BodyStorageCleanup())
	router.GET("/v1/responses", middleware.TokenAuth(), func(c *gin.Context) {
		defer func() { f.sessionDone <- struct{}{} }()
		ResponsesWebSocket(router)(c)
	})
	router.POST("/v1/responses", func(c *gin.Context) {
		c.Next()
		f.turnDone <- struct{}{}
	}, middleware.TokenAuth(), middleware.ModelRequestRateLimit(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIResponses) })
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	// Relay records performance samples and quota notifications asynchronously.
	// Join those workers before closing the fixture DB or restoring globals.
	t.Cleanup(func() {
		require.Eventually(t, func() bool { return gopool.WorkerCount() <= backgroundWorkers }, 10*time.Second, time.Millisecond)
	})
	f.url = "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/responses"
	return f
}

func (f *responsesWSFixture) connect(t *testing.T) *websocket.Conn {
	t.Helper()
	client, _, err := websocket.DefaultDialer.Dial(f.url, http.Header{"Authorization": {"Bearer sk-wstesttoken"}})
	require.NoError(t, err)
	require.NoError(t, client.SetReadDeadline(time.Now().Add(10*time.Second)))
	t.Cleanup(func() {
		_ = client.Close()
		select {
		case <-f.sessionDone:
		case <-time.After(10 * time.Second):
			t.Error("WebSocket session did not stop")
		}
	})
	return client
}

func readResponsesWSEvent(t *testing.T, client *websocket.Conn) map[string]json.RawMessage {
	t.Helper()
	kind, data, err := client.ReadMessage()
	require.NoError(t, err)
	require.Equal(t, websocket.TextMessage, kind)
	var event map[string]json.RawMessage
	require.NoError(t, common.Unmarshal(data, &event))
	return event
}

func (f *responsesWSFixture) waitTurn(t *testing.T) {
	t.Helper()
	select {
	case <-f.turnDone:
	case <-time.After(10 * time.Second):
		t.Fatal("WebSocket turn did not finish")
	}
}

func TestResponsesWebSocketNativeContinuationBillingAndReauthentication(t *testing.T) {
	var connections atomic.Int32
	requests := make(chan map[string]json.RawMessage, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connections.Add(1)
		assert.Equal(t, "/v1/responses", r.URL.Path)
		assert.Contains(t, []string{"Bearer upstream-one", "Bearer upstream-two"}, r.Header.Get("Authorization"))
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer ws.Close()
		for i := 0; i < 2; i++ {
			_, data, err := ws.ReadMessage()
			if !assert.NoError(t, err) {
				return
			}
			var request map[string]json.RawMessage
			if !assert.NoError(t, common.Unmarshal(data, &request)) {
				return
			}
			requests <- request
			event := `{"type":"response.completed","response":{"id":"resp_1","model":"ws-test","status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}`
			if i == 1 {
				event = `{"type":"response.incomplete","response":{"id":"resp_2","model":"ws-test","status":"incomplete","usage":{"input_tokens":20,"output_tokens":3,"total_tokens":23,"input_tokens_details":{"cached_tokens":5}}}}`
			}
			if !assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(event))) {
				return
			}
		}
		_, _, _ = ws.ReadMessage()
	}))
	t.Cleanup(upstream.Close)
	f := newResponsesWSFixture(t, upstream.URL)
	// Production xxgate uses an advanced custom channel with a native route.
	nativeSettings, err := common.Marshal(dto.ChannelOtherSettings{AdvancedCustom: &dto.AdvancedCustomConfig{
		Routes: []dto.AdvancedCustomRoute{{IncomingPath: "/v1/responses", UpstreamPath: "/v1/responses", Converter: relayconvert.ConverterNone}},
	}})
	require.NoError(t, err)
	require.NoError(t, f.db.Model(&model.Channel{}).Where("id = ?", 1).Updates(map[string]any{"type": constant.ChannelTypeAdvancedCustom, "settings": string(nativeSettings)}).Error)
	client := f.connect(t)
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-test","input":[],"temperature":0,"store":false,"generate":false}`)))
	require.JSONEq(t, `"response.completed"`, string(readResponsesWSEvent(t, client)["type"]))
	f.waitTurn(t)
	first := <-requests
	assert.JSONEq(t, `"response.create"`, string(first["type"]))
	assert.JSONEq(t, `false`, string(first["generate"]))
	assert.JSONEq(t, `0`, string(first["temperature"]))
	assert.JSONEq(t, `false`, string(first["store"]))
	assert.NotContains(t, first, "stream")
	assert.NotContains(t, first, "max_output_tokens")

	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-test","input":[],"previous_response_id":"resp_1","max_output_tokens":0}`)))
	require.JSONEq(t, `"response.incomplete"`, string(readResponsesWSEvent(t, client)["type"]))
	f.waitTurn(t)
	second := <-requests
	assert.JSONEq(t, `"resp_1"`, string(second["previous_response_id"]))
	assert.JSONEq(t, `0`, string(second["max_output_tokens"]))
	assert.NotContains(t, second, "generate")
	assert.EqualValues(t, 1, connections.Load())
	var settlements []model.PostpaidSettlement
	require.NoError(t, f.db.Find(&settlements).Error)
	require.Len(t, settlements, 2)
	assert.NotEqual(t, settlements[0].RequestId, settlements[1].RequestId)
	var user model.User
	require.NoError(t, f.db.First(&user, 1).Error)
	assert.Equal(t, 2, user.RequestCount)
	assert.Equal(t, 1000000-12-23, user.Quota)
	var token model.Token
	require.NoError(t, f.db.First(&token, 1).Error)
	assert.Equal(t, 1000000-12-23, token.RemainQuota)

	// Pass-through must not bypass the native-protocol requirement either.
	convertedSettings, err := common.Marshal(dto.ChannelOtherSettings{AdvancedCustom: &dto.AdvancedCustomConfig{
		Routes: []dto.AdvancedCustomRoute{{IncomingPath: "/v1/responses", UpstreamPath: "/v1/chat/completions", Converter: relayconvert.ConverterOpenAIResponsesToOpenAIChat}},
	}})
	require.NoError(t, err)
	require.NoError(t, f.db.Model(&model.Channel{}).Where("id = ?", 1).Updates(map[string]any{"settings": string(convertedSettings), "setting": `{"pass_through_body_enabled":true}`}).Error)
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-test","input":[]}`)))
	assert.JSONEq(t, `400`, string(readResponsesWSEvent(t, client)["status"]))
	f.waitTurn(t)
	require.NoError(t, f.db.Model(&model.Channel{}).Where("id = ?", 1).Updates(map[string]any{"settings": string(nativeSettings), "setting": `{}`}).Error)

	// Validation and model restrictions apply to every frame, before forwarding.
	for _, test := range []struct {
		body   string
		status string
	}{
		{`{"type":"response.create","model":"ws-test","input":[],"max_output_tokens":18446744073709551615}`, `400`},
		{`{"type":"response.create","model":"forbidden","input":[]}`, `403`},
	} {
		require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(test.body)))
		event := readResponsesWSEvent(t, client)
		assert.JSONEq(t, `"error"`, string(event["type"]))
		assert.JSONEq(t, test.status, string(event["status"]))
		f.waitTurn(t)
	}
	// A revoked token cannot keep using an already authenticated connection.
	require.NoError(t, f.db.Model(&model.Token{}).Where("id = ?", 1).Update("status", common.TokenStatusDisabled).Error)
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-test","input":[]}`)))
	assert.JSONEq(t, `401`, string(readResponsesWSEvent(t, client)["status"]))
	f.waitTurn(t)
	var count int64
	require.NoError(t, f.db.Model(&model.PostpaidSettlement{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

func TestResponsesWebSocketDisconnectIsNotReplayed(t *testing.T) {
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer ws.Close()
		_, _, err = ws.ReadMessage()
		if !assert.NoError(t, err) {
			return
		}
		requests.Add(1)
		assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.created","response":{"id":"resp_lost"}}`)))
	}))
	t.Cleanup(upstream.Close)
	f := newResponsesWSFixture(t, upstream.URL)
	client := f.connect(t)
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-test","input":[]}`)))
	assert.JSONEq(t, `"response.created"`, string(readResponsesWSEvent(t, client)["type"]))
	event := readResponsesWSEvent(t, client)
	assert.JSONEq(t, `"error"`, string(event["type"]))
	assert.JSONEq(t, `502`, string(event["status"]))
	f.waitTurn(t)
	assert.EqualValues(t, 1, requests.Load())
	_, _, err := client.ReadMessage()
	require.Error(t, err)
}

func TestResponsesWebSocketRechecksPinnedChannel(t *testing.T) {
	for _, test := range []struct {
		name   string
		update func(*testing.T, *gorm.DB)
		status string
	}{
		{"disabled channel", func(t *testing.T, db *gorm.DB) {
			require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 1).Update("status", common.ChannelStatusManuallyDisabled).Error)
		}, `403`},
		{"removed model ability", func(t *testing.T, db *gorm.DB) {
			require.NoError(t, db.Model(&model.Ability{}).Where("channel_id = ?", 1).Update("enabled", false).Error)
		}, `403`},
		{"rotated key", func(t *testing.T, db *gorm.DB) {
			require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 1).Update("key", "replacement-one\nreplacement-two").Error)
		}, `502`},
		{"disabled key", func(t *testing.T, db *gorm.DB) {
			require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 1).Update("channel_info", model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyStatusList: map[int]int{0: common.ChannelStatusManuallyDisabled, 1: common.ChannelStatusManuallyDisabled}}).Error)
		}, `400`},
	} {
		t.Run(test.name, func(t *testing.T) {
			var requests atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if !assert.NoError(t, err) {
					return
				}
				defer ws.Close()
				for {
					if _, _, err := ws.ReadMessage(); err != nil {
						return
					}
					requests.Add(1)
					if err := ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"resp_pin","usage":{"input_tokens":1,"output_tokens":1}}}`)); err != nil {
						return
					}
				}
			}))
			t.Cleanup(upstream.Close)
			f := newResponsesWSFixture(t, upstream.URL)
			client := f.connect(t)
			request := []byte(`{"type":"response.create","model":"ws-test","input":[]}`)
			require.NoError(t, client.WriteMessage(websocket.TextMessage, request))
			require.JSONEq(t, `"response.completed"`, string(readResponsesWSEvent(t, client)["type"]))
			f.waitTurn(t)
			test.update(t, f.db)
			require.NoError(t, client.WriteMessage(websocket.TextMessage, request))
			assert.JSONEq(t, test.status, string(readResponsesWSEvent(t, client)["status"]))
			f.waitTurn(t)
			assert.EqualValues(t, 1, requests.Load())
		})
	}
}

func TestResponsesWebSocketClientDisconnectCancelsUpstream(t *testing.T) {
	received, closed := make(chan struct{}), make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer ws.Close()
		if _, _, err := ws.ReadMessage(); !assert.NoError(t, err) {
			return
		}
		close(received)
		_, _, err = ws.ReadMessage()
		assert.Error(t, err)
		close(closed)
	}))
	t.Cleanup(upstream.Close)
	f := newResponsesWSFixture(t, upstream.URL)
	client := f.connect(t)
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-test","input":[]}`)))
	select {
	case <-received:
	case <-time.After(10 * time.Second):
		t.Fatal("upstream did not receive request")
	}
	require.NoError(t, client.Close())
	select {
	case <-closed:
	case <-time.After(10 * time.Second):
		t.Fatal("upstream was not cancelled")
	}
	f.waitTurn(t)
}

func TestResponsesWebSocketUsageSafety(t *testing.T) {
	for _, test := range []struct {
		name, usage string
		charge      int
	}{
		{"zero warmup", `{"input_tokens":0,"output_tokens":0}`, 0},
		{"negative usage", `{"input_tokens":-100,"output_tokens":-20}`, 0},
		{"overflow usage", `{"input_tokens":9223372036854775807,"output_tokens":9223372036854775807}`, common.MaxQuota},
	} {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if !assert.NoError(t, err) {
					return
				}
				defer ws.Close()
				if _, _, err := ws.ReadMessage(); !assert.NoError(t, err) {
					return
				}
				assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"resp_usage","usage":`+test.usage+`}}`)))
				_, _, _ = ws.ReadMessage()
			}))
			t.Cleanup(upstream.Close)
			f := newResponsesWSFixture(t, upstream.URL)
			client := f.connect(t)
			require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-test","input":[],"generate":false}`)))
			require.JSONEq(t, `"response.completed"`, string(readResponsesWSEvent(t, client)["type"]))
			f.waitTurn(t)
			var user model.User
			require.NoError(t, f.db.First(&user, 1).Error)
			assert.Equal(t, 1000000-test.charge, user.Quota)
		})
	}
}

func TestResponsesWebSocketInterruptedToolCallIsBilled(t *testing.T) {
	operation_setting.SetToolPriceForTest("ws_tool", 1)
	t.Cleanup(func() { operation_setting.DeleteToolPriceForTest("ws_tool") })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer ws.Close()
		if _, _, err := ws.ReadMessage(); !assert.NoError(t, err) {
			return
		}
		assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.output_item.done","item":{"type":"function_call","name":"ws_tool","call_id":"call_1"}}`)))
	}))
	t.Cleanup(upstream.Close)
	f := newResponsesWSFixture(t, upstream.URL)
	client := f.connect(t)
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-test","input":[]}`)))
	require.JSONEq(t, `"response.output_item.done"`, string(readResponsesWSEvent(t, client)["type"]))
	assert.JSONEq(t, `502`, string(readResponsesWSEvent(t, client)["status"]))
	f.waitTurn(t)
	var user model.User
	require.NoError(t, f.db.First(&user, 1).Error)
	assert.Equal(t, 1000000-500, user.Quota)
}
