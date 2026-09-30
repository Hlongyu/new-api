package service

import (
	"encoding/base64"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/parser"
)

type recapLogMetadata struct {
	ImageCall       bool                `json:"image_generation_call"`
	InputTotal      int64               `json:"input_tokens_total"`
	CacheRead       int64               `json:"cache_tokens"`
	CacheWrite      int64               `json:"cache_write_tokens"`
	CacheCreation   int64               `json:"cache_creation_tokens"`
	Cache5m         int64               `json:"cache_creation_tokens_5m"`
	Cache1h         int64               `json:"cache_creation_tokens_1h"`
	Claude          bool                `json:"claude"`
	Semantic        string              `json:"usage_semantic"`
	BillingMode     string              `json:"billing_mode"`
	Expr            string              `json:"expr_b64"`
	Tier            string              `json:"matched_tier"`
	ModelRatio      *float64            `json:"model_ratio"`
	CompletionRatio *float64            `json:"completion_ratio"`
	CacheRatio      *float64            `json:"cache_ratio"`
	CreationRatio   *float64            `json:"cache_creation_ratio"`
	Creation5mRatio *float64            `json:"cache_creation_ratio_5m"`
	Creation1hRatio *float64            `json:"cache_creation_ratio_1h"`
	ModelPrice      *float64            `json:"model_price"`
	Audio           bool                `json:"audio"`
	WS              bool                `json:"ws"`
	Image           bool                `json:"image"`
	AudioSeparate   bool                `json:"audio_input_seperate_price"`
	ImageTokens     int64               `json:"image_tokens"`
	ImageOutput     int64               `json:"image_output"`
	AudioInput      int64               `json:"audio_input"`
	AudioOutput     int64               `json:"audio_output"`
	Tools           []ToolSurchargeItem `json:"tool_surcharges"`
	WebSearchCount  int                 `json:"web_search_call_count"`
	WebSearchPrice  *float64            `json:"web_search_price"`
	FileSearchCount int                 `json:"file_search_call_count"`
	FileSearchPrice *float64            `json:"file_search_price"`
	ImageCallCount  int                 `json:"image_generation_call_count"`
	ImageCallPrice  *float64            `json:"image_generation_call_price"`
}

// recapTierPrices reads recorded tier unit prices, not request multipliers.
// Ambiguous labels and request/time-dependent prices are deliberately rejected.
type recapTierPrices struct{ tiers map[string][]ast.Node }

func (v *recapTierPrices) Visit(node *ast.Node) {
	call, ok := (*node).(*ast.CallNode)
	if !ok || len(call.Arguments) != 2 {
		return
	}
	fn, ok := call.Callee.(*ast.IdentifierNode)
	if !ok || fn.Value != "tier" {
		return
	}
	label, ok := call.Arguments[0].(*ast.StringNode)
	if !ok {
		return
	}
	v.tiers[label.Value] = append(v.tiers[label.Value], call.Arguments[1])
}

type recapPriceVariables struct {
	valid bool
	used  map[string]bool
}

func (v *recapPriceVariables) Visit(node *ast.Node) {
	switch n := (*node).(type) {
	case *ast.IdentifierNode:
		switch n.Value {
		case "p", "c", "len", "cr", "cc", "cc1h", "img", "img_o", "ai", "ao", "max", "min", "abs", "ceil", "floor":
			v.used[n.Value] = true
		default:
			v.valid = false
		}
	case *ast.BinaryNode, *ast.UnaryNode, *ast.ConditionalNode, *ast.CallNode, *ast.BuiltinNode, *ast.IntegerNode, *ast.FloatNode, *ast.BoolNode:
	default:
		v.valid = false
	}
}

// Only tier selection and token-independent multipliers may surround a tier.
// Reject additive or token-dependent wrappers instead of dropping part of a bill.
func recapTierPriceShape(node ast.Node) bool {
	switch n := node.(type) {
	case *ast.CallNode:
		fn, ok := n.Callee.(*ast.IdentifierNode)
		return ok && fn.Value == "tier" && len(n.Arguments) == 2
	case *ast.ConditionalNode:
		return recapTierPriceShape(n.Exp1) && recapTierPriceShape(n.Exp2)
	case *ast.BinaryNode:
		if n.Operator != "*" {
			return false
		}
		if recapTierPriceShape(n.Left) {
			return recapTokenIndependent(n.Right)
		}
		return recapTierPriceShape(n.Right) && recapTokenIndependent(n.Left)
	}
	return false
}

type recapTokenReferences struct{ found bool }

func (v *recapTokenReferences) Visit(node *ast.Node) {
	if n, ok := (*node).(*ast.IdentifierNode); ok {
		switch n.Value {
		case "p", "c", "len", "cr", "cc", "cc1h", "img", "img_o", "ai", "ao", "tier":
			v.found = true
		}
	}
}
func recapTokenIndependent(node ast.Node) bool {
	v := &recapTokenReferences{}
	ast.Walk(&node, v)
	return !v.found
}

type recapPriceExpression struct {
	expression string
	vars       map[string]bool
}

