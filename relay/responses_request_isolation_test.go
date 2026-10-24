package relay

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesAttemptsPreserveOriginalRequest(t *testing.T) {
	const body = `{"model":"client-model","input":[{"role":"user","content":"history"}],"reasoning":{"effort":"low"},"temperature":0,"stream":false}`
	settings := model_setting.GetGlobalSettings()
	previousPassThrough := settings.PassThroughRequestEnabled
	t.Cleanup(func() { settings.PassThroughRequestEnabled = previousPassThrough })
	for _, mode := range []string{"converted", "channel_passthrough", "global_passthrough"} {
		t.Run(mode, func(t *testing.T) {
			settings.PassThroughRequestEnabled = mode == "global_passthrough"
			bodies := make(chan []byte, 2)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data, err := io.ReadAll(r.Body)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				bodies <- data
				w.Header().Set("Content-Type", "application/json")
				// Reject the attempt before billing; a subsequent channel must receive
				// the original request, not the first channel's mapped model or effort.
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"error":{"message":"test rejection","type":"invalid_request_error","code":"invalid_request"}}`)
			}))
			defer upstream.Close()
			var original, expected dto.OpenAIResponsesRequest
			require.NoError(t, common.Unmarshal([]byte(body), &original))
			require.NoError(t, common.Unmarshal([]byte(body), &expected))
			for _, model := range []string{"gpt-5-high", "gpt-5-low"} {
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body))
				c.Request.Header.Set("Content-Type", "application/json")
				common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
				common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
				common.SetContextKey(c, constant.ContextKeyOriginalModel, "client-model")
				common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{PassThroughBodyEnabled: mode == "channel_passthrough"})
				mapping, err := common.Marshal(map[string]string{"client-model": model})
				require.NoError(t, err)
				c.Set("model_mapping", string(mapping))
				info := &relaycommon.RelayInfo{Request: &original, OriginModelName: "client-model", RequestURLPath: "/v1/responses", RelayMode: relayconstant.RelayModeResponses, RelayFormat: types.RelayFormatOpenAIResponses}
				relayErr := ResponsesHelper(c, info)
				common.CleanupBodyStorage(c)
				require.NotNil(t, relayErr)
				require.Equal(t, http.StatusBadRequest, relayErr.StatusCode)
				require.Len(t, bodies, 1, "request must reach the upstream")
				sent := <-bodies
				if mode == "converted" {
					var received dto.OpenAIResponsesRequest
					require.NoError(t, common.Unmarshal(sent, &received))
					assert.Equal(t, "gpt-5", received.Model)
					assert.Equal(t, strings.TrimPrefix(model, "gpt-5-"), received.Reasoning.Effort)
					assert.Equal(t, expected.Input, received.Input)
					require.NotNil(t, received.Temperature)
					assert.Zero(t, *received.Temperature)
				} else {
					assert.Equal(t, body, string(sent), "passthrough preserves the original bytes")
				}
				assert.Equal(t, expected, original)
				assert.Equal(t, model, info.UpstreamModelName, "mapping metadata remains available even in passthrough mode")
			}
		})
	}
}
