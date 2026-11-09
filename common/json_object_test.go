package common

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteJSONObjectPreservesRawValuesAndLastDuplicate(t *testing.T) {
	input := ` {"input":[{"stream":false,"n":9007199254740993,"text":"你好\\\""}],"model":"first","mo\u0064el":"last","temperature":0.0,"store":false,"stream":false,"stream":true,"custom":null}`
	var output bytes.Buffer
	require.NoError(t, WriteJSONObject(&output, []byte(input), map[string]json.RawMessage{
		"stream": nil, "type": json.RawMessage(`"response.create"`),
	}))
	assert.Equal(t, `{"custom":null,"input":[{"stream":false,"n":9007199254740993,"text":"你好\\\""}],"model":"last","store":false,"temperature":0.0,"type":"response.create"}`, output.String())
	assert.Equal(t, 1, strings.Count(output.String(), `"model":`))
}

func TestWriteJSONObjectRejectsInvalidInputBeforeWriting(t *testing.T) {
	for _, input := range []string{`null`, `[]`, `"value"`, `{"input":}`, `{} {}`, `{"input":1} trailing`} {
		t.Run(input, func(t *testing.T) {
			var output bytes.Buffer
			require.Error(t, WriteJSONObject(&output, []byte(input), nil))
			assert.Empty(t, output.Bytes())
		})
	}
	var output bytes.Buffer
	require.Error(t, WriteJSONObject(&output, []byte(`{}`), map[string]json.RawMessage{"bad": json.RawMessage(`true false`)}))
	assert.Empty(t, output.Bytes())
}