func parseRecapPriceExpression(encoded, tier string) recapPriceExpression {
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(decoded) > 32768 {
		return recapPriceExpression{}
	}
	_, body := billingexpr.ParseExprVersion(strings.SplitN(string(decoded), "|||", 2)[0])
	tree, err := parser.Parse(body)
	if err != nil {
		return recapPriceExpression{}
	}
	tiers := &recapTierPrices{tiers: make(map[string][]ast.Node)}
	ast.Walk(&tree.Node, tiers)
	selected := tree.Node
	if len(tiers.tiers) > 0 {
		if !recapTierPriceShape(tree.Node) {
			return recapPriceExpression{}
		}
		candidates := tiers.tiers[tier]
		if tier == "" && len(tiers.tiers) == 1 {
			for _, nodes := range tiers.tiers {
				candidates = nodes
			}
		}
		if len(candidates) != 1 {
			return recapPriceExpression{}
		}
		selected = candidates[0]
	}
	vars := &recapPriceVariables{valid: true, used: make(map[string]bool)}
	ast.Walk(&selected, vars)
	if !vars.valid {
		return recapPriceExpression{}
	}
	return recapPriceExpression{expression: selected.String(), vars: vars.used}
}

// recapOriginalQuota evaluates usage at historical base unit prices, independent
// of actual charges, discounts, or request speed multipliers. No current price
// configuration is consulted. Values are unrounded reporting amounts, not bills.
func recapOriginalQuota(other recapLogMetadata, input, output, read, write int64, cache map[string]recapPriceExpression) (float64, bool) {
	if input < 0 || output < 0 || read < 0 || write < 0 || other.Cache5m < 0 || other.Cache1h < 0 {
		return 0, false
	}
	// These historical paths do not consistently retain every priced dimension.
	if (other.Audio || other.WS || other.AudioSeparate || other.Image || other.ImageTokens > 0 || other.ImageOutput > 0 || other.AudioInput > 0 || other.AudioOutput > 0) && !(other.BillingMode != "tiered_expr" && other.ModelPrice != nil && *other.ModelPrice > 0) {
		return 0, false
	}
	var quota float64
	if other.BillingMode == "tiered_expr" {
		key := other.Expr + "\x00" + other.Tier
		price, ok := cache[key]
		if !ok {
			price = parseRecapPriceExpression(other.Expr, other.Tier)
			cache[key] = price
		}
		if price.expression == "" {
			return 0, false
		}
		cc1h := other.Cache1h
		cc := max(write-cc1h, 0)
		params := billingexpr.TokenParams{P: float64(input), C: float64(output), Len: float64(input), CR: float64(read), CC: float64(cc), CC1h: float64(cc1h)}
		if price.vars["img"] || price.vars["img_o"] || price.vars["ai"] || price.vars["ao"] {
			return 0, false
		}
		if price.vars["cr"] {
			params.P -= params.CR
		}
		if price.vars["cc"] {
			params.P -= params.CC
		}
		if price.vars["cc1h"] {
			params.P -= params.CC1h
		}
		params.P = max(params.P, 0)
		cost, _, err := billingexpr.RunExpr(price.expression, params)
		if err != nil || cost < 0 {
			return 0, false
		}
		quota = cost / 1000000 * common.QuotaPerUnit
	} else if other.ModelPrice != nil && *other.ModelPrice > 0 {
		quota = *other.ModelPrice * common.QuotaPerUnit
	} else {
		if other.ModelRatio == nil || *other.ModelRatio < 0 {
			return 0, false
		}
		// Legacy model_ratio is half the input USD price per million tokens.
		base := float64(max(input-read-write, 0))
		parts := []struct {
			count int64
			ratio *float64
		}{{output, other.CompletionRatio}, {read, other.CacheRatio}}
		if other.Cache5m > 0 || other.Cache1h > 0 {
			parts = append(parts, struct {
				count int64
				ratio *float64
			}{other.Cache5m, other.Creation5mRatio}, struct {
				count int64
				ratio *float64
			}{other.Cache1h, other.Creation1hRatio}, struct {
				count int64
				ratio *float64
			}{max(write-other.Cache5m-other.Cache1h, 0), other.CreationRatio})
		} else {
			parts = append(parts, struct {
				count int64
				ratio *float64
			}{write, other.CreationRatio})
		}
		for _, part := range parts {
			if part.count == 0 {
				continue
			}
			if part.ratio == nil || *part.ratio < 0 {
				return 0, false
			}
			base += float64(part.count) * (*part.ratio)
		}
		quota = base * (*other.ModelRatio) * 2 / 1000000 * common.QuotaPerUnit
	}
	tools := other.Tools
	if len(tools) == 0 {
		for _, tool := range []struct {
			count int
			price *float64
		}{{other.WebSearchCount, other.WebSearchPrice}, {other.FileSearchCount, other.FileSearchPrice}} {
			if tool.count == 0 {
				continue
			}
			if tool.price == nil {
				return 0, false
			}
			tools = append(tools, ToolSurchargeItem{Count: tool.count, Price: *tool.price})
		}
	}
	if len(other.Tools) == 0 && (other.ImageCall || other.ImageCallCount > 0) {
		if other.ImageCallPrice == nil || *other.ImageCallPrice < 0 || other.ImageCallCount < 0 {
			return 0, false
		}
		quota += float64(max(other.ImageCallCount, 1)) * (*other.ImageCallPrice) * common.QuotaPerUnit
	}
	for _, tool := range tools {
		if tool.Count < 0 || tool.Price < 0 {
			return 0, false
		}
		quota += float64(tool.Count) * tool.Price / 1000 * common.QuotaPerUnit
	}
	return quota, quota >= 0 && !math.IsNaN(quota) && !math.IsInf(quota, 0)
}
