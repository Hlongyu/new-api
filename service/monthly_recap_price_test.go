package service

import (
	"encoding/base64"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMonthlyRecapOriginalUnitPrices(t *testing.T) {
	for _, tc := range []struct {
		name, metadata, expr       string
		input, output, read, write int64
		want                       float64
		known                      bool
	}{
		{"free tier with request multiplier", `{"billing_mode":"tiered_expr","group_ratio":0,"matched_tier":"standard"}`, `tier("standard",p*5+c*30+cr*0.5)*(param("service_tier")=="fast"?2:1)`, 1000, 100, 900, 0, 1975, true},
		{"legacy cache", `{"model_ratio":2.5,"completion_ratio":6,"cache_ratio":0.1,"group_ratio":0}`, "", 1000, 100, 900, 0, 1975, true},
		{"cache write", `{"billing_mode":"tiered_expr","matched_tier":"base"}`, `tier("base",p*3+c*15+cr*0.3+cc*3.75+cc1h*6)`, 1000, 100, 600, 100, 1477.5, true},
		{"split write", `{"model_ratio":1.5,"completion_ratio":5,"cache_ratio":0.1,"cache_creation_tokens_5m":60,"cache_creation_tokens_1h":40,"cache_creation_ratio_5m":1.25,"cache_creation_ratio_1h":2}`, "", 1000, 100, 600, 100, 1522.5, true},
		{"recorded tier", `{"billing_mode":"tiered_expr","matched_tier":"long"}`, `len>200000?tier("long",p*6+c*22.5+cr*0.6):tier("short",p*3+c*15+cr*0.3)`, 1000, 100, 900, 0, 1695, true},
		{"missing tier", `{"billing_mode":"tiered_expr"}`, `len>200000?tier("long",p*6):tier("short",p*3)`, 1000, 0, 0, 0, 0, false},
		{"dynamic price unavailable", `{"billing_mode":"tiered_expr","matched_tier":"base"}`, `tier("base",p*param("price"))`, 1000, 0, 0, 0, 0, false},
		{"token dependent wrapper", `{"billing_mode":"tiered_expr","matched_tier":"base"}`, `tier("base",p*3)*(len>1000?2:1)`, 1000, 0, 0, 0, 0, false},
		{"additive wrapper", `{"billing_mode":"tiered_expr","matched_tier":"base"}`, `tier("base",p*3)+p*2`, 1000, 0, 0, 0, 0, false},
		{"missing historic price", `{"group_ratio":0.25}`, "", 1000, 100, 900, 0, 0, false},
		{"invalid expr no fallback", `{"billing_mode":"tiered_expr","model_ratio":2.5}`, `bad(`, 1000, 0, 0, 0, 0, false},
		{"cache unaware expression", `{"billing_mode":"tiered_expr"}`, `p*3+c*15`, 1000, 100, 900, 0, 2250, true},
		{"tool fee no discount", `{"model_ratio":1,"tool_surcharges":[{"name":"web_search","count":3,"price":10}]}`, "", 100, 0, 0, 0, 15100, true},
		{"legacy image tool", `{"model_ratio":1,"image_generation_call":true,"image_generation_call_price":0.04}`, "", 100, 0, 0, 0, 20100, true},
		{"per call image", `{"model_price":0.24,"image":true}`, "", 100, 0, 0, 0, 120000, true},
		{"negative price", `{"model_ratio":-2}`, "", 100, 0, 0, 0, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var metadata recapLogMetadata
			require.NoError(t, common.UnmarshalJsonStr(tc.metadata, &metadata))
			if tc.expr != "" {
				metadata.Expr = base64.StdEncoding.EncodeToString([]byte(tc.expr))
			}
			got, known := recapOriginalQuota(metadata, tc.input, tc.output, tc.read, tc.write, make(map[string]recapPriceExpression))
			require.Equal(t, tc.known, known)
			if known {
				assert.InDelta(t, tc.want, got, 1e-8)
			}
		})
	}
}
