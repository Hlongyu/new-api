package relay

import (
	"bytes"
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"testing"
)

var responsesCloneResult *dto.OpenAIResponsesRequest

// Compare the production request type and the previous copier path using a
// long conversation payload. Timing is diagnostic, never a pass/fail assertion.
func BenchmarkResponsesRequestClone(b *testing.B) {
	for _, size := range []int{128 << 10, 1 << 20, 4 << 20} {
		input := append([]byte(`[{"role":"user","content":"`), bytes.Repeat([]byte("a"), size)...)
		input = append(input, []byte(`"}]`)...)
		request := &dto.OpenAIResponsesRequest{Model: "test", Input: input, Reasoning: &dto.Reasoning{Effort: "high"}}
		b.Run(fmt.Sprintf("%dKiB", size>>10), func(b *testing.B) {
			b.Run("reflection", func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(input)))
				for i := 0; i < b.N; i++ {
					var err error
					responsesCloneResult, err = common.DeepCopy(request)
					if err != nil {
						b.Fatal(err)
					}
				}
			})
			b.Run("typed", func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(input)))
				for i := 0; i < b.N; i++ {
					responsesCloneResult = request.Clone()
				}
			})
		})
	}
}
