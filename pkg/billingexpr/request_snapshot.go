package billingexpr

import (
	"fmt"
	"strings"

	"github.com/expr-lang/expr/ast"
	"github.com/tidwall/gjson"
)

// CompactRequestInput freezes every literal param() path, including branches
// not taken during pre-consume. Settlement can then use different token counts
// without retaining the entire conversation. Dynamic paths and indirect access
// to param keep the full body so arbitrary existing expressions still work.
func CompactRequestInput(expression string, input RequestInput) (RequestInput, error) {
	hash := ExprHashString(expression)
	if input.paramValues != nil {
		if input.exprHash != hash {
			return RequestInput{}, fmt.Errorf("request snapshot belongs to a different billing expression")
		}
		return input, nil
	}
	program, err := CompileFromCache(expression)
	if err != nil {
		return RequestInput{}, err
	}
	paths := make(map[string]gjson.Result)
	identifiers, directCalls := 0, 0
	dynamic := false
	ast.Find(program.Node(), func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.IdentifierNode:
			if n.Value == "param" {
				identifiers++
			}
			if n.Value == "$env" {
				dynamic = true
			}
		case *ast.CallNode:
			callee, ok := n.Callee.(*ast.IdentifierNode)
			if !ok || callee.Value != "param" {
				break
			}
			directCalls++
			if len(n.Arguments) != 1 {
				dynamic = true
				break
			}
			path, ok := n.Arguments[0].(*ast.StringNode)
			if !ok {
				dynamic = true
				break
			}
			paths[strings.TrimSpace(path.Value)] = gjson.Result{}
		}
		return false
	})
	if dynamic || identifiers != directCalls {
		return input, nil
	}
	for path := range paths {
		if path != "" {
			// GetBytes owns the selected result; it doesn't retain the input.
			paths[path] = gjson.GetBytes(input.Body, path)
		}
	}
	input.Body = nil
	input.paramValues, input.exprHash = paths, hash
	return input, nil
}
