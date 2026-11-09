package billingexpr_test

import (
	"bytes"
	"testing"

	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCompactRequestInputPreservesBillingAcrossBranches(t *testing.T) {
	body := []byte(`{"service_tier":"priority","options":{"enabled":false,"n":0},"items":[{"n":1},{"n":2}],"nullable":null}`)
	for _, test := range []struct {
		name, expression string
	}{
		{"tier and unselected branch", `p < 100 ? p : p * (param("service_tier") == "priority" ? 2 : 1)`},
		{"zero and false", `param("options.n") == 0 && param("options.enabled") == false ? p * 2 : p`},
		{"array length", `p * param("items.#")`},
		{"query result", `p * param("items.#(n>1)#.n")[0]`},
		{"object value", `p * param("options").n`},
		{"missing null empty", `param("nullable") == nil && param("missing") == nil && param(" ") == nil ? p : 0`},
		{"trimmed path and header", `param(" service_tier ") == "priority" && header("X-Tier") == "yes" ? p * 2 : p`},
		{"no body dependency", `p * 2 + c`},
	} {
		t.Run(test.name, func(t *testing.T) {
			original := billingexpr.RequestInput{Body: bytes.Clone(body), Headers: map[string]string{"X-Tier": "yes"}}
			snapshot, err := billingexpr.CompactRequestInput(test.expression, original)
			require.NoError(t, err)
			assert.Empty(t, snapshot.Body, "conversation must not remain in the snapshot")
			for _, tokens := range []billingexpr.TokenParams{{P: 1}, {P: 1000, C: 10}} {
				want, wantTrace, err := billingexpr.RunExprWithRequest(test.expression, tokens, original)
				require.NoError(t, err)
				got, gotTrace, err := billingexpr.RunExprWithRequest(test.expression, tokens, snapshot)
				require.NoError(t, err)
				assert.Equal(t, want, got)
				assert.Equal(t, wantTrace, gotTrace)
			}
			// Channel adaptation/reuse cannot alter the captured client values.
			copy(original.Body, bytes.Repeat([]byte{' '}, len(original.Body)))
			tokens := billingexpr.TokenParams{P: 1000}
			want, _, err := billingexpr.RunExprWithRequest(test.expression, tokens, billingexpr.RequestInput{Body: body, Headers: original.Headers})
			require.NoError(t, err)
			got, _, err := billingexpr.RunExprWithRequest(test.expression, tokens, snapshot)
			require.NoError(t, err)
			assert.Equal(t, want, got)
		})
	}
}

func TestCompactRequestInputKeepsDynamicRequestAccess(t *testing.T) {
	for _, expression := range []string{
		`p * param(header("X-Path"))`,
		`let lookup = param; p * lookup("multiplier")`,
		`let lookup = $env["param"]; p * lookup("multiplier")`,
	} {
		t.Run(expression, func(t *testing.T) {
			input := billingexpr.RequestInput{Body: []byte(`{"multiplier":3}`), Headers: map[string]string{"X-Path": "multiplier"}}
			snapshot, err := billingexpr.CompactRequestInput(expression, input)
			require.NoError(t, err)
			assert.Equal(t, input.Body, snapshot.Body)
			cost, _, err := billingexpr.RunExprWithRequest(expression, billingexpr.TokenParams{P: 10}, snapshot)
			require.NoError(t, err)
			assert.Equal(t, float64(30), cost)
		})
	}
}

func TestCompactRequestInputRejectsDifferentBillingExpression(t *testing.T) {
	snapshot, err := billingexpr.CompactRequestInput(`p * param("first")`, billingexpr.RequestInput{Body: []byte(`{"first":2,"second":3}`)})
	require.NoError(t, err)
	_, _, err = billingexpr.RunExprWithRequest(`p * param("second")`, billingexpr.TokenParams{P: 10}, snapshot)
	require.Error(t, err)
}
